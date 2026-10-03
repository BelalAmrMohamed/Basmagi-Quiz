/* =========================================================
   public/src/components/telegram-bot-card/qr-svg-engine.js
   Dependency-free QR Code generator (byte mode, ECC L/M/Q/H,
   versions 1-40) that outputs inline SVG. Works fully offline.
   ========================================================= */

const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_IDX = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_PER_BLOCK = [
  [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
  [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
];
const NUM_BLOCKS = [
  [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
  [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
  [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
  [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],
];

function numRawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function numDataCodewords(ver, e) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
}

function toUtf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

// ---- Reed-Solomon over GF(256/0x11D) ----
function rsMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(deg) {
  const res = new Array(deg).fill(0);
  res[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) {
      res[j] = rsMul(res[j], root);
      if (j + 1 < deg) res[j] ^= res[j + 1];
    }
    root = rsMul(root, 2);
  }
  return res;
}
function rsRemainder(data, div) {
  const res = div.map(() => 0);
  for (const b of data) {
    const f = b ^ res.shift();
    res.push(0);
    div.forEach((c, i) => (res[i] ^= rsMul(c, f)));
  }
  return res;
}

function appendBits(bits, val, len) {
  for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
}

function buildCodewords(bytes, ver, e) {
  const bits = [];
  appendBits(bits, 4, 4); // byte mode
  appendBits(bits, bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => appendBits(bits, b, 8));
  const cap = numDataCodewords(ver, e) * 8;
  appendBits(bits, 0, Math.min(4, cap - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  // split into blocks, add ECC, interleave
  const nBlocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const rawCw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = nBlocks - (rawCw % nBlocks);
  const shortLen = Math.floor(rawCw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0); // placeholder to align interleave
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(blk[i]);
    });
  }
  return out;
}

function buildMatrix(codewords, ver, e) {
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => {
    mod[y][x] = d;
    fn[y][x] = true;
  };
  // timing
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // alignment
  const nAlign = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : nAlign ? Math.ceil((ver * 4 + 4) / (nAlign * 2 - 2)) * 2 : 0;
  const pos = [6];
  for (let p = size - 7; pos.length < nAlign; p -= step) pos.splice(1, 0, p);
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask) => {
    const data = (ECC_FORMAT_BITS["LMQH"[e]] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b2 = Math.floor(i / 3);
      set(a, b2, bit); set(b2, a, bit);
    }
  }
  // place data (zigzag)
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (!fn[y][x] && k < codewords.length * 8) {
          mod[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0;
          k++;
        }
      }
  }
  const maskFns = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fn[y][x] && maskFns[m](x, y)) mod[y][x] = !mod[y][x];
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const s = penalty(mod, size);
    if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return mod;
}

function penalty(mod, size) {
  let r = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) { run++; if (run === 5) r += 3; else if (run > 5) r++; }
      else run = 1;
    }
    // finder-like pattern
    const pat = [1,0,1,1,1,0,1];
    for (let i = 0; i + 7 <= size; i++) {
      if (pat.every((p, j) => (get(i + j) ? 1 : 0) === p)) {
        const lightL = i >= 4 && [1,2,3,4].every((d) => !get(i - d));
        const lightR = i + 11 <= size && [7,8,9,10].every((d) => !get(i + d));
        if (lightL || lightR) r += 40;
      }
    }
  };
  for (let y = 0; y < size; y++) line((i) => mod[y][i]);
  for (let x = 0; x < size; x++) line((i) => mod[i][x]);
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) r += 3;
    }
  let dark = 0;
  mod.forEach((row) => row.forEach((c) => { if (c) dark++; }));
  r += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
  return r;
}

/** Returns a boolean[][] module matrix for the given text. */
export function generateQrMatrix(text, ecc = "H") {
  const e = ECC_IDX[ecc] ?? 3;
  const bytes = toUtf8Bytes(String(text));
  let ver = 1;
  for (; ver <= 40; ver++) {
    const lenBits = ver < 10 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= numDataCodewords(ver, e) * 8) break;
  }
  if (ver > 40) throw new Error("QR: text too long");
  return buildMatrix(buildCodewords(bytes, ver, e), ver, e);
}

/**
 * Builds an inline SVG string.
 * options: { ecc='H', margin=2 (quiet zone, modules), color='#0b1b2b',
 *            background='transparent', logo=true, logoSvg (inner markup in 24x24 box),
 *            logoColor='#24A1DE', label }
 */
export function generateQrSvg(text, options = {}) {
  const { ecc = "H", margin = 2, color = "#0b1b2b", background = "transparent",
          logo = true, logoColor = "#24A1DE", label = "QR" } = options;
  const m = generateQrMatrix(text, ecc);
  const n = m.length;
  const total = n + margin * 2;
  // logo clear zone: odd module count, ≤ ~20% of width (safe under ECC H)
  let clear = 0;
  if (logo) { clear = Math.floor(n * 0.22); if (clear % 2 === 0) clear++; }
  const lo = Math.floor((n - clear) / 2), hi = lo + clear;
  let d = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!m[y][x]) continue;
      if (logo && x >= lo && x < hi && y >= lo && y < hi) continue;
      d += `M${x + margin},${y + margin}h1v1h-1z`;
    }
  let logoMarkup = "";
  if (logo) {
    const c = total / 2, r = (clear / 2) * 0.96;
    const s = clear * 0.62;
    logoMarkup =
      `<circle cx="${c}" cy="${c}" r="${r}" fill="${logoColor}"/>` +
      `<g transform="translate(${c - s / 2} ${c - s / 2}) scale(${s / 24})" fill="#fff">` +
      `<path d="M21.9 3.3 2.7 10.7c-1.3.5-1.3 1.3-.2 1.6l4.9 1.5 1.9 5.8c.2.6.1.8.7.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.3-.5-1.9-1.4-1.5ZM8.4 13.1l9.9-6.2c.5-.3.9-.1.5.2l-8.1 7.3-.3 3.4-2-4.7Z"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    (background !== "transparent" ? `<rect width="${total}" height="${total}" fill="${background}"/>` : "") +
    `<path d="${d}" fill="${color}"/>${logoMarkup}</svg>`;
}
