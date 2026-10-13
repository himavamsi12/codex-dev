import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { EXTENSION_ORIGIN, tokensMatch } from "./auth.js";
import { branchName } from "./git.js";
import { handleMcp } from "./mcp.js";
import { ClientMessageSchema, PROTOCOL_VERSION, type ServerMessage } from "./protocol.js";
import type { EditSession } from "./session.js";

const AUTH_TIMEOUT_MS = 5_000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

export interface BridgeOptions { port: number; token: string; root: string; session: EditSession; extensionId?: string }

/**
 * 127.0.0.1 only. WebSocket upgrades need a chrome-extension:// Origin, a loopback Host and a
 * "hello" with the token before anything else is read. The only actions are the typed
 * messages in protocol.ts; no message ever carries a command to run.
 */
export class Bridge {
  private http: Server;
  private wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private pinnedOrigin: string | null;
  private failures = 0;
  private lockedUntil = 0;
  private captures = new Map<string, { resolve: (d: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  port = 0;

  constructor(private o: BridgeOptions) {
    this.pinnedOrigin = o.extensionId ? `chrome-extension://${o.extensionId}` : null;
    this.http = createServer((req, res) => this.onHttp(req, res));
    this.wss = new WebSocketServer({
      server: this.http, path: "/ws", maxPayload: 16 * 1024 * 1024,
      verifyClient: (info, cb) => {
        if (Date.now() < this.lockedUntil) return cb(false, 429, "Too many failed attempts");
        const origin = info.origin || "";
        if (!EXTENSION_ORIGIN.test(origin) || (this.pinnedOrigin && origin !== this.pinnedOrigin)) return cb(false, 403, "Origin not allowed");
        if (!this.hostOk(info.req)) return cb(false, 403, "Host not allowed");
        cb(true);
      },
    });
    this.wss.on("connection", (s, req) => this.onSocket(s, req.headers.origin ?? ""));
  }

  get connected() { return !!this.socket; }
  private hostOk(req: IncomingMessage) { return [`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(String(req.headers.host ?? "")); }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.o.port, "127.0.0.1", () => { this.port = (this.http.address() as AddressInfo).port; resolve(); });
    });
  }
  async stop() {
    this.socket?.close(1001);
    this.wss.close();
    await new Promise<void>(r => this.http.close(() => r()));
  }

  private send(sock: WebSocket, m: ServerMessage) { if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(m)); }

  private onHttp(req: IncomingMessage, res: ServerResponse) {
    const url = (req.url ?? "").split("?")[0];
    // MCP clients are not browsers: any request that carries an Origin is refused (CSRF / DNS rebinding).
    if (url !== "/mcp" || req.headers.origin || !this.hostOk(req)) { res.writeHead(404).end(); return; }
    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Bearer ") || !tokensMatch(auth.slice(7), this.o.token)) { res.writeHead(401).end(); return; }
    handleMcp(req, res, this).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
  }

  lastSelection() { return this.o.session.lastSelection; }

  requestCapture(timeoutMs = 10_000): Promise<string> {
    const sock = this.socket;
    if (!sock) return Promise.reject(new Error("The Codex Dev viewer is not connected to the bridge."));
    const rid = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.captures.delete(rid); reject(new Error("The viewer did not answer in time.")); }, timeoutMs);
      this.captures.set(rid, { resolve, reject, timer });
      this.send(sock, { type: "capture_request", rid });
    });
  }

  private onSocket(sock: WebSocket, origin: string) {
    let authed = false;
    const timer = setTimeout(() => { if (!authed) sock.close(4401, "auth timeout"); }, AUTH_TIMEOUT_MS);
    const sess = this.o.session;
    const send = (m: ServerMessage) => this.send(sock, m);

    sock.on("message", async (data, isBinary) => {
      if (isBinary) return sock.close(1003, "binary not supported");
      let json: unknown;
      try { json = JSON.parse(data.toString()); } catch { return sock.close(1007, "bad json"); }
      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        if (!authed) return sock.close(4400, "bad message");
        return send({ type: "error", code: "bad_request", message: "Malformed request." });
      }
      const msg = parsed.data;

      if (!authed) {
        if (msg.type !== "hello" || msg.protocol !== PROTOCOL_VERSION || !tokensMatch(msg.token, this.o.token)) {
          if (++this.failures >= MAX_FAILURES) { this.lockedUntil = Date.now() + LOCKOUT_MS; this.failures = 0; }
          send({ type: "error", code: "bad_token", message: msg.type === "hello" && msg.protocol !== PROTOCOL_VERSION ? "Protocol mismatch: update the extension or the bridge." : "Invalid token." });
          return sock.close(4401, "unauthorized");
        }
        authed = true; this.failures = 0; clearTimeout(timer);
        this.pinnedOrigin ??= origin; // first authenticated extension wins for this run
        if (this.pinnedOrigin !== origin) return sock.close(4403, "origin");
        if (this.socket && this.socket !== sock) this.socket.close(4000, "replaced");
        this.socket = sock;
        send({ type: "welcome", protocol: PROTOCOL_VERSION, project: { name: basename(this.o.root), branch: await branchName(this.o.root) }, undoDepth: sess.undoDepth });
        return;
      }

      switch (msg.type) {
        case "ping": return send({ type: "pong" });
        case "selection": sess.lastSelection = msg.selection; return;
        case "edit": return void sess.edit(msg.id, msg.instruction, msg.selection, send);
        case "cancel": return sess.cancel(msg.id);
        case "accept": return sess.accept(msg.id, send);
        case "reject": return void sess.reject(msg.id, send);
        case "undo": return void sess.undo(send);
        case "capture_response": {
          const c = this.captures.get(msg.rid);
          if (!c) return;
          this.captures.delete(msg.rid); clearTimeout(c.timer);
          msg.dataUrl ? c.resolve(msg.dataUrl) : c.reject(new Error(msg.error || "Capture failed."));
          return;
        }
      }
    });
    sock.on("close", () => { clearTimeout(timer); if (this.socket === sock) this.socket = null; });
    sock.on("error", () => sock.terminate());
  }
}
