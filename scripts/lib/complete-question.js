// public/src/shared/complete-question.js
// "Complete" (fill-in-the-blank) question helpers, shared by the quiz page, the
// lesson page, the editors, the content rules and the MCP server.
//
// Authoring syntax (stored as-is in the question text):
//   {{answer}}  or  {{answer|alt1|alt2}}     "\{{" = literal "{{", "\|" = literal pipe
// Blanks inside code (fenced / inline) and math ($..$, $$..$$) are ignored.
//
// NOTE: parseComplete and gradeComplete are embedded into generated standalone
// files through `fn.toString()` (export-to-quiz.js, lesson-download.js), so they
// must stay SELF-CONTAINED: no imports and no helpers/constants outside the body.
// gradeComplete does not call parseComplete on purpose.

/** Private-use markers that replace a blank before markdown rendering. */
export const COMPLETE_TOKEN_OPEN = "\uE000";
export const COMPLETE_TOKEN_CLOSE = "\uE001";

/**
 * @param {string} text
 * @returns {{ marked: string, blanks: Array<{answers: string[]}>, errors: Array<{code: string, message: string, blank?: number}> }}
 */
export function parseComplete(text) {
  const src = String(text ?? "");
  const blanks = [];
  const errors = [];
  let out = "";
  let i = 0;
  const n = src.length;
  const copyUntil = (end) => {
    out += src.slice(i, end);
    i = end;
  };
  while (i < n) {
    const rest = src.slice(i);
    // fenced code block
    if (rest.startsWith("```")) {
      const close = src.indexOf("```", i + 3);
      copyUntil(close === -1 ? n : close + 3);
      continue;
    }
    // inline code
    if (src[i] === "`") {
      const close = src.indexOf("`", i + 1);
      const nl = src.indexOf("\n", i + 1);
      if (close !== -1 && (nl === -1 || close < nl)) {
        copyUntil(close + 1);
        continue;
      }
    }
    // display math
    if (rest.startsWith("$$")) {
      const close = src.indexOf("$$", i + 2);
      if (close !== -1) {
        copyUntil(close + 2);
        continue;
      }
    }
    // inline math (closing $ must be on the same line)
    if (src[i] === "$") {
      const close = src.indexOf("$", i + 1);
      const nl = src.indexOf("\n", i + 1);
      if (close !== -1 && (nl === -1 || close < nl)) {
        copyUntil(close + 1);
        continue;
      }
    }
    // escaped opener: \{{ -> literal {{
    if (rest.startsWith("\\{{")) {
      out += "{{";
      i += 3;
      continue;
    }
    if (rest.startsWith("{{")) {
      const close = src.indexOf("}}", i + 2);
      if (close === -1) {
        errors.push({ code: "COMPLETE_SYNTAX", message: "فتحة {{ بلا إغلاق }}." });
        out += src.slice(i);
        i = n;
        break;
      }
      const inner = src.slice(i + 2, close);
      // split on unescaped pipes
      const answers = [];
      let cur = "";
      for (let k = 0; k < inner.length; k++) {
        if (inner[k] === "\\" && inner[k + 1] === "|") {
          cur += "|";
          k++;
        } else if (inner[k] === "|") {
          answers.push(cur.trim());
          cur = "";
        } else cur += inner[k];
      }
      answers.push(cur.trim());
      const idx = blanks.length;
      if (answers.some((a) => !a)) {
        errors.push({
          code: "COMPLETE_BLANK_EMPTY",
          message: `الفراغ ${idx + 1} يحتوي إجابة فارغة.`,
          blank: idx,
        });
      }
      blanks.push({ answers: answers.filter(Boolean) });
      out += "\uE000" + idx + "\uE001";
      i = close + 2;
      continue;
    }
    out += src[i];
    i++;
  }
  return { marked: out, blanks, errors };
}

/**
 * Grades each blank. `blanks` is parseComplete(text).blanks.
 * @param {Array<{answers: string[]}>} blanks
 * @param {Array<string>|null|undefined} userAnswers
 * @param {boolean} [strict]  true: only trim/collapse spaces; false: lenient (case, Arabic diacritics, alef forms, digits)
 * @returns {{ total: number, correct: number, earned: number, allCorrect: boolean, answered: number, perBlank: Array<{given: string, ok: boolean, empty: boolean, expected: string}> }}
 */
