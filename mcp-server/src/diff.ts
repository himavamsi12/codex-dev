import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
}

export type DiffResult =
  | {
      comparable: true;
      width: number;
      height: number;
      identical: boolean;
      changedPixels: number;
      changedRatio: number;
      regions: DiffRegion[];
      regionsOmitted: number;
      diffPng: Buffer;
    }
  | { comparable: false; a: { width: number; height: number }; b: { width: number; height: number }; reason: string };

const CELL = 16;
const MAX_REGIONS = 20;

/**
 * Deterministic pixel comparison (pixelmatch, anti-aliasing tolerant).
 * Differing pixels are grouped into regions by connecting 16px cells.
 */
export function compareImages(a: Buffer, b: Buffer, threshold = 0.1): DiffResult {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) {
    return {
      comparable: false,
      a: { width: A.width, height: A.height },
      b: { width: B.width, height: B.height },
      reason: "Images have different dimensions, so a pixel diff would be meaningless. Capture both at the same viewport and scale.",
    };
  }
  const { width, height } = A;
  const out = new PNG({ width, height });
  const changed = pixelmatch(A.data, B.data, out.data, width, height, {
    threshold,
    includeAA: false,
    alpha: 0.25,
    diffColor: [255, 0, 0],
    diffColorAlt: [255, 0, 0],
  });

  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cellCount = new Uint32Array(cols * rows);
  if (changed > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // diff pixels are pure red; anti-aliased (ignored) pixels are yellow
        if (out.data[i] === 255 && out.data[i + 1] === 0 && out.data[i + 2] === 0) cellCount[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]++;
      }
    }
  }

  const seen = new Uint8Array(cols * rows);
  const regions: DiffRegion[] = [];
  for (let start = 0; start < cellCount.length; start++) {
    if (!cellCount[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minC = cols, maxC = 0, minR = rows, maxR = 0, px = 0;
    while (stack.length) {
      const cur = stack.pop()!;
      const c = cur % cols, r = Math.floor(cur / cols);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      px += cellCount[cur];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (cellCount[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
    }
    regions.push({
      x: minC * CELL,
      y: minR * CELL,
      width: Math.min(width, (maxC + 1) * CELL) - minC * CELL,
      height: Math.min(height, (maxR + 1) * CELL) - minR * CELL,
      changedPixels: px,
    });
  }
  regions.sort((p, q) => q.changedPixels - p.changedPixels);

  return {
    comparable: true,
    width,
    height,
    identical: changed === 0,
    changedPixels: changed,
    changedRatio: Math.round((changed / (width * height)) * 1e6) / 1e6,
    regions: regions.slice(0, MAX_REGIONS),
    regionsOmitted: Math.max(0, regions.length - MAX_REGIONS),
    diffPng: PNG.sync.write(out),
  };
}

export function pngSize(buf: Buffer): { width: number; height: number } {
  const p = PNG.sync.read(buf);
  return { width: p.width, height: p.height };
}
