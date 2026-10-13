import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BridgeServer } from "../../src/bridge.js";
import { createContext, createServer } from "../../src/server.js";
import { FakeExtension } from "./fake-extension.js";

export const TOKEN = "test-token-0123456789abcdef-0123456789";

export async function startServer(opts: { requestTimeoutMs?: number } = {}) {
  const bridge = new BridgeServer({ port: 0, token: TOKEN, requestTimeoutMs: opts.requestTimeoutMs });
  await bridge.start();
  const ctx = createContext(bridge, mkdtempSync(join(tmpdir(), "codex-mcp-test-")));
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);

  return {
    bridge,
    ctx,
    client,
    port: bridge.port!,
    async connectExtension(handlers: ConstructorParameters<typeof FakeExtension>[2]) {
      const ext = new FakeExtension(bridge.port!, TOKEN, handlers);
      await ext.connect();
      return ext;
    },
    /** Calls a tool and returns the parsed structured result plus isError. */
    async call(name: string, args: Record<string, unknown> = {}) {
      const res: any = await client.callTool({ name, arguments: args });
      const text = res.content?.find((c: any) => c.type === "text")?.text;
      let data: any = res.structuredContent;
      if (!data && text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      return { data, isError: !!res.isError, content: res.content as any[], text: text as string };
    },
    async close() {
      await client.close();
      await bridge.stop();
    },
  };
}
