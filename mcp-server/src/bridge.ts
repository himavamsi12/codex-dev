import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { BridgeError } from "./errors.js";
import { log } from "./log.js";

export const PROTOCOL_VERSION = 1;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const AUTH_TIMEOUT_MS = 5_000;
const MAX_PAYLOAD = 16 * 1024 * 1024;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60_000;
const LOCKOUT_MS = 30_000;
const PAIR_TTL_MS = 120_000;
const PAIR_MAX_ATTEMPTS = 5;

export interface BridgeOptions {
  port: number;
  token: string;
  extensionId?: string;
  requestTimeoutMs?: number;
}

export interface BridgeStatus {
  listening: boolean;
  port: number | null;
  listenError: string | null;
  connected: boolean;
  connectedSince: string | null;
  extension: { version: string; protocol: number } | null;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  command: string;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export function tokensMatch(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given.length > 512) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Local WebSocket endpoint the Codex Dev extension dials into.
 *
 * Only 127.0.0.1 is bound, the Origin must be a chrome-extension:// page, the
 * Host header must be a loopback name (DNS-rebinding guard), and nothing is
 * accepted before a "hello" carrying the pairing token. At most one extension
 * connection is live at a time; a new authenticated one replaces the old.
 */
export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private failures: number[] = [];
  private lockedUntil = 0;
  private listenError: string | null = null;
  private connectedSince: string | null = null;
  private extension: BridgeStatus["extension"] = null;
  private boundPort: number | null = null;
  private pairing: { code: string; expires: number; attempts: number } | null = null;

