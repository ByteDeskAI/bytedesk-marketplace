// Minimal PNG codec: 8-bit RGB/RGBA, non-interlaced (what Playwright and image_gen write).
// Dependency-free on purpose — the skill must run on a fresh machine with only node.
import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

export function readPng(path) {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`${path}: not a PNG`);
  let pos = 8, width = 0, height = 0, channels = 0, depth = 0, interlace = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString("ascii", pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; channels = { 2: 3, 6: 4, 0: 1, 4: 2 }[data[9]]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || !channels) throw new Error(`${path}: only 8-bit non-interlaced PNGs are supported`);
  const raw = inflateSync(Buffer.concat(idat)); const stride = width * channels; const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride), off = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[off++]; const line = Buffer.from(raw.subarray(off, off + stride)); off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      if (channels >= 3) { out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = channels === 4 ? line[s + 3] : 255; }
      else { out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = channels === 2 ? line[s + 1] : 255; }
    }
    prev = line;
  }
  return { width, height, data: out };
}

export function writePng(path, { width, height, data }) {
  const chunk = (type, body) => { const t = Buffer.from(type, "ascii"); const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body]))); return Buffer.concat([len, t, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  writeFileSync(path, Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** Nearest-neighbour resize to width×height. */
export function resize(img, width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(img.width - 1, Math.floor((x * img.width) / width)), sy = Math.min(img.height - 1, Math.floor((y * img.height) / height));
    img.data.copy(data, (y * width + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
  }
  return { width, height, data };
}
