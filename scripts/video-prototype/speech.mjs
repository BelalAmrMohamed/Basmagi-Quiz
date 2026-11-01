// Prototype of the engine's narration builder: markdown -> runs [{lang,text}] with math spoken from KaTeX AST.
import katex from "katex";

const AR_ONES = ["صفر","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة","عشرة","أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
const AR_TENS = ["","","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
const AR_HUND = ["","مائة","مائتان","ثلاثمائة","أربعمائة","خمسمائة","ستمائة","سبعمائة","ثمانمائة","تسعمائة"];
function arInt(n) {
  if (n < 20) return AR_ONES[n];
  if (n < 100) { const o = n % 10, t = Math.floor(n / 10); return o ? `${AR_ONES[o]} و${AR_TENS[t]}` : AR_TENS[t]; }
  if (n < 1000) { const r = n % 100, h = Math.floor(n / 100); return r ? `${AR_HUND[h]} و${arInt(r)}` : AR_HUND[h]; }
  if (n < 1e6) { const r = n % 1000, k = Math.floor(n / 1000); const kw = k === 1 ? "ألف" : k === 2 ? "ألفان" : k < 11 ? `${arInt(k)} آلاف` : `${arInt(k)} ألف`; return r ? `${kw} و${arInt(r)}` : kw; }
  return String(n).split("").map((d) => AR_ONES[+d]).join(" ");
}
const EN_ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const EN_TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
function enInt(n) {
  if (n < 20) return EN_ONES[n];
  if (n < 100) return EN_TENS[Math.floor(n / 10)] + (n % 10 ? " " + EN_ONES[n % 10] : "");
  if (n < 1000) return EN_ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + enInt(n % 100) : "");
  if (n < 1e6) return enInt(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + enInt(n % 1000) : "");
  return String(n).split("").map((d) => EN_ONES[+d]).join(" ");
}
const AD = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" };
export function numWords(s, lang) {
  s = s.replace(/[٠-٩]/g, (c) => AD[c]);
  const neg = s.startsWith("-") || s.startsWith("−");
  s = s.replace(/^[-−]/, "");
  const [i, f] = s.split(".");
  const I = lang === "ar" ? arInt(+i) : enInt(+i);
  let out = I;
  if (f) out += (lang === "ar" ? " فاصلة " : " point ") + f.split("").map((d) => (lang === "ar" ? AR_ONES[+d] : EN_ONES[+d])).join(" ");
  return (neg ? (lang === "ar" ? "سالب " : "minus ") : "") + out;
}

// ---------------- math -> speech ----------------
const AR_LET = { a:"إيه",b:"بي",c:"سي",d:"دي",e:"إي",f:"إف",g:"جي",h:"إتش",i:"آي",j:"جيه",k:"كيه",l:"إل",m:"إم",n:"إن",o:"أو",p:"بي",q:"كيو",r:"آر",s:"إس",t:"تي",u:"يو",v:"في",w:"دابليو",x:"إكس",y:"واي",z:"زد" };
const GREEK = { "α":["ألفا","alpha"],"β":["بيتا","beta"],"γ":["جاما","gamma"],"δ":["دلتا","delta"],"ε":["إبسيلون","epsilon"],"θ":["ثيتا","theta"],"λ":["لامدا","lambda"],"μ":["ميو","mu"],"π":["باي","pi"],"σ":["سيجما","sigma"],"φ":["فاي","phi"],"ω":["أوميجا","omega"],"Δ":["دلتا","delta"],"Σ":["سيجما","sigma"],"Ω":["أوميجا","omega"] };
const SYM = {
  "+":["زائد","plus"],"−":["ناقص","minus"],"-":["ناقص","minus"],"±":["زائد أو ناقص","plus or minus"],"×":["ضرب في","times"],"⋅":["ضرب","times"],"·":["ضرب","times"],"÷":["قسمة","divided by"],
  "=":["يساوي","equals"],"≠":["لا يساوي","is not equal to"],"≤":["أصغر من أو يساوي","is less than or equal to"],"≥":["أكبر من أو يساوي","is greater than or equal to"],
  "<":["أصغر من","is less than"],">":["أكبر من","is greater than"],"≈":["يساوي تقريبًا","is approximately"],"→":["تؤول إلى","approaches"],"∞":["ما لا نهاية","infinity"],"∈":["ينتمي إلى","belongs to"],
  ",":["،",","],";":["؛",";"],"!":["مضروب","factorial"],"∂":["الجزئي","partial"],
};
const CMD = {"\\alpha":"α","\\beta":"β","\\gamma":"γ","\\delta":"δ","\\epsilon":"ε","\\varepsilon":"ε","\\theta":"θ","\\lambda":"λ","\\mu":"μ","\\pi":"π","\\sigma":"σ","\\phi":"φ","\\varphi":"φ","\\omega":"ω","\\Delta":"Δ","\\Sigma":"Σ","\\Omega":"Ω","\\pm":"±","\\times":"×","\\cdot":"⋅","\\div":"÷","\\neq":"≠","\\ne":"≠","\\le":"≤","\\leq":"≤","\\ge":"≥","\\geq":"≥","\\approx":"≈","\\to":"→","\\rightarrow":"→","\\infty":"∞","\\in":"∈","\\partial":"∂"};
const FUN = { "\\sin":["جا","sine of"],"\\cos":["جتا","cosine of"],"\\tan":["ظا","tangent of"],"\\ln":["لو الطبيعي","natural log of"],"\\log":["لو","log of"],"\\lim":["النهاية","the limit"],"\\int":["التكامل","the integral"],"\\sum":["المجموع","the sum"],"\\prod":["حاصل الضرب","the product"],"\\max":["القيمة العظمى","max"],"\\min":["القيمة الصغرى","min"] };

function isSimple(n) {
  if (!n) return true;
  const arr = Array.isArray(n) ? n : n.type === "ordgroup" ? n.body : [n];
  return arr.length <= 2 && arr.every((x) => ["mathord", "textord", "atom"].includes(x.type));
}

export function mathToSpeech(tex, lang) {
  const L = lang === "ar" ? 0 : 1;
  const tree = katex.__parse(tex, { throwOnError: true });
  const ctx = { L };
  return clean(seq(tree, ctx));
}
const clean = (s) => s.replace(/\s+/g, " ").replace(/\s+([،,.؛;])/g, "$1").trim();

function seq(nodes, c) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    // group consecutive digits/decimal point into one number
    if (n.type === "textord" && /^[0-9]$/.test(n.text)) {
      let j = i, s = "";
      while (j < nodes.length && nodes[j].type === "textord" && /^[0-9.]$/.test(nodes[j].text)) { s += nodes[j].text; j++; }
      out.push(numWords(s, c.L === 0 ? "ar" : "en")); i = j - 1; continue;
    }
    if (n.type === "atom" && n.family === "open") {
      let depth = 0, j = i;
      for (; j < nodes.length; j++) { if (nodes[j].type === "atom" && nodes[j].family === "open") depth++; if (nodes[j].type === "atom" && nodes[j].family === "close") { depth--; if (depth === 0) break; } }
      const inner = nodes.slice(i + 1, j);
      const hasOp = inner.some((x) => x.type === "atom" && ["bin", "rel"].includes(x.family));
      if (j < nodes.length && inner.length <= 3 && !hasOp) {
        const prev = nodes[i - 1];
        if (c.L === 1 && prev && ["mathord"].includes(prev.type) && /^[fgh]$/i.test(prev.text)) out.push("of");
        out.push(seq(inner, c)); i = j; continue;
      }
    }
    out.push(node(n, c));
  }
  return out.filter(Boolean).join(" ");
}
function sub(n, c) { if (!n) return ""; return n.type === "ordgroup" ? seq(n.body, c) : seq([n], c); }

