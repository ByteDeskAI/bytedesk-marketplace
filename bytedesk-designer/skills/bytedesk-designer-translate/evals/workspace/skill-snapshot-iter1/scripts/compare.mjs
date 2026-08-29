// Compare two renders. usage: node compare.mjs <a.png> <b.png> <out-dir> [--grid 32x20] [--threshold 32]
// Writes <out-dir>/diff.png (b with differing pixels painted red) and <out-dir>/report.json:
//   pixelDiff   fraction of pixels differing by more than --threshold on any channel (strict; use for
//               surface ↔ implementation, where 0 is achievable because they share a stylesheet)
//   layoutScore 0..1 similarity of a coarse luminance grid (tolerant; use for surface ↔ mockup, where
//               generated text and grain make pixel numbers meaningless)
//   hotspots    the grid cells that differ most, as logical-pixel rects — the work list for the next round
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPng, writePng, resize } from "./png.mjs";
const args = process.argv.slice(2); const [pa, pb, outDir] = args;
if (!pa || !pb || !outDir) { console.error("usage: compare.mjs <a.png> <b.png> <out-dir> [--grid 32x20] [--threshold 32]"); process.exit(2); }
const opt = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const [gx, gy] = opt("--grid", "32x20").split("x").map(Number); const thr = Number(opt("--threshold", 32));
const masks = args.flatMap((v, i) => (v === "--mask" ? [args[i + 1].split(",").map(Number)] : []));
let a = readPng(pa), b = readPng(pb);
const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
if (a.width !== W || a.height !== H) a = resize(a, W, H);
if (b.width !== W || b.height !== H) b = resize(b, W, H);
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const cells = Array.from({ length: gx * gy }, () => ({ la: 0, lb: 0, n: 0, diff: 0 }));
let differing = 0, counted = 0; const out = Buffer.from(b.data);
const masked = (x, y) => masks.some(([mx, my, mw, mh]) => x >= mx && y >= my && x < mx + mw && y < my + mh);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  if (masked(x, y)) { out[i] = out[i + 1] = out[i + 2] = 64; continue; }
  counted++; const c = cells[Math.floor((y * gy) / H) * gx + Math.floor((x * gx) / W)];
  c.la += lum(a.data, i); c.lb += lum(b.data, i); c.n++;
  const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
  if (d > thr) { differing++; c.diff++; out[i] = 230; out[i + 1] = 34; out[i + 2] = 34; out[i + 3] = 255; }
}
const cellScores = cells.filter((c) => c.n > 0).map((c) => ({ k: cells.indexOf(c), x: cells.indexOf(c) % gx, y: Math.floor(cells.indexOf(c) / gx), lumDiff: Math.abs(c.la - c.lb) / c.n / 255, pixDiff: c.diff / c.n }));
const layoutScore = 1 - cellScores.reduce((s, c) => s + c.lumDiff, 0) / cellScores.length;
const hotspots = [...cellScores].sort((p, q) => q.lumDiff + q.pixDiff - (p.lumDiff + p.pixDiff)).slice(0, 8)
  .map((c) => ({ cell: `${c.x},${c.y}`, rect: { x: Math.round((c.x * W) / gx), y: Math.round((c.y * H) / gy), w: Math.round(W / gx), h: Math.round(H / gy) }, lumDiff: Number(c.lumDiff.toFixed(3)), pixDiff: Number(c.pixDiff.toFixed(3)) }));
mkdirSync(outDir, { recursive: true });
writePng(join(outDir, "diff.png"), { width: W, height: H, data: out });
const report = { a: pa, b: pb, size: `${W}x${H}`, pixelDiff: Number((differing / Math.max(1, counted)).toFixed(4)), masks, layoutScore: Number(layoutScore.toFixed(4)), threshold: thr, grid: `${gx}x${gy}`, hotspots };
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pixelDiff: report.pixelDiff, layoutScore: report.layoutScore, hotspots: hotspots.slice(0, 4).map((h) => h.cell) }));
