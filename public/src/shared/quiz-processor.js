// src/shared/quiz-processor.js
// Shared quiz file/text processing utilities used by both create-quiz and index pages.
import { generateQuizId } from "../shared/quizId.js";

/**
 * Dynamically load a script from CDN.
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Raw text extractors ──────────────────────────────────────────────────────

async function extractTextFromPdf(file) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  );
  const pdfjsLib = window["pdfjs-dist/build/pdf"];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    fullText += tc.items.map((item) => item.str).join(" ") + "\n";
  }
  return fullText;
}

async function extractTextFromDocx(file) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  );
  const JSZip = window.JSZip;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = zip.file("word/document.xml");
  if (!docXml) throw new Error("Incorrect DOCX file: There's no document.xml");
  const xmlText = await docXml.async("string");
  return xmlText
    .replace(/<w:p[ >]/g, "\n<w:p>")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractTextFromPptx(file) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  );
  const JSZip = window.JSZip;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  let fullText = "";
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0]);
      const nb = parseInt(b.match(/\d+/)[0]);
      return na - nb;
    });
  for (const slideFile of slideFiles) {
    const xmlText = await zip.file(slideFile).async("string");
    const text = xmlText
      .replace(/<a:p[ >]/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
    if (text) fullText += text + "\n";
  }
  return fullText.trim();
}

/**
 * Extract raw text from a File object (legacy, kept for compatibility).
 * Supports: .json, .txt (plain read), .pdf (pdf.js), .docx (JSZip+XML), .pptx (JSZip+XML)
 */
export async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || name.endsWith(".txt")) {
    return file.text();
  }
  if (name.endsWith(".pdf")) {
    return extractTextFromPdf(file);
  }
  if (name.endsWith(".docx")) {
    return extractTextFromDocx(file);
  }
  if (name.endsWith(".pptx")) {
    return extractTextFromPptx(file);
  }
  return file.text();
}

// ─── Meta-block extractor ─────────────────────────────────────────────────────

/**
 * Extract leading metadata lines from the raw text.
 * Recognises: Title, Description, Source (case-insensitive).
 * Returns { meta, rest } where rest is the text after the meta block.
 */
function extractMetaBlock(trimmed) {
  const metaLineRe = /^(Title|Description|Source)\s*:\s*(.*)/i;
  const lines = trimmed.split("\n");
  const meta = {};
  let i = 0;

  // Walk past blank lines at the very top
  while (i < lines.length && !lines[i].trim()) i++;

  // Consume contiguous meta key-value lines (blank lines between them are ok)
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && metaLineRe.test(next)) {
        i++;
        continue;
      }
      break;
    }
    const m = line.match(metaLineRe);
    if (m) {
      meta[m[1].toLowerCase()] = m[2].trim();
      i++;
    } else {
      break;
    }
  }

  const rest = lines.slice(i).join("\n").trim();
  return { meta: Object.keys(meta).length ? meta : null, rest };
}

// ─── State Machine Text Parser ────────────────────────────────────────────────

/**
 * Parser states (internal enum).
 *
 * PREAMBLE    – before the first question has been detected.
 * QUESTION    – accumulating question body text.
 * OPTIONS     – accumulating option list; each new A)/B)/- starts a new slot.
 * ANSWER      – accumulating the Answer/Correct value (essay or letter).
 * EXPLANATION – accumulating the explanation body.
 *
 * @enum {string}
 */
const S = Object.freeze({
  PREAMBLE: "PREAMBLE",
  QUESTION: "QUESTION",
  OPTIONS: "OPTIONS",
  ANSWER: "ANSWER",
  EXPLANATION: "EXPLANATION",
});

// ── Delimiter patterns ────────────────────────────────────────────────────────

/**
 * Question-start pattern.  Handles all common styles:
 *   "1. text"   "1) text"   "1: text"
 *   "Q1. text"  "Q1: text"  "Q1) text"
 *   "Question 1. text"      "Question 1: text"
 *
 * Captures: [1] question number, [2] remainder of opening line.
 */
const RE_Q_START = /^(?:Q(?:uestion)?\s*)?(\d+)[.):][ \t]*(.*)/i;

