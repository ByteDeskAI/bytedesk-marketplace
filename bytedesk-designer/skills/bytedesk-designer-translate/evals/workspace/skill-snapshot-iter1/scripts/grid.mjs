// Overlay a measuring grid on a mockup so measurements are counted, not guessed.
// usage: node grid.mjs <mockup.png> <out.png> [--logical 1280]
// Minor lines every 20 logical px, major every 100, at the mockup's own scale. Prints the
// scale factor so a measurement read off the grid converts to logical (CSS) pixels directly.
import { readPng, writePng } from "./png.mjs";
const [src, out, ...rest] = process.argv.slice(2);
if (!src || !out) { console.error("usage: grid.mjs <mockup.png> <out.png> [--logical 1280]"); process.exit(2); }
const logical = Number(rest[rest.indexOf("--logical") + 1]) || 1280;
const img = readPng(src);
const scale = img.width / logical; // mockup px per logical px
const put = (x, y, r, g, b, a) => { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; img.data[i] = (img.data[i] * (255 - a) + r * a) / 255; img.data[i + 1] = (img.data[i + 1] * (255 - a) + g * a) / 255; img.data[i + 2] = (img.data[i + 2] * (255 - a) + b * a) / 255; };
for (let lx = 0; lx <= logical; lx += 20) {
  const x = Math.round(lx * scale), major = lx % 100 === 0;
  for (let y = 0; y < img.height; y++) put(x, y, major ? 236 : 120, major ? 78 : 160, major ? 2 : 255, major ? 150 : 60);
}
for (let ly = 0; ly * scale <= img.height; ly += 20) {
  const y = Math.round(ly * scale), major = ly % 100 === 0;
  for (let x = 0; x < img.width; x++) put(x, y, major ? 236 : 120, major ? 78 : 160, major ? 2 : 255, major ? 150 : 60);
}
// tick marks: a short notch every 100 logical px along the top and left edges, thicker every 500
for (let lx = 0; lx <= logical; lx += 100) for (let y = 0; y < 14; y++) for (let dx = -(lx % 500 === 0 ? 2 : 0); dx <= (lx % 500 === 0 ? 2 : 0); dx++) put(Math.round(lx * scale) + dx, y, 255, 255, 255, 255);
for (let ly = 0; ly * scale <= img.height; ly += 100) for (let x = 0; x < 14; x++) for (let dy = -(ly % 500 === 0 ? 2 : 0); dy <= (ly % 500 === 0 ? 2 : 0); dy++) put(x, Math.round(ly * scale) + dy, 255, 255, 255, 255);
writePng(out, img);
console.log(JSON.stringify({ source: src, width: img.width, height: img.height, logicalWidth: logical, logicalHeight: Math.round(img.height / scale), scale: Number(scale.toFixed(4)), note: "orange = 100 logical px, blue = 20; thick white ticks every 500" }));
