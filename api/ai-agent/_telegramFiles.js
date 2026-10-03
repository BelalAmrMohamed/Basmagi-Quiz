// =============================================================================
// api/ai-agent/_telegramFiles.js
// Helpers for downloading files FROM Telegram users (inbound) and sending
// generated documents BACK to them (outbound).
//
// Inbound:
//   - downloadTelegramFile(fileId): fetches raw file buffer via Bot API.
//   - processTelegramInbound(message): extracts text + attachments from a
//     Telegram update message, returning { text, parts[] } ready for Gemini.
//
// Outbound:
//   - sendTelegramDocument(chatId, buffer, filename, caption): sends a
//     file as a Telegram document message.
//   - sendTelegramChatAction(chatId, action): sends typing/upload indicators.
//
// Constraints:
//   - Max 10 attachments per message.
//   - Max 4 MB total attachment size.
//   - Supported inbound types: images (vision), PDFs (native Gemini),
//     Word .docx (text extracted via mammoth), plain text/markdown/json.
// =============================================================================

import mammoth from "mammoth";

const TELEGRAM_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024; // 4 MB

// ── Inbound: download files from Telegram ────────────────────────────────────

/**
 * Downloads a file from Telegram by its file_id.
 * @param {string} fileId
 * @returns {Promise<{ buffer: Buffer, fileName: string, mimeType: string, size: number }>}
 */
export async function downloadTelegramFile(fileId) {
  const token = TELEGRAM_TOKEN();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");

  // Step 1: get the file path from Telegram
  const metaRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  );
  if (!metaRes.ok) {
    throw new Error(`Telegram getFile failed (${metaRes.status})`);
  }
  const metaData = await metaRes.json();
  const filePath = metaData?.result?.file_path;
  const fileSize = metaData?.result?.file_size || 0;
  if (!filePath) throw new Error("Telegram returned no file_path");

  // Step 2: download the raw bytes
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`
  );
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed (${fileRes.status})`);
  }
  const arrayBuf = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // Derive filename from the path (last segment)
  const fileName = filePath.split("/").pop() || "file";

  // Guess MIME type from extension
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeType = MIME_MAP[ext] || "application/octet-stream";

  return { buffer, fileName, mimeType, size: fileSize || buffer.length };
}

const MIME_MAP = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
};

// ── Inbound: process a full Telegram message into Gemini-ready parts ─────────

/**
 * Extracts user text + file attachments from a Telegram message and returns
 * them in a shape ready to be assembled into Gemini's `contents` array.
 *
 * @param {object} message - Telegram Update.message object
 * @returns {Promise<{ text: string, parts: Array<object> }>}
 *   `text`  — the final text prompt (message.text/caption + any extracted doc text)
 *   `parts` — inline Gemini parts for images/PDFs (base64 inlineData)
 */
export async function processTelegramInbound(message) {
  const rawText = message.text || message.caption || "";
  let extraText = "";
  const parts = []; // Gemini inline parts (images, PDFs)
  let totalSize = 0;
  let attachmentCount = 0;

  // Helper: enforce limits
  function checkLimits(size) {
    attachmentCount++;
    totalSize += size;
    if (attachmentCount > MAX_ATTACHMENTS) {
      throw new Error(`Maximum ${MAX_ATTACHMENTS} attachments per message.`);
    }
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new Error("Total attachment size exceeds 4 MB limit.");
    }
  }

  // ── Photos (select largest resolution) ──────────────────────────────────
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]; // last = largest
    const { buffer, size } = await downloadTelegramFile(largest.file_id);
    checkLimits(size);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: buffer.toString("base64"),
      },
    });
  }

  // ── Documents ───────────────────────────────────────────────────────────
  if (message.document) {
    const doc = message.document;
    const { buffer, fileName, mimeType, size } = await downloadTelegramFile(
      doc.file_id
    );
    checkLimits(size);

    if (mimeType === "application/pdf") {
      // Gemini can read PDFs natively as inlineData
      parts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: buffer.toString("base64"),
        },
      });
    } else if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      // Extract text from .docx via mammoth
      try {
        const result = await mammoth.extractRawText({ buffer });
        if (result.value) {
          extraText += `\n\n--- Extracted from "${fileName}" ---\n${result.value}`;
        }
      } catch (e) {
        extraText += `\n\n[Could not extract text from "${fileName}": ${e.message}]`;
      }
    } else if (
      mimeType === "text/plain" ||
      mimeType === "text/markdown" ||
      mimeType === "application/json"
    ) {
      // Plain text files: decode and append
      const decoded = buffer.toString("utf-8");
      extraText += `\n\n--- Content of "${fileName}" ---\n${decoded}`;
    } else {
      extraText += `\n\n[Unsupported file type: ${mimeType} — "${fileName}"]`;
    }
  }

  const finalText = (rawText + extraText).trim();
  return { text: finalText, parts };
}

// ── Outbound: send documents back to the user ────────────────────────────────

/**
 * Sends a file as a Telegram document message.
 * @param {number|string} chatId
 * @param {Buffer} buffer - file content
 * @param {string} filename - display name for the document
 * @param {string} [caption] - optional caption text
 */
export async function sendTelegramDocument(chatId, buffer, filename, caption) {
  const token = TELEGRAM_TOKEN();
  if (!token) {
    console.error("[telegramFiles] TELEGRAM_BOT_TOKEN not configured");
    return;
  }

  // Build multipart/form-data manually with the web-standard FormData+Blob
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "document",
    new Blob([buffer], { type: "application/octet-stream" }),
    filename
  );
  if (caption) {
    form.append("caption", caption.slice(0, 1024)); // Telegram caption limit
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendDocument`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(
      `[telegramFiles] sendDocument failed (${res.status}): ${errText}`
    );
  }
}

/**
 * Sends a chat action indicator (e.g. "typing", "upload_document").
 * @param {number|string} chatId
 * @param {string} action
 */
export async function sendTelegramChatAction(chatId, action = "typing") {
  const token = TELEGRAM_TOKEN();
  if (!token) return;

  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}