  constructor(private opts: BridgeOptions) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({
        host: "127.0.0.1",
        port: this.opts.port,
        maxPayload: MAX_PAYLOAD,
        verifyClient: (info, cb) => this.verify(info, cb),
      });
      wss.on("listening", () => {
        this.wss = wss;
        this.boundPort = (wss.address() as AddressInfo).port;
        log.info(`bridge listening on 127.0.0.1:${this.boundPort}`);
        resolve();
      });
      wss.on("error", (e: NodeJS.ErrnoException) => {
        this.listenError =
          e.code === "EADDRINUSE"
            ? `Port ${this.opts.port} is already in use. Another Codex Dev MCP server (another Claude Code session?) probably owns it. Set CODEX_DEV_MCP_PORT and the same port in the extension popup.`
            : `Bridge failed to start: ${e.message}`;
        log.error(this.listenError);
        resolve();
      });
      wss.on("connection", (sock) => this.onConnection(sock));
    });
  }

  async stop(): Promise<void> {
    this.rejectAll(new BridgeError("server_stopped", "The MCP server is shutting down."));
    this.socket?.close(1001, "shutdown");
    this.socket = null;
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    this.wss = null;
  }

  /**
   * Opens a short pairing window and returns a one-time 6-digit code. An
   * extension that presents it (instead of the long token) receives the token.
   * The code expires after two minutes, after five wrong guesses, or on first use.
   */
  armPairing(ttlMs = PAIR_TTL_MS): { code: string; expiresInSeconds: number } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pairing = { code, expires: Date.now() + ttlMs, attempts: 0 };
    return { code, expiresInSeconds: Math.round(ttlMs / 1000) };
  }

  private tryPair(given: unknown): boolean {
    const p = this.pairing;
    if (!p || Date.now() > p.expires) {
      this.pairing = null;
      return false;
    }
    p.attempts++;
    const ok = typeof given === "string" && /^\d{6}$/.test(given) && tokensMatch(given, p.code);
    if (ok) this.pairing = null;
    else if (p.attempts >= PAIR_MAX_ATTEMPTS) this.pairing = null;
    return ok;
  }

  get port(): number | null {
    return this.boundPort;
  }

  status(): BridgeStatus {
    return {
      listening: !!this.wss,
      port: this.boundPort,
      listenError: this.listenError,
      connected: !!this.socket,
      connectedSince: this.connectedSince,
      extension: this.extension,
    };
  }

  private verify(
    info: { origin: string; req: { headers: Record<string, string | string[] | undefined> } },
    cb: (ok: boolean, code?: number, message?: string) => void,
  ): void {
    if (Date.now() < this.lockedUntil) return cb(false, 429, "Too many failed attempts");
    const origin = info.origin || "";
    const pinned = this.opts.extensionId ? `chrome-extension://${this.opts.extensionId}` : null;
    if (!EXTENSION_ORIGIN.test(origin) || (pinned && origin !== pinned)) return cb(false, 403, "Origin not allowed");
    const host = String(info.req.headers.host ?? "");
    const allowed = new Set([`127.0.0.1:${this.boundPort}`, `localhost:${this.boundPort}`]);
    if (!allowed.has(host)) return cb(false, 403, "Host not allowed");
    cb(true);
  }

  private noteFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    this.failures.push(now);
    if (this.failures.length >= MAX_FAILURES) {
      this.lockedUntil = now + LOCKOUT_MS;
      this.failures = [];
      log.warn("too many failed pairing attempts; refusing connections for 30s");
    }
  }

  private onConnection(sock: WebSocket): void {
    let authed = false;
    const authTimer = setTimeout(() => {
      if (!authed) sock.close(4401, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    sock.on("message", (data, isBinary) => {
      if (isBinary) return sock.close(1003, "binary not supported");
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return sock.close(1007, "bad json");
      }
      if (!msg || typeof msg !== "object") return sock.close(1007, "bad message");

      if (!authed) {
        if (msg.type === "pair" && msg.protocol === PROTOCOL_VERSION && this.tryPair(msg.code)) {
          authed = true;
          clearTimeout(authTimer);
          // The pairing socket only delivers the token; the extension then reconnects normally.
          sock.send(JSON.stringify({ type: "paired", token: this.opts.token }), () => sock.close(1000, "paired"));
          return;
        }
        if (msg.type === "hello" && msg.protocol === PROTOCOL_VERSION && tokensMatch(msg.token, this.opts.token)) {
          authed = true;
          clearTimeout(authTimer);
          this.adopt(sock, msg);
        } else {
          this.noteFailure();
          const why = msg.type === "pair" ? "invalid or expired pairing code" : msg.type === "hello" && msg.protocol !== PROTOCOL_VERSION ? "protocol mismatch" : "invalid token";
          sock.send(JSON.stringify({ type: "error", message: why }));
          sock.close(4401, why);
        }
        return;
      }

      if (msg.type === "ping") sock.send('{"type":"pong"}');
      else if (msg.type === "response") this.onResponse(msg);
    });

    sock.on("close", () => {
      clearTimeout(authTimer);
      if (this.socket === sock) {
        this.socket = null;
        this.connectedSince = null;
        this.extension = null;
        this.rejectAll(
          new BridgeError(
            "extension_disconnected",
            "The browser extension disconnected mid-request.",
            "Check that Chrome is open and the Codex Dev popup shows Connected.",
          ),
        );
        log.info("extension disconnected");
      }
    });
    sock.on("error", () => sock.terminate());
  }

  private adopt(sock: WebSocket, hello: any): void {
    if (this.socket && this.socket !== sock) {
      this.rejectAll(new BridgeError("extension_replaced", "A newer browser connection replaced this one."));
      this.socket.close(4000, "replaced");
    }
    this.socket = sock;
    this.connectedSince = new Date().toISOString();
    this.extension = { version: String(hello.extensionVersion ?? "unknown").slice(0, 32), protocol: hello.protocol };
    sock.send(JSON.stringify({ type: "welcome", protocol: PROTOCOL_VERSION }));
    log.info("extension connected");
  }

  private onResponse(msg: any): void {
    const p = typeof msg.id === "string" ? this.pending.get(msg.id) : undefined;
    if (!p) return; // late or unknown id: ignore
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else {
      const e = msg.error ?? {};
      p.reject(
        new BridgeError(String(e.code ?? "extension_error"), String(e.message ?? "The extension reported an error."), e.hint ? String(e.hint) : undefined),
      );
    }
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  /** Sends one command to the extension and resolves with its result. */
  request<T = any>(command: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const sock = this.socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      const err = this.listenError
        ? new BridgeError("bridge_unavailable", this.listenError)
        : new BridgeError(
            "extension_not_connected",
            "The Codex Dev extension is not connected.",
            "Call codex_dev_connect and have the user enter the code in the Codex Dev popup (Claude Code → Connect).",
          );
      return Promise.reject(err);
    }
    const id = randomUUID();
    const ms = timeoutMs ?? this.opts.requestTimeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("timeout", `The extension did not answer "${command}" within ${Math.round(ms / 1000)}s.`, "The tab may be busy, frozen or showing a dialog."));
      }, ms);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, command });
      sock.send(JSON.stringify({ type: "request", id, command, params }));
    });
  }
}
