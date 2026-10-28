// =============================================================================
// api/_arabicShape.js
//
// Pre-shapes Arabic text for Satori / @vercel/og (the profile share card).
//
// Why: Satori measures an Arabic word from un-joined glyph advances but paints
// it with joined forms, so words get uneven gaps (and neighbouring boxes can
// even overlap). Feeding it text that is ALREADY shaped and in visual order
// sidesteps that: every character is a fixed-width presentation-form glyph
// (U+FE70–FEFC), so measured width == painted width.
//
// What `toVisual(text)` does (RTL paragraph):
//   1. strips Arabic diacritics (tashkeel) — combining marks cannot be
//      positioned on presentation-form glyphs by Satori;
//   2. classifies characters (Arabic / Latin+digits / neutral) and resolves
//      neutrals the way the Unicode bidi algorithm does for an RTL base;
//   3. joins Arabic letters into isolated/initial/medial/final forms, with the
//      lam-alef ligatures;
//   4. emits the line in visual left-to-right order, so the result is drawn as
//      a plain LTR string (direction: ltr).
//
// Pure functions, no dependencies — safe for the Edge runtime.
// =============================================================================

// [isolated, final, initial, medial] — initial/medial omitted for right-joining
// letters (they never connect to the following letter).
//
// NOTE: the isolated slot is documentation only. Tajawal (the card's font)
// ships the initial/medial/final presentation forms and the lam-alef
// ligatures in its cmap but NOT the isolated forms (U+FE80…FEF1 odd slots) —
// those would render as tofu — so an isolated letter is emitted as its plain
// base character (U+0621…064A), which the font draws in isolated shape.
const FORMS = {
  0x0621: [0xfe80],
  0x0622: [0xfe81, 0xfe82],
  0x0623: [0xfe83, 0xfe84],
  0x0624: [0xfe85, 0xfe86],
  0x0625: [0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa],
  0x0630: [0xfeab, 0xfeac],
  0x0631: [0xfead, 0xfeae],
  0x0632: [0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee],
  0x0649: [0xfeef, 0xfef0],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};

// lam + alef variants → [isolated, final]
const LAM = 0x0644;
const LAM_ALEF = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

const TATWEEL = 0x0640;
const MARK_RE = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const MIRROR = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«" };

const isArabicLetter = (cp) => cp === TATWEEL || (cp >= 0x0621 && cp <= 0x064a && FORMS[cp] !== undefined);
// Letters that can connect to the letter AFTER them (dual-joining).
const joinsNext = (cp) => cp === TATWEEL || (FORMS[cp] !== undefined && FORMS[cp].length === 4);
// Letters that can connect to the letter BEFORE them.
const joinsPrev = (cp) => cp === TATWEEL || FORMS[cp] !== undefined;

// Character classes for the simplified bidi pass.
const AR = 1;
const LT = 2;
const NEU = 3;

function classify(ch) {
  const cp = ch.codePointAt(0);
  if (isArabicLetter(cp) || (cp >= 0x0600 && cp <= 0x06ff && /\p{L}/u.test(ch))) return AR;
  if (/[\p{L}\p{N}]/u.test(ch)) return LT; // Latin, digits (incl. Arabic-Indic), other scripts
  return NEU;
}

/** Joins a run of consecutive Arabic letters (logical order) into presentation forms. */
function shapeArabicRun(cps) {
  const out = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    const prev = i > 0 ? cps[i - 1] : 0;
    const connectsPrev = i > 0 && joinsNext(prev) && joinsPrev(cp);

    if (cp === TATWEEL) {
      out.push(cp);
      continue;
    }
    // lam + alef ligature
    if (cp === LAM && i + 1 < cps.length && LAM_ALEF[cps[i + 1]]) {
      const [iso, fin] = LAM_ALEF[cps[i + 1]];
      out.push(connectsPrev ? fin : iso);
      i++;
      continue;
    }
    const f = FORMS[cp];
    if (!f) {
      out.push(cp);
      continue;
    }
    const connectsNext = i + 1 < cps.length && joinsNext(cp) && joinsPrev(cps[i + 1]);
    let form;
    if (f.length === 1) form = cp;
    else if (f.length === 2) form = connectsPrev ? f[1] : cp;
    else if (connectsPrev && connectsNext) form = f[3];
    else if (connectsPrev) form = f[1];
    else if (connectsNext) form = f[2];
    else form = cp;
    out.push(form);
  }
  return out;
}

/**
 * Logical Arabic/mixed text → string in visual (left-to-right) order, shaped.
 * Intended for a single already-wrapped line.
 */
export function toVisual(text) {
  const input = String(text ?? "");
  // No Arabic at all → a plain LTR paragraph; nothing to shape or reorder.
  if (!/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(input)) return input;
  const chars = Array.from(input.replace(MARK_RE, ""));
  if (chars.length === 0) return "";

  // 1. classify
  const cls = chars.map(classify);

  // 2. resolve neutrals: between two LTR chars → LTR, otherwise follow the RTL base.
  const res = cls.slice();
  for (let i = 0; i < res.length; ) {
    if (cls[i] !== NEU) {
      i++;
      continue;
    }
    let j = i;
    while (j < cls.length && cls[j] === NEU) j++;
    const before = i > 0 ? cls[i - 1] : 0;
    const after = j < cls.length ? cls[j] : 0;
    const type = before === LT && after === LT ? LT : AR; // AR here == "RTL neutral"
    for (let k = i; k < j; k++) res[k] = type;
    i = j;
  }

  // 3. group into directional runs (RTL = Arabic letters + RTL neutrals)
  const runs = [];
  for (let i = 0; i < chars.length; ) {
    const rtl = res[i] === AR;
    let j = i;
    while (j < chars.length && (res[j] === AR) === rtl) j++;
    runs.push({ rtl, start: i, end: j });
    i = j;
  }

  // 4. emit in visual order: runs reversed (RTL paragraph); RTL runs shaped + reversed
  const visual = [];
  for (let r = runs.length - 1; r >= 0; r--) {
    const { rtl, start, end } = runs[r];
    if (!rtl) {
      visual.push(chars.slice(start, end).join(""));
      continue;
    }
    // shape each maximal Arabic-letter stretch inside the run, keep neutrals as-is
    const shaped = [];
    for (let i = start; i < end; ) {
      if (cls[i] === AR) {
        let j = i;
        while (j < end && cls[j] === AR) j++;
        const cps = chars.slice(i, j).map((c) => c.codePointAt(0));
        for (const cp of shapeArabicRun(cps)) shaped.push(String.fromCodePoint(cp));
        i = j;
      } else {
        shaped.push(MIRROR[chars[i]] ?? chars[i]);
        i++;
      }
    }
    visual.push(shaped.reverse().join(""));
  }
  return visual.join("");
}

/** True when the string contains any Arabic-script letter. */
export function hasArabic(text) {
  return /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(String(text ?? ""));
}