function node(n, c) {
  const L = c.L;
  switch (n.type) {
    case "ordgroup": return seq(n.body, c);
    case "styling": case "font": return n.body ? (Array.isArray(n.body) ? seq(n.body, c) : sub(n.body, c)) : "";
    case "mathord": case "textord": {
      const t = CMD[n.text] ?? n.text;
      if (GREEK[t]) return GREEK[t][L];
      if (/^[a-zA-Z]$/.test(t)) return L === 0 ? AR_LET[t.toLowerCase()] : t.toLowerCase();
      if (/^[0-9]$/.test(t)) return numWords(t, L === 0 ? "ar" : "en");
      if (SYM[t]) return SYM[t][L];
      return "";
    }
    case "atom": {
      if (n.family === "open") return L === 0 ? "فتح قوس" : "open paren";
      if (n.family === "close") return L === 0 ? "غلق قوس" : "close paren";
      return SYM[CMD[n.text] ?? n.text]?.[L] ?? "";
    }
    case "spacing": case "kern": case "color": case "internal": return n.type === "color" ? seq(n.body, c) : "";
    case "text": return seq(n.body, c);
    case "accent": {
      const b = sub(n.base, c);
      const m = { "\\bar": ["بار", "bar"], "\\hat": ["هات", "hat"], "\\vec": ["متجه", "vector"], "\\dot": ["نقطة", "dot"], "\\tilde": ["تيلدا", "tilde"] }[n.label];
      return m ? (L === 0 ? `${m[0]} ${b}` : `${b} ${m[1]}`) : b;
    }
    case "leftright": return `${L === 0 ? "فتح قوس" : "open paren"} ${seq(n.body, c)} ${L === 0 ? "غلق قوس" : "close paren"}`;
    case "genfrac": {
      const a = sub(n.numer, c), b = sub(n.denom, c);
      const nn = n.numer.type === "ordgroup" ? n.numer.body : [n.numer], dd = n.denom.type === "ordgroup" ? n.denom.body : [n.denom];
      if (nn.length === 1 && /^(d|\\partial)$/.test(nn[0].text||"") && dd.length === 2 && /^(d|\\partial)$/.test(dd[0].text||"")) { const v = node(dd[1], c); return L === 0 ? `المشتقة بالنسبة إلى ${v} للمقدار` : `the derivative with respect to ${v} of`; }
      if (!n.hasBarLine) return L === 0 ? `توافيق ${a} من ${b}` : `${a} choose ${b}`;
      if (isSimple(n.numer) && isSimple(n.denom)) return L === 0 ? `${a} على ${b}` : `${a} over ${b}`;
      return L === 0 ? `الكسر الذي بسطه ${a}. ومقامه ${b}. نهاية الكسر` : `the fraction with numerator ${a}. and denominator ${b}. end fraction`;
    }
    case "sqrt": {
      const b = sub(n.body, c);
      const idx = n.index ? sub(n.index, c) : "";
      if (idx === (L === 0 ? "ثلاثة" : "three")) return L === 0 ? `الجذر التكعيبي للمقدار ${b}` : `the cube root of ${b}`;
      if (idx) return L === 0 ? `الجذر ${idx} للمقدار ${b}` : `the ${idx}-th root of ${b}`;
      const simple = isSimple(n.body);
      return L === 0 ? `الجذر التربيعي للمقدار ${b}${simple ? "" : ". نهاية الجذر"}` : `the square root of ${b}${simple ? "" : ". end root"}`;
    }
    case "supsub": {
      const base = n.base, sup = n.sup, sb = n.sub;
      if (base?.type === "op" || base?.type === "operatorname") return opWithLimits(base, sb, sup, c);
      const b = base ? sub(base, c) : "";
      let out = b;
      if (sb) out += L === 0 ? ` ${sub(sb, c)}` : ` sub ${sub(sb, c)}`;
      if (sup) {
        const s = sub(sup, c);
        const two = L === 0 ? "اثنان" : "two", three = L === 0 ? "ثلاثة" : "three";
        if (s === two) out += L === 0 ? " تربيع" : " squared";
        else if (s === three) out += L === 0 ? " تكعيب" : " cubed";
        else out += L === 0 ? ` أس ${s}` : ` to the power ${s}`;
      }
      return out;
    }
    case "op": return opWithLimits(n, null, null, c);
    case "operatorname": return sub({ type: "ordgroup", body: n.body }, c);
    case "array": {
      const rows = n.body.map((r) => r.map((cell) => sub(cell, c)).filter(Boolean).join(" "));
      return rows.join(L === 0 ? ". ثم " : ". then ");
    }
    case "delimsizing": return "";
    case "mclass": case "lap": case "phantom": case "hphantom": return n.body ? sub(n.body, c) : "";
    case "supsub-limits": return "";
    default: return n.body ? (Array.isArray(n.body) ? seq(n.body, c) : sub(n.body, c)) : "";
  }
}
function opWithLimits(op, lo, hi, c) {
  const L = c.L;
  const name = op.name || "";
  const f = FUN[name]?.[L] ?? name.replace("\\", "");
  const fmt = L === 0 ? { from: "من", to: "إلى", of: "للمقدار", ap: "عندما" } : { from: "from", to: "to", of: "of", ap: "as" };
  if (name === "\\int") return `${f} ${lo ? `${fmt.from} ${sub(lo, c)}` : ""} ${hi ? `${fmt.to} ${sub(hi, c)}` : ""} ${fmt.of}`.replace(/\s+/g, " ");
  if (name === "\\sum" || name === "\\prod") return `${f} ${lo ? `${fmt.from} ${sub(lo, c)}` : ""} ${hi ? `${fmt.to} ${sub(hi, c)}` : ""} ${fmt.of}`.replace(/\s+/g, " ");
  if (name === "\\lim") return `${f} ${lo ? `${L === 0 ? "عندما" : "as"} ${sub(lo, c)}` : ""} ${L === 0 ? "للمقدار" : "of"}`.replace(/\s+/g, " ");
  return f;
}

