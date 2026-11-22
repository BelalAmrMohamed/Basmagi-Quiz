// =============================================================================
// public/src/shared/youtube-transcript.js
// Pure formatting for the AI agent's summarize_youtube tool: turns a transcript
// ({ lines: [{ s, t }] }) or, when none exists, the video's title/description,
// into ONE text result for the model. Long videos are returned in parts so a
// 2-hour lecture never floods the context window.
// =============================================================================

export const TRANSCRIPT_PART_CHARS = 20000;

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Splits transcript lines into parts of at most `maxChars` characters, never cutting a line. */
export function splitTranscriptParts(lines, maxChars = TRANSCRIPT_PART_CHARS) {
  const parts = [];
  let current = "";
  for (const line of lines || []) {
    const text = `[${formatTimestamp(line.s)}] ${line.t}`;
    if (current && current.length + text.length + 1 > maxChars) {
      parts.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + text;
  }
  if (current) parts.push(current);
  return parts;
}

const REASONS = {
  no_captions: "الفيديو لا يحتوي على ترجمة أو نص مكتوب",
  blocked: "تعذّر جلب نص الفيديو من الخادم حاليًا",
  upstream: "تعذّر الاتصال بيوتيوب لجلب النص",
  service: "خدمة جلب النص غير متاحة حاليًا",
};

/**
 * @param {{title?:string, channelTitle?:string, durationSeconds?:number, publishedAt?:string, description?:string}} details
 * @param {{available:boolean, language?:string, kind?:string, lines?:{s:number,t:string}[], reason?:string}} transcript
 * @param {{part?:number, maxChars?:number}} [opts]
 */
export function buildSummarizeResult(details, transcript, { part = 1, maxChars = TRANSCRIPT_PART_CHARS } = {}) {
  const head = [`الفيديو: ${details?.title || "بدون عنوان"}`];
  if (details?.channelTitle) head.push(`القناة: ${details.channelTitle}`);
  if (Number.isInteger(details?.durationSeconds)) head.push(`المدة: ${formatTimestamp(details.durationSeconds)}`);
  if (details?.publishedAt) head.push(`تاريخ النشر: ${String(details.publishedAt).slice(0, 10)}`);

  if (!transcript?.available) {
    const why = REASONS[transcript?.reason] || REASONS.service;
    return [
      ...head,
      `المصدر: الوصف فقط (${why}).`,
      "",
      "وصف الفيديو:",
      details?.description?.trim() || "(لا يوجد وصف)",
      "",
      "المهمة: لا تتوفر نص للفيديو، فاذكر للمستخدم بوضوح أن الملخص مبني على العنوان والوصف فقط، ولا تخمّن ما قيل داخل الفيديو. إن كان الوصف يحوي فصولًا أو نقاطًا فاعرضها.",
    ].join("\n");
  }

  const parts = splitTranscriptParts(transcript.lines, maxChars);
  const total = Math.max(parts.length, 1);
  const n = Math.min(Math.max(Math.floor(Number(part)) || 1, 1), total);
  const lang = transcript.language ? ` · ${transcript.language}` : "";
  const how = transcript.kind === "auto" ? "مُولَّد تلقائيًا (قد يحتوي أخطاء)" : "ترجمة بشرية";
  const out = [
    ...head,
    `المصدر: نص الفيديو (${how}${lang}) — الجزء ${n} من ${total}`,
    "",
    parts[n - 1] || "",
    "",
  ];
  if (n < total) {
    out.push(`هذا الجزء ${n} من ${total}. للحصول على ملخص كامل استدعِ الأداة مرة أخرى بـ part=${n + 1} (حتى الجزء ${total}) ثم ادمج الأجزاء.`);
  }
  out.push("المهمة: لخّص بالعربية اعتمادًا على النص أعلاه فقط (نقاط رئيسية بتسلسل زمني مع الطوابع الزمنية)، ولا تضف معلومات غير موجودة. اذكر للمستخدم أن الملخص مبني على نص الفيديو، وإن طلب حفظه فأنشئ درسًا بـ create_lesson.");
  return out.join("\n");
}
