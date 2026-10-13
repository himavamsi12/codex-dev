import type { Context } from "./context.js";
import { BridgeError } from "./errors.js";

/** One entry of the extension's device catalog (devices.js), the same list the Responsive Viewer offers. */
export interface CatalogDevice {
  name: string;
  width: number;
  height: number;
  category: "mobile" | "tablet" | "desktop" | "custom";
  brand?: string;
}

/** A device ready to emulate: catalog entry (or custom size) plus pixel ratio and mobile flag. */
export interface ResolvedDevice extends CatalogDevice {
  deviceScaleFactor: number;
  mobile: boolean;
  custom: boolean;
}

const DPR = { mobile: 3, tablet: 2, desktop: 1, custom: 1 } as const;
const CUSTOM_SIZE = /^\s*(\d{3,4})\s*[x×]\s*(\d{3,4})\s*$/i;
const MIN_SIZE = 200;
const MAX_SIZE = 4000; // the viewer's custom-device limit

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function fetchCatalog(ctx: Context): Promise<CatalogDevice[]> {
  try {
    const res = await ctx.bridge.request<{ devices: CatalogDevice[] }>("devices");
    return res.devices;
  } catch (e) {
    if (e instanceof BridgeError && e.code === "bad_request")
      throw new BridgeError("extension_outdated", "This version of the Codex Dev extension has no device catalog.", "Reload the extension in chrome://extensions, then allow the tab again.");
    throw e;
  }
}

function withEmulation(d: CatalogDevice, custom: boolean): ResolvedDevice {
  const category = custom ? (d.width < 768 ? "mobile" : d.width < 1100 ? "tablet" : "desktop") : d.category;
  return { ...d, deviceScaleFactor: custom ? 1 : DPR[category], mobile: category === "mobile" || category === "tablet", custom };
}

/**
 * Resolves a device the user named ("Galaxy S24", "iphone 15 pro max", "MacBook Air")
 * or a custom size ("412x915"). An exact name wins; otherwise the shortest name that
 * contains the query, so "iPhone 15" picks iPhone 15 rather than iPhone 15 Pro Max.
 */
export function findDevice(catalog: CatalogDevice[], query: string): ResolvedDevice {
  const size = CUSTOM_SIZE.exec(query);
  if (size) {
    const width = +size[1], height = +size[2];
    if ([width, height].some((n) => n < MIN_SIZE || n > MAX_SIZE))
      throw new BridgeError("bad_request", `Custom sizes must be between ${MIN_SIZE} and ${MAX_SIZE} px on each side.`);
    return withEmulation({ name: `Custom ${width}×${height}`, width, height, category: "custom" }, true);
  }
  const q = norm(query);
  if (!q) throw new BridgeError("bad_request", "Device name is empty.");
  const exact = catalog.find((d) => norm(d.name) === q);
  if (exact) return withEmulation(exact, false);
  const hits = catalog.filter((d) => norm(d.name).includes(q));
  if (!hits.length)
    throw new BridgeError("unknown_device", `No device in the catalog matches "${query.slice(0, 60)}".`, "Call list_devices to search the catalog, or pass a custom size like \"412x915\".");
  const shortest = Math.min(...hits.map((d) => norm(d.name).length));
  const best = hits.filter((d) => norm(d.name).length === shortest);
  if (best.length > 1)
    throw new BridgeError("ambiguous_device", `"${query.slice(0, 60)}" matches several devices: ${hits.slice(0, 8).map((d) => d.name).join(", ")}.`, "Use one of the full names.");
  return withEmulation(best[0], false);
}

/** Width/height for a device, swapped for landscape (desktops don't rotate). */
export function deviceViewport(d: ResolvedDevice, landscape = false) {
  const rotate = landscape && d.category !== "desktop";
  return { width: rotate ? d.height : d.width, height: rotate ? d.width : d.height, label: d.name + (rotate ? " (landscape)" : "") };
}
