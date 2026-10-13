export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export interface ToolErrorBody {
  code: string;
  message: string;
  hint?: string;
}

export function describeError(e: unknown): ToolErrorBody {
  if (e instanceof BridgeError) return { code: e.code, message: e.message, hint: e.hint };
  return { code: "internal_error", message: e instanceof Error ? e.message : String(e) };
}
