// =============================================================================
// api/upload-media.js
//
// Authenticated endpoint — validates admin JWT then stores a media file
// (image or audio) in Supabase Storage.
//
// POST /api/upload-media
// Headers:  Authorization: Bearer <admin-jwt>
//           Content-Type:  multipart/form-data
// Body:     file  — the binary file
//           type  — "image" | "audio"
//
// Returns:  { success: true, url: "<public-cdn-url>" }
//
// Design notes:
//   • Uses the Supabase SERVICE KEY (server-side only — never exposed to client)
//   • File is uploaded to quiz-media/<type>/<timestamp>-<random>.<ext>
//   • MIME type + file size validated server-side (client cannot bypass)
//   • Vercel serverless environment limit: 4.5 MB body by default. We raise it
//     via the exported `config` object to support audio files up to 10 MB.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import formidable from "formidable";
import { readFileSync } from "fs";

// ── Supabase service client (never exposed to browser) ──────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// ── Constants ────────────────────────────────────────────────────────────────
const BUCKET = "quiz-media";

const ALLOWED_MIME = {
  image: new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ]),
  audio: new Set([
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "audio/aac",
    "audio/x-m4a",
    "audio/mp4",
  ]),
};

const MAX_SIZE = {
  image: 5 * 1024 * 1024,  // 5 MB
  audio: 10 * 1024 * 1024, // 10 MB
};

const VALID_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/gif":  "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/ogg":  "ogg",
  "audio/wav":  "wav",
  "audio/webm": "webm",
  "audio/aac":  "aac",
  "audio/x-m4a": "m4a",
  "audio/mp4":  "m4a",
};

// ── Vercel body-size override (needed for audio uploads) ─────────────────────
export const config = {
  api: {
    bodyParser: false, // formidable handles its own parsing
    responseLimit: false,
  },
};

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // 1. Authenticate
  let adminPayload;
  try {
    adminPayload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  // 2. Parse multipart form
  const form = formidable({
    maxFileSize: 10 * 1024 * 1024, // 10 MB hard cap
    keepExtensions: true,
    multiples: false,
  });

  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    console.error("[upload-media] Form parse error:", err.message);
    return res.status(400).json({ error: "فشل تحليل الملف المرفق. تأكد من أن الحجم لا يتجاوز 10 ميجابايت." });
  }

  // 3. Extract and validate `type` field
  const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
  if (!type || !ALLOWED_MIME[type]) {
    return res.status(400).json({ error: 'النوع يجب أن يكون "image" أو "audio".' });
  }

  // 4. Extract uploaded file
  const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: "لم يتم إرسال أي ملف." });
  }

  // 5. MIME type validation
  const mimeType = uploadedFile.mimetype || "";
  if (!ALLOWED_MIME[type].has(mimeType)) {
    const allowed = Array.from(ALLOWED_MIME[type]).join(", ");
    return res.status(400).json({
      error: `نوع الملف غير مدعوم (${mimeType}). الأنواع المسموحة: ${allowed}`,
    });
  }

  // 6. File size validation
  const fileSize = uploadedFile.size || 0;
  if (fileSize > MAX_SIZE[type]) {
    const maxMb = MAX_SIZE[type] / (1024 * 1024);
    return res.status(400).json({
      error: `حجم الملف يتجاوز الحد المسموح (${maxMb} ميجابايت).`,
    });
  }
  if (fileSize === 0) {
    return res.status(400).json({ error: "الملف فارغ." });
  }

  // 7. Generate a unique, collision-free storage path
  const ext = VALID_EXTENSIONS[mimeType] || "bin";
  const randomSuffix = Math.random().toString(36).slice(2, 9);
  const timestamp = Date.now();
  const storagePath = `${type}s/${timestamp}-${randomSuffix}.${ext}`;
  // → e.g. "images/1723593600000-abc1234.jpg"
  //        "audios/1723593600000-xyz5678.mp3"

  // 8. Read file buffer and upload to Supabase Storage
  let fileBuffer;
  try {
    fileBuffer = readFileSync(uploadedFile.filepath);
  } catch (err) {
    console.error("[upload-media] Could not read temp file:", err.message);
    return res.status(500).json({ error: "خطأ داخلي أثناء قراءة الملف." });
  }

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false, // never overwrite — our path is already unique
    });

  if (storageError) {
    console.error("[upload-media] Storage error:", storageError.message);
    return res.status(500).json({ error: "فشل رفع الملف إلى التخزين. حاول مجددًا." });
  }

  // 9. Build the public URL
  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  if (!urlData?.publicUrl) {
    return res.status(500).json({ error: "تم رفع الملف لكن فشل توليد الرابط العام." });
  }

  return res.status(201).json({
    success: true,
    url: urlData.publicUrl,
    path: storagePath,
  });
}
