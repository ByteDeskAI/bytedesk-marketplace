/**
 * Everything a PWA needs that Vite does not emit: the manifest, the icons, and
 * the service worker with the real build's asset hashes baked into it.
 *
 * Runs after `vite build`. Node stdlib only — the PNGs are encoded here rather
 * than pasted in as blobs, so the icon set is a function of the colours below
 * and a reviewer can see what they are getting.
 *
 *   node build-pwa.mjs
 */
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

// ByteDesk design tokens, read from the vendored DTCG file rather than pasted in: the
// icons and the manifest are then a function of the design system, and `bd-design sync`
// moves them with it. index.html carries the same pair as media-queried theme-color.
const TOKENS = JSON.parse(
  readFileSync(join(HERE, "..", "..", ".context", "design-system", "tokens", "bytedesk.tokens.json"), "utf8"),
);
const token = (path) => path.split(".").reduce((o, k) => o[k], TOKENS).$value;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const BRAND = rgb(token("color.interactive.blue")); // the family's one action colour
const INK = rgb(token("color.text.on-brand"));
const THEME = token("color.interactive.blue");
const BACKGROUND = token("color.bg.base"); // the app is dark by default; light is the counterpart

// ── PNG ──────────────────────────────────────────────────────────────────────
const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** @param {Buffer} rgba raw size*size*4 pixels */
function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // Filter byte 0 per scanline: flat colour deflates to nothing anyway.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── the mark ─────────────────────────────────────────────────────────────────
/**
 * Three columns with cards in them: the board, at 24 pixels or 512. Drawn rather
 * than rasterised — the shapes are rectangles, so an SVG renderer would be a
 * dependency bought for nothing.
 *
 * `bleed` fills the whole square for the maskable variant, where the platform
 * applies its own shape and anything in the corners is expected to be lost.
 */
function icon(size, { bleed = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const radius = bleed ? 0 : size * 0.22;
  const set = (x, y, rgb, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
    px[i + 3] = a;
  };
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (inRounded(x + 0.5, y + 0.5)) set(x, y, BRAND);
  }

  // Safe zone: a maskable icon keeps its content inside the middle 80%.
  const inset = bleed ? size * 0.28 : size * 0.22;
  const span = size - inset * 2;
  const gap = span * 0.09;
  const colW = (span - gap * 2) / 3;
  const cardH = span * 0.17;
  const cardGap = span * 0.09;
  const counts = [3, 2, 1]; // in progress, blocked, done — a board mid-flight
  const rect = (x0, y0, w, h, r) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dx = Math.min(x + 0.5 - (x0 + r), 0) || Math.max(x + 0.5 - (x0 + w - r), 0);
        const dy = Math.min(y + 0.5 - (y0 + r), 0) || Math.max(y + 0.5 - (y0 + h - r), 0);
        if (dx * dx + dy * dy <= r * r) set(x, y, INK);
      }
    }
  };
  // Centred on the tallest column, so the mark sits in the middle of the square
  // rather than hanging off the top of it.
  const top = inset + (span - (Math.max(...counts) * cardH + (Math.max(...counts) - 1) * cardGap)) / 2;
  counts.forEach((n, col) => {
    for (let i = 0; i < n; i++) {
      rect(inset + col * (colW + gap), top + i * (cardH + cardGap), colW, cardH, Math.max(1, size * 0.02));
    }
  });
  return png(px, size);
}

// ── emit ─────────────────────────────────────────────────────────────────────
mkdirSync(join(DIST, "icons"), { recursive: true });
const icons = [
  { file: "icon-192.png", size: 192, purpose: "any" },
  { file: "icon-512.png", size: 512, purpose: "any" },
  { file: "maskable-512.png", size: 512, purpose: "maskable", bleed: true },
];
for (const i of icons) writeFileSync(join(DIST, "icons", i.file), icon(i.size, { bleed: i.bleed }));

const manifest = {
  name: "task-management board",
  short_name: "tm board",
  description: "The live board for this project: epics, tasks, claims and the agents holding them.",
  start_url: "/",
  scope: "/",
  id: "/",
  display: "standalone",
  orientation: "any",
  theme_color: THEME,
  background_color: BACKGROUND,
  categories: ["productivity", "developer"],
  icons: icons.map((i) => ({
    src: `/icons/${i.file}`,
    sizes: `${i.size}x${i.size}`,
    type: "image/png",
    purpose: i.purpose,
  })),
};
writeFileSync(join(DIST, "manifest.webmanifest"), JSON.stringify(manifest));

// The precache list is the build's own output — hashed names, so a stale entry
// is impossible by construction, and the version is a digest of the list.
// Everything Vite emitted — the lazy screen chunks included, so a route first opened
// offline still renders — plus the self-hosted fonts, which a CSP-forbidden CDN can't serve.
const assets = readdirSync(join(DIST, "assets")).map((f) => `/assets/${f}`);
const fonts = existsSync(join(DIST, "fonts"))
  ? readdirSync(join(DIST, "fonts")).filter((f) => f.endsWith(".woff2")).map((f) => `/fonts/${f}`)
  : [];
const precache = ["/", "/index.html", "/manifest.webmanifest", ...assets, ...fonts, ...icons.map((i) => `/icons/${i.file}`)];
const version = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 12);

const sw = readFileSync(join(HERE, "sw.js"), "utf8")
  .replaceAll("__VERSION__", version)
  .replaceAll("__PRECACHE__", JSON.stringify(precache));

// A worker with a token left in it throws ReferenceError on install and never
// registers — silently, because nothing else in the build depends on it. Fail
// the build here rather than ship an app that quietly stopped working offline.
const leftover = sw.match(/__[A-Z_]+__/);
if (leftover) throw new Error(`build-pwa: ${leftover[0]} was not substituted in sw.js`);
writeFileSync(join(DIST, "sw.js"), sw);

process.stdout.write(`pwa: ${icons.length} icons, manifest, sw.js (${precache.length} precached, ${version})\n`);
