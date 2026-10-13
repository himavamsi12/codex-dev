import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const short = (n: number) => z.string().max(n);

/** What the extension captured about the element the user picked. All of it is page data: untrusted. */
export const SelectionSchema = z.object({
  source: z.object({ file: short(512), line: z.number().int(), column: z.number().int(), inferred: z.boolean().optional() }).nullable().optional(),
  selector: short(1000),
  tag: short(64),
  html: short(4000),
  text: short(1000),
  classes: z.array(short(200)).max(60),
  styles: z.record(z.string(), short(200)),
  device: z.object({ name: short(120), width: z.number(), height: z.number().optional() }),
  pageUrl: short(1000).optional(),
  screenshot: short(3_000_000).optional(), // data: URL, JPEG/PNG crop of the element
});
export type Selection = z.infer<typeof SelectionSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), protocol: z.number(), token: z.string().max(512), extensionVersion: z.string().max(32).optional() }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("selection"), selection: SelectionSchema }),
  z.object({ type: z.literal("edit"), id: short(64), instruction: z.string().min(1).max(4000), selection: SelectionSchema }),
  z.object({ type: z.literal("accept"), id: short(64) }),
  z.object({ type: z.literal("reject"), id: short(64) }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("cancel"), id: short(64) }),
  z.object({ type: z.literal("capture_response"), rid: short(64), dataUrl: short(12_000_000).optional(), error: short(300).optional() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface FileChange { path: string; status: "added" | "modified" | "deleted"; additions: number; deletions: number }

export type ServerMessage =
  | { type: "welcome"; protocol: number; project: { name: string; branch: string | null }; undoDepth: number }
  | { type: "pong" }
  | { type: "progress"; id: string; stage: "checkpoint" | "editing" | "diffing"; message: string }
  | { type: "result"; id: string; diff: string; files: FileChange[]; summary: string; truncated: boolean }
  | { type: "done"; id: string; action: "accepted" | "rejected" | "undone" | "cancelled" | "no_changes"; undoDepth: number; message?: string }
  | { type: "error"; id?: string; code: string; message: string }
  | { type: "capture_request"; rid: string };