/**
 * Option with a letter label.  "A) text"  "A. text"  (case-insensitive)
 * Captures: [1] letter, [2] option text.
 */
const RE_OPT_LETTER = /^([A-E])[.)]\s*(.*)/i;

/**
 * Dash-style option.  "- text"
 * Captures: [1] option text.
 */
const RE_OPT_DASH = /^-[ \t]+(.*)/;

/**
 * Answer / Correct marker.  "Answer: X"  "Correct: X"  "Answer - X"
 * Captures: [1] raw answer value (letter or free-form text).
 */
const RE_ANSWER = /^(?:Answer|Correct)\s*[:\-][ \t]*(.*)/i;

/**
 * Explanation / Reason marker.  "Explanation: …"  "Reason: …"
 * Captures: [1] first line of explanation (may be empty).
 */
const RE_EXPL = /^(?:Explanation|Reason)\s*[:\-][ \t]*(.*)/i;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Join an array of raw lines into a single clean string.
 *
 * Leading/trailing blank lines are stripped, but INTERNAL blank lines are
 * preserved — they are structurally important in LaTeX display-math blocks,
 * fenced code blocks, and Markdown paragraph breaks.
 *
 * @param {string[]} lines
 * @returns {string}
 */
function joinLines(lines) {
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  let end = lines.length - 1;
  while (end >= start && !lines[end].trim()) end--;
  return lines.slice(start, end + 1).join("\n");
}

/**
 * Strip a surrounding fenced code block or inline backtick pair from `text`.
 *
 * Examples handled:
 *   "```js\ncode\n```"   →  "code"
 *   "`const x = 5;`"    →  "const x = 5;"
 *   "``value``"         →  "value"
 *   "plain text"        →  "plain text"  (unchanged)
 *
 * @param {string} text
 * @returns {string}
 */
