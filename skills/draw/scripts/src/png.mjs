/**
 * Just enough PNG to cut a draw.io desktop export into tiles without a native image
 * library: read the size from the header, decode the non-interlaced 8- or 16-bit images
 * Chromium and Electron write, crop a region, and write it back with no filtering.
 */
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Samples per pixel by colour type: grey, RGB, palette index, grey+alpha, RGBA. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Pixel size of a PNG from its header. */
export function pngSize(file) {
  const head = readFileSync(file).subarray(16, 24);
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

function* chunks(buf) {
  let at = 8;
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    yield { type, data: buf.subarray(at + 8, at + 8 + length) };
    at += 12 + length;
  }
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Decode a PNG into unfiltered rows of `bpp` bytes per pixel. Palette and transparency
 * chunks are kept so a crop keeps its colours. Interlaced and sub-byte images are refused.
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number, bpp: number, pixels: Buffer, extra: Array<{ type: string, data: Buffer }> }}
 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let header; const idat = []; const extra = [];
  for (const c of chunks(buf)) {
    if (c.type === 'IHDR') header = c.data;
    else if (c.type === 'IDAT') idat.push(c.data);
    else if (c.type === 'PLTE' || c.type === 'tRNS') extra.push(c);
    else if (c.type === 'IEND') break;
  }
  if (!header) throw new Error('PNG without a header');
  const width = header.readUInt32BE(0); const height = header.readUInt32BE(4);
  const bitDepth = header[8]; const colorType = header[9]; const interlace = header[12];
  if (!(bitDepth === 8 || bitDepth === 16) || interlace !== 0 || !(colorType in CHANNELS)) {
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`);
  }
  const bpp = (CHANNELS[colorType] * bitDepth) / 8;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG data');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    if (filter === 0) { src.copy(row); continue; }
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`unknown PNG filter ${filter}`);
      row[i] = v & 0xff;
    }
  }
  return { width, height, bitDepth, colorType, bpp, pixels, extra };
}

/** The pixels of `png` inside `clip` (which must lie within the image) as a new image. */
export function cropPng(png, clip) {
  const { x, y, width, height } = clip;
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > png.width || y + height > png.height) {
    throw new Error(`crop ${width}x${height} at ${x},${y} is outside the ${png.width}x${png.height} image`);
  }
  const stride = width * png.bpp;
  const pixels = Buffer.alloc(height * stride);
  for (let r = 0; r < height; r++) {
    const from = ((y + r) * png.width + x) * png.bpp;
    png.pixels.copy(pixels, r * stride, from, from + stride);
  }
  return { ...png, width, height, pixels };
}

/** Encode an image as returned by `decodePng` or `cropPng`; rows are stored unfiltered. */
export function encodePng(png) {
  const stride = png.width * png.bpp;
  const raw = Buffer.alloc(png.height * (stride + 1));
  for (let y = 0; y < png.height; y++) {
    raw[y * (stride + 1)] = 0;
    png.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(png.width, 0);
  header.writeUInt32BE(png.height, 4);
  header[8] = png.bitDepth; header[9] = png.colorType; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...(png.extra ?? []).map((c) => chunk(c.type, c.data)),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
