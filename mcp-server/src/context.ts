import type { BridgeServer } from "./bridge.js";
import { BridgeError } from "./errors.js";
import type { ReportStore, ScreenshotStore } from "./store.js";

export interface Context {
  bridge: BridgeServer;
  reports: ReportStore;
  shots: ScreenshotStore;
  selected: { tabId: number | null };
  /** CSS preview patches currently applied, per tab (cleared by reload). */
  patches: Map<number, Set<string>>;
}

export function requireTab(ctx: Context, tabId?: number): number {
  const id = tabId ?? ctx.selected.tabId;
  if (id == null) {
    throw new BridgeError("no_tab_selected", "No browser tab is selected.", "Call list_browser_tabs, then select_browser_tab. Tabs must first be allowed from the Codex Dev popup.");
  }
  return id;
}