function stripFence(text) {
  const t = text.trim();
  // Triple-backtick fenced block (optional language tag on the opening line)
  const tripleStripped = t
    .replace(/^```(?:[^\n]*)?\n?([\s\S]*?)\n?```$/, "$1")
    .trim();
  if (tripleStripped !== t) return tripleStripped;
  // Single or double inline backticks
  const singleStripped = t.replace(/^(`{1,2})([\s\S]+?)\1$/, "$2").trim();
  if (singleStripped !== t) return singleStripped;
  return t;
}

// ── Block finaliser ───────────────────────────────────────────────────────────

/**
 * Convert a fully-accumulated raw block into the final question schema.
 *
 * Chooses between two output shapes:
 *
 *   MCQ / True-False
 *     { q, options: string[], correct: number, explanation: string }
 *
 *   Essay
 *     { q, answer: string, options: [answer], correct: 0, explanation: string }
 *
 * @param {{
 *   questionLines: string[],
 *   optionSlots:   Array<{ letter: string, lines: string[] }>,
 *   answerLines:   string[],
 *   explanLines:   string[],
 *   qIndex:        number,
 * }} raw
 * @returns {object}
 * @throws {Error} with a descriptive message if the block is malformed.
 */
function buildQuestion({
  questionLines,
  optionSlots,
  answerLines,
  explanLines,
  qIndex,
}) {
  const label = `Question #${qIndex + 1}`;

  const q = joinLines(questionLines);
  if (!q) {
    throw new Error(
      `${label}: question text is empty. Check that a question number delimiter (e.g. "1." or "Q1:") is followed by text.`,
    );
  }

  const explanation = joinLines(explanLines);
  const rawAnswer = joinLines(answerLines);
  const hasAnswer = rawAnswer.length > 0;

  // ── Essay path ─────────────────────────────────────────────────────────────
  // Criterion: an Answer/Correct marker was found AND no lettered options exist.
  if (hasAnswer && optionSlots.length === 0) {
    const answer = stripFence(rawAnswer);
    return { q, answer, options: [answer], correct: 0, explanation };
  }

  // ── MCQ / True-False path ──────────────────────────────────────────────────
  if (optionSlots.length === 0) {
    // Completely missing options AND no essay answer → malformed
    throw new Error(
      `${label} ("${q.slice(0, 60)}${q.length > 60 ? "…" : ""}"): ` +
        `no options and no "Answer:" marker were found. ` +
        `Provide lettered options (A) … B) …) or an essay-style "Answer: …" line.`,
    );
  }

  const options = optionSlots.map((slot) => joinLines(slot.lines));
  const letters = optionSlots.map((slot) => slot.letter);

  let correct = 0;
  if (hasAnswer) {
    const val = rawAnswer.trim();
    if (/^[A-E]$/i.test(val)) {
      const idx = letters.indexOf(val.toUpperCase());
      correct = idx >= 0 ? idx : 0;
    }
    // If the answer value is not a single letter we leave correct = 0.
    // (This covers the edge-case where someone writes "Answer: True" for a T/F
    // question labelled with dash-style options.)
  }

  return { q, options, correct, explanation };
}

// ── Main state machine ────────────────────────────────────────────────────────

/**
 * Parse the body text (after the meta block) into an array of question objects.
 *
 * ### Why a state machine instead of block-splitting?
 *
 * The previous approach split on `/(?=^\d+\.)/m` and then iterated lines with
 * simple regex guards.  This broke in four common scenarios:
 *
 * 1. **Multi-line question bodies** – blank lines between sentences were
 *    filtered out by `.filter(Boolean)`, silently discarding content.
 * 2. **Multi-line options** – only the first line of a code-snippet option was
 *    captured; the loop's `continue` immediately advanced past the rest.
 * 3. **Multi-line explanations** – `explanation = expMatch[1].trim()` captured
 *    only the text on the _same line_ as the `Explanation:` marker.
 * 4. **Alternative delimiters** – `Q1:` / `Question 2)` were not recognised
 *    by the `^\d+\.` split regex, causing whole questions to be skipped.
 *
 * The state machine fixes all of these by treating every unrecognised line as
 * a **continuation** of whatever is currently being accumulated.
 *
 * @param {string} body  – raw text with the meta header already removed.
 * @returns {Array<object>}
 */
function parseQuestionBlocks(body) {
  const lines = body.split("\n");

  const questions = [];

  // ── Per-question mutable accumulators ────────────────────────────────────
  let state = S.PREAMBLE;
  let qIndex = 0; // how many questions have been flushed so far
  let questionLines = []; // raw lines of the question body
  let optionSlots = []; // [{ letter: string, lines: string[] }, …]
  let answerLines = []; // raw lines of the answer value
  let explanLines = []; // raw lines of the explanation

  // ── Helper: flush the accumulated block as a question ────────────────────
  function flushBlock() {
    if (state === S.PREAMBLE) return;
    questions.push(
      buildQuestion({
        questionLines,
        optionSlots,
        answerLines,
        explanLines,
        qIndex,
      }),
    );
    qIndex++;
    questionLines = [];
    optionSlots = [];
    answerLines = [];
    explanLines = [];
  }

  // ── Line scanner ──────────────────────────────────────────────────────────
  for (const raw of lines) {
    const trimmed = raw.trim();

    // ── 1. New question start — always takes highest priority ────────────────
    const qMatch = raw.match(RE_Q_START);
    if (qMatch) {
      flushBlock();
      state = S.QUESTION;
      // The question text may start inline after the number delimiter
      questionLines = qMatch[2] ? [qMatch[2]] : [];
      continue;
    }

    // Before the first question has been found, skip all lines.
    if (state === S.PREAMBLE) continue;

    // ── 2. Option delimiters (only outside ANSWER and EXPLANATION) ───────────
    if (state !== S.ANSWER && state !== S.EXPLANATION) {
      const letterMatch = trimmed.match(RE_OPT_LETTER);
      if (letterMatch) {
        optionSlots.push({
          letter: letterMatch[1].toUpperCase(),
          lines: [letterMatch[2]],
        });
        state = S.OPTIONS;
        continue;
      }

      const dashMatch = trimmed.match(RE_OPT_DASH);
      if (dashMatch) {
        // Assign synthetic letters A, B, C … in insertion order
        const letter = String.fromCharCode(65 + optionSlots.length);
        optionSlots.push({ letter, lines: [dashMatch[1]] });
        state = S.OPTIONS;
        continue;
      }
    }

    // ── 3. Answer / Correct marker ───────────────────────────────────────────
    const ansMatch = trimmed.match(RE_ANSWER);
    if (ansMatch) {
      answerLines = ansMatch[1] ? [ansMatch[1]] : [];
      state = S.ANSWER;
      continue;
    }

    // ── 4. Explanation / Reason marker ───────────────────────────────────────
    const expMatch = trimmed.match(RE_EXPL);
    if (expMatch) {
      explanLines = expMatch[1] ? [expMatch[1]] : [];
      state = S.EXPLANATION;
      continue;
    }

    // ── 5. Continuation line — append to the current accumulator ─────────────
    //
    // KEY INSIGHT: we use `raw` (not `trimmed`) here so that indented code
    // blocks, LaTeX display math, and Markdown tables keep their whitespace.
    switch (state) {
      case S.QUESTION:
        questionLines.push(raw);
        break;
      case S.OPTIONS:
        // Multi-line option: append to the last open slot.
        if (optionSlots.length) {
          optionSlots[optionSlots.length - 1].lines.push(raw);
        }
        break;
      case S.ANSWER:
        answerLines.push(raw);
        break;
      case S.EXPLANATION:
        explanLines.push(raw);
        break;
      default:
        break;
    }
  }

  // Flush the final block (no trailing question-start to trigger it)
  flushBlock();

  return questions;
}

// ─── Public parsers ───────────────────────────────────────────────────────────

/** Parse a string as JSON array/object OR numbered text format. */
export function parseImportContent(content, defaultTitle = "") {
  const trimmed = content.trim();

  // ── JSON fast path ─────────────────────────────────────────────────────────
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      if (trimmed.startsWith("{")) {
        const data = JSON.parse(trimmed);
        const questions = Array.isArray(data.questions)
          ? data.questions
          : Array.isArray(data)
            ? data
            : null;
        const meta =
          data.meta ||
          (data.title
            ? { title: data.title, description: data.description || "" }
            : defaultTitle
              ? { title: defaultTitle }
              : null);
        if (!questions) throw new Error("There are no questions");
        return { questions, meta };
      } else {
        const questions = JSON.parse(trimmed);
        if (!Array.isArray(questions)) throw new Error("Not an array");
        const meta = defaultTitle ? { title: defaultTitle } : null;
        return { questions, meta };
      }
    } catch (e) {
      throw new Error("JSON parse error: " + e.message);
    }
  }

  // ── Numbered text format — state machine path ──────────────────────────────

  // Peel off the optional metadata block at the top of the file
  const { meta: parsedMeta, rest } = extractMetaBlock(trimmed);

  const meta = parsedMeta
    ? {
        title: parsedMeta.title || defaultTitle || undefined,
        description: parsedMeta.description || undefined,
        source: parsedMeta.source || undefined,
      }
    : defaultTitle
      ? { title: defaultTitle }
      : null;

  let questions;
  try {
    questions = parseQuestionBlocks(rest);
  } catch (err) {
    // Wrap parser errors with a little extra context
    throw new Error(`Parse error: ${err.message}`);
  }

  if (!questions.length)
    throw new Error("No questions found — unsupported format.");
  return { questions, meta };
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Process a File and return { questions, meta } directly.
 *
 * - For .json: parsed immediately without text round-trip.
 * - For .txt / .pdf / .docx / .pptx: text extracted first, then parsed.
 *
 * The returned questions always follow the unified schema:
 *   MCQ/TF  → { q, options[], correct, explanation? }
 *   Essay   → { q, answer, options: [answer], correct: 0, explanation? }
 *
 * @param {File}   file
 * @param {string} [defaultTitle]
 * @returns {Promise<{ questions: Array, meta: object|null }>}
 */
export async function processQuizFile(file, defaultTitle = "") {
  const name = file.name.toLowerCase();

  if (name.endsWith(".json")) {
    try {
      const text = await file.text();
      const trimmed = text.trim();
      const data = JSON.parse(trimmed);

      if (Array.isArray(data)) {
        return {
          questions: data,
          meta: defaultTitle ? { title: defaultTitle } : null,
        };
      }

      const questions = Array.isArray(data.questions) ? data.questions : null;
      if (!questions)
        throw new Error("No questions array found in the provided JSON file.");

      const meta =
        data.meta ||
        (data.title
          ? { title: data.title, description: data.description || "" }
          : defaultTitle
            ? { title: defaultTitle }
            : null);

      return { questions, meta };
    } catch (e) {
      throw new Error(`Failed to read ${file.name}: ${e.message}`);
    }
  }

  // Non-JSON: extract text, then parse
  const text = await extractTextFromFile(file);
  const title =
    defaultTitle ||
    file.name
      .replace(/\.(txt|pdf|docx|pptx)$/i, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return parseImportContent(text, title);
}

// ─── JSON export builder ──────────────────────────────────────────────────────

/**
 * Build a full JSON export payload for a quiz.
 *
 * @param {string}  title
 * @param {string}  description
 * @param {string}  source
 * @param {Array}   questions
 * @param {string|null} [createdAt]
 * @returns {Promise<object>}
 */
export async function buildJsonQuizExport(
  title,
  description,
  source,
  questions,
  createdAt = null,
) {
  const exportQuestions = questions.map((q) => {
    const out = { q: q.q };
    if (q.image?.trim()) out.image = q.image;
    if (Array.isArray(q.options) && q.options.length === 1) {
      out.answer = q.options[0] || "";
    } else if (!Array.isArray(q.options) || q.options.length === 0) {
      out.answer = q.answer || "";
    } else {
      out.options = q.options;
      if (q.correct !== undefined && q.correct !== null)
        out.correct = q.correct;
    }
    if (q.explanation?.trim()) out.explanation = q.explanation;
    return out;
  });

  const safeFilename = (title || "quiz")
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  const statsTypes = new Set();
  exportQuestions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0)
      statsTypes.add("Essay");
    else if (q.options.length === 2) statsTypes.add("True/False");
    else statsTypes.add("MCQ");
  });

  const meta = {
    id: await generateQuizId(`quizzes/draft/${safeFilename}.json`),
    title: title || "",
    createdAt:
      createdAt || new Date().toISOString().slice(0, 16).replace("T", " - "),
  };
  if (description?.trim()) meta.description = description.trim();
  if (source?.trim()) meta.source = source.trim();

  return {
    meta,
    stats: {
      questionCount: exportQuestions.length,
      questionTypes: Array.from(statsTypes).sort(),
    },
    questions: exportQuestions,
  };
}