// ---------------- markdown -> runs ----------------
const AR_RE = /[؀-ۿ]/;
const LAT_RE = /[A-Za-z]/;
export function narrate(md, lessonLang = "ar", opts = {}) {
  const mathLang = opts.mathLang || lessonLang;
  const parts = [];
  // split on math: $$..$$ , \[..\] , $..$ , \(..\)
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
  let last = 0, m;
  while ((m = re.exec(md))) {
    if (m.index > last) parts.push({ t: "text", v: md.slice(last, m.index) });
    parts.push({ t: "math", v: (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), display: m[1] != null || m[2] != null });
    last = re.lastIndex;
  }
  if (last < md.length) parts.push({ t: "text", v: md.slice(last) });
  const runs = [];
  const push = (lang, text) => {
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.lang === lang) prev.text += " " + text; else runs.push({ lang, text });
  };
  let ctxLang = lessonLang;
  for (const p of parts) {
    if (p.t === "math") {
      push(mathLang === "ar" ? "ar" : "en", (p.display ? (mathLang === "ar" ? "، " : ", ") : "") + mathToSpeech(p.v, mathLang) + (p.display ? " ." : ""));
      continue;
    }
    let txt = p.v
      .replace(/\s\*\s/g, " times ")
      .replace(/^#{1,6}\s*/gm, "").replace(/[*_`>]+/g, (x) => (x.includes("_") ? " " : " ")).replace(/^\s*[-•]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "");
    // pseudo formulas in Latin text
    txt = txt.replace(/\s=\s/g, " equals ").replace(/\s-\s/g, " minus ").replace(/\s\*\s/g, " times ").replace(/\s\/\s/g, " divided by ");
    txt = txt.replace(/[()\[\]]/g, " ، ").replace(/ـ/g, "ـ");
    const toks = txt.split(/\s+/).filter(Boolean);
    let cur = ctxLang;
    for (let ti = 0; ti < toks.length; ti++) {
      const tok = toks[ti];
      // bare Arabic article/prefix before a Latin word (e.g. "الـ discriminant"): TTS garbles a lone "ال", so drop it
      if (/^[وفبلك]?ال[ـ]?$/.test(tok) && LAT_RE.test(toks[ti + 1] || "")) continue;
      if (/^[،,.؛:؟?!]+$/.test(tok)) { push(runs.at(-1)?.lang ?? cur, tok); continue; }
      if (AR_RE.test(tok)) { cur = "ar"; push("ar", tok); continue; }
      if (LAT_RE.test(tok)) { cur = "en"; push("en", tok.replace(/_/g, " ")); continue; }
      if (/[0-9٠-٩]/.test(tok)) { push(cur, tok.replace(/[0-9٠-٩.]+/g, (x) => numWords(x, cur))); continue; }
      push(cur, tok);
    }
    ctxLang = cur;
  }
  return runs;
}