export function gradeComplete(blanks, userAnswers, strict) {
  const norm = (raw) => {
    let s = String(raw ?? "");
    if (strict) return s.replace(/\s+/g, " ").trim();
    return s
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .normalize("NFKC")
      .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
      .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
      .replace(/\u0649/g, "\u064a")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  };
  const list = Array.isArray(blanks) ? blanks : [];
  const ua = Array.isArray(userAnswers) ? userAnswers : [];
  const perBlank = list.map((b, i) => {
    const given = String(ua[i] ?? "");
    const empty = !given.trim();
    const answers = (b && b.answers) || [];
    const g = norm(given);
    const ok = !empty && answers.some((a) => norm(a) === g);
    return { given, ok, empty, expected: String(answers[0] ?? "") };
  });
  const total = perBlank.length;
  const correct = perBlank.filter((p) => p.ok).length;
  const answered = perBlank.filter((p) => !p.empty).length;
  return {
    total,
    correct,
    answered,
    earned: total ? correct / total : 0,
    allCorrect: total > 0 && correct === total,
    perBlank,
  };
}

/** Replaces every blank with "_____" (static exports, plain-text previews). */
export function completeToPlain(text) {
  return parseComplete(text).marked.replace(/\uE000\d+\uE001/g, "_____");
}

/** "1) a / b   2) c" answer-key line for static exports. */
export function completeAnswerKey(text) {
  return parseComplete(text)
    .blanks.map((b, i) => `${i + 1}) ${b.answers.join(" / ")}`)
    .join("   ");
}

/** Replaces each {{a|b}} with its first answer (used when converting away from Complete). */
export function completeToFirstAnswers(text) {
  const p = parseComplete(text);
  return p.marked.replace(/\uE000(\d+)\uE001/g, (_, i) => p.blanks[Number(i)]?.answers[0] ?? "");
}

/**
 * HTML helper: turns marker tokens in already-rendered markdown HTML into inputs.
 * `blanks` = parseComplete(text).blanks, `values` = saved answers. When `perBlank`
 * (gradeComplete().perBlank) is given the inputs start in their graded state.
 * Every blank also gets a hidden "expected answer" chip; CSS shows it only next to a
 * wrong input, so locking a question is a pure class toggle (no re-render).
 */
export function completeInputsHtml(html, { blanks = [], values = [], locked = false, perBlank = null } = {}) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return String(html)
    .replace(/\uE000(\d+)\uE001/g, (_, i) => {
      const idx = Number(i);
      const st = locked ? perBlank?.[idx] : null;
      const cls = st ? (st.ok ? " is-correct" : " is-wrong") : "";
      const expected = esc(blanks[idx]?.answers?.[0] ?? "");
      return `<span class="complete-blank-wrap"><input type="text" class="complete-blank${cls}" data-blank="${idx}" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="فراغ ${idx + 1}" value="${esc(values[idx] ?? "")}"${locked ? " disabled" : ""}><span class="complete-expected" dir="auto">${expected}</span></span>`;
    })
    .replace(/[\uE000\uE001]/g, "");
}

/**
 * Static exports (HTML results, Markdown, PDF, Word, PowerPoint, standalone quiz) have no
 * fill-in-the-blank runtime. Degrade each Complete question to an open question whose model
 * answer is the answers key, and each saved blank list to readable text.
 * Returns the inputs untouched when no Complete question is present.
 */
export function degradeCompleteForExport(questions, userAnswers) {
  if (!Array.isArray(questions) || !questions.some((q) => q?.questionKind === "complete")) {
    return { questions, userAnswers };
  }
  const ua = Array.isArray(userAnswers) ? [...userAnswers] : userAnswers && typeof userAnswers === "object" ? { ...userAnswers } : userAnswers;
  const mapped = questions.map((q, i) => {
    if (q?.questionKind !== "complete") return q;
    const { options, correct, multiSelect, questionKind, strictMatch, ...rest } = q;
    if (ua && Array.isArray(ua[i])) ua[i] = ua[i].map((v, k) => `${k + 1}) ${v || "—"}`).join("  ");
    return { ...rest, q: completeToPlain(q.q), answer: completeAnswerKey(q.q) || "—" };
  });
  return { questions: mapped, userAnswers: ua };
}