// ─── "Golden Standard" Reference Template ────────────────────────────────────

/**
 * A stress-test quiz file in the supported numbered-text format.
 *
 * Exercises every edge case the parser must handle:
 *   • Multi-line question bodies (paragraphs + display LaTeX)
 *   • Options containing inline code and inline LaTeX
 *   • Multi-line explanations with Markdown tables and bullet lists
 *   • Fenced code blocks inside explanations (and inside an essay answer)
 *   • Mixed question delimiters: "1." and "Q2:" and "Question 4:"
 *   • Dash-style True/False options
 *   • An essay question with a multi-sentence answer
 *
 * @type {string}
 */
export const REFERENCE_QUIZ_TEMPLATE = `\
Title: Parser Stress Test — Reference Quiz
Description: A "golden standard" file that exercises every parser edge case.
  Includes LaTeX formulas, code-snippet options, multi-paragraph explanations,
  Markdown tables, and mixed question-number delimiters.
Source: quiz-processor/reference-quiz.txt

1. Consider the arithmetic mean formula below.

   Given a dataset of $n$ values, the mean is defined as:

   $$\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$$

   If $n = 4$ and the dataset is $\\{2, 4, 6, 8\\}$, what is $\\bar{x}$?

A) 4
B) 5
C) 20
D) 3.5
Answer: B
Explanation: Sum the values: $2 + 4 + 6 + 8 = 20$, then divide by $n = 4$:

   $$\\bar{x} = \\frac{20}{4} = 5$$

   | Step       | Operation           | Result |
   |------------|---------------------|--------|
   | **Sum**    | $2 + 4 + 6 + 8$     | 20     |
   | **Divide** | $20 \\div 4$         | **5**  |

Q2: Which JavaScript snippet correctly performs a **deep clone** of an object in modern environments?

A) \`Object.assign({}, obj)\`
B) \`{ ...obj }\`
C) \`JSON.parse(JSON.stringify(obj))\`
D) \`structuredClone(obj)\`
Answer: D
Explanation: **\`structuredClone()\`** (available since Node 17 / Chrome 98) is the only
option that performs a true recursive deep clone and correctly handles:

   - Circular references
   - \`Date\`, \`Map\`, \`Set\`, and \`ArrayBuffer\` instances
   - Nested objects at arbitrary depth

   The alternatives all have critical limitations:

   | Method                          | Depth   | Circular | Date/Map |
   |---------------------------------|---------|----------|----------|
   | \`Object.assign({}, obj)\`        | Shallow | ❌        | ❌        |
   | Spread \`{ ...obj }\`             | Shallow | ❌        | ❌        |
   | \`JSON.parse(JSON.stringify())\`  | Deep    | ❌        | ❌        |
   | \`structuredClone()\`             | Deep    | ✅        | ✅        |

3. True or False: In Python, the \`is\` operator checks for **value** equality.

- True
- False
Answer: B
Explanation: \`is\` tests **object identity** — whether two variables point to the
exact same object in memory, not whether they hold equal values. Use \`==\` for
value equality instead.

   \`\`\`python
   a = [1, 2, 3]
   b = [1, 2, 3]
   print(a == b)   # True  — same values
   print(a is b)   # False — different objects in memory
   \`\`\`

   The only common idiom where \`is\` is *correct* is checking for the \`None\`
   singleton: \`if result is None:\`

Question 4: What does the following regular-expression pattern match?

   \`\`\`
   ^(?:Q(?:uestion)?\\s*)?(\\d+)[.):] 
   \`\`\`

   Consider it applied to the start of each line in a quiz document.

A) Any line that begins with a digit
B) Question headers such as \`1.\`, \`Q2:\`, or \`Question 3)\`
C) Any line starting with the letter Q
D) URLs containing digits
Answer: B
Explanation: Breaking down each group left to right:

   - \`^\` — anchors the match to the very start of the line.
   - \`(?:Q(?:uestion)?\\s*)?\` — optionally matches the literal \`Q\` or the word
     \`Question\` followed by optional whitespace (non-capturing group).
   - \`(\\d+)\` — capturing group that records the question number.
   - \`[.):]\` — requires exactly one delimiter: a period, closing-paren, or colon.

   This is the exact pattern used in the refactored parser so that \`1.\`,
   \`Q1:\`, \`Q1)\`, \`Question 2.\`, and \`Question 3:\` are all recognised as
   question starts while arbitrary lines containing digits are not.

Q5: Describe the semantic difference between \`==\` and \`===\` in JavaScript.
Provide a brief code example for each operator.

Answer: \`==\` performs **type coercion** before comparing, so \`"5" == 5\` evaluates
to \`true\`. \`===\` (strict equality) requires both **value and type** to match,
so \`"5" === 5\` evaluates to \`false\`. Always prefer \`===\` in production code.
Explanation: JavaScript's Abstract Equality Comparison algorithm (\`==\`) applies
a series of type-conversion steps before the actual test. This leads to
counter-intuitive results:

   | Expression            | \`==\`    | \`===\`   |
   |-----------------------|---------|---------|
   | \`"5"\` vs \`5\`          | \`true\`  | \`false\` |
   | \`null\` vs \`undefined\` | \`true\`  | \`false\` |
   | \`0\` vs \`false\`        | \`true\`  | \`false\` |
   | \`[]\` vs \`false\`       | \`true\`  | \`false\` |

   ESLint's \`eqeqeq\` rule enforces \`===\` throughout a codebase for precisely
   this reason. Reserve \`==\` only for explicit null-checks (\`x == null\` catches
   both \`null\` and \`undefined\`).
`;
