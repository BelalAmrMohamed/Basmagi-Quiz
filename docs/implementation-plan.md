# Telegram AI Study Assistant: Full Implementation Plan

## Objective
Transform the Telegram Bot (`/api/ai-agent/bot?platform=telegram`) into a comprehensive studying assistant for the **Basamgi Exams Platform** (منصة امتحانات بصمجي). The bot will support:
1. Multi-turn conversation memory backed by Supabase.
2. File attachments from users (Images, PDFs, Word `.docx`, and Text files up to 10 files / 4MB total) with text and vision extraction.
3. Read-only platform database search (Courses, Folders, Quizzes, and Lessons) delivering both web links and downloadable files.
4. Quiz and Lesson generation with export support for Standalone Interactive HTML (`.html`), PDF (`.pdf`), Markdown (`.md`), JSON (`.json`), and platform export guidance for Word/PowerPoint.
5. Strict adherence to Vercel Hobby's 12 Serverless Function limit by consolidating redundant legacy handlers.

---

## Architecture & Serverless Function Budget

Vercel Hobby plan enforces a maximum of 12 Serverless Functions. Currently, there are 13 API endpoints.
- **Action**: Delete redundant legacy endpoint `api/upload-folder.js` (its folder-upload capability is already fully handled by `api/upload-quiz.js` via `mode: "folder"`).
- **Result**: Exactly 12 functions remain.
- **Runtime**: Switch `api/ai-agent/bot.js` from Vercel Edge Runtime to standard Node.js Serverless runtime (`export const config = { runtime: "nodejs" }` or omit runtime config). This unlocks:
  - `@supabase/supabase-js` database client.
  - `mammoth` for extracting text from uploaded Word `.docx` documents.
  - Native `Buffer`, `FormData`, and stream handling for Telegram documents.
  - Lightweight programmatic PDF document generation (`pdfkit`).

---

## Phase 1: Database Migration for Multi-turn Conversation Memory

### 1.1 Create Migration File
Create `supabase/migrations/20261003230000_telegram_chat_history.sql`:
```sql
-- Multi-turn conversation history for Telegram bot users
CREATE TABLE IF NOT EXISTS public.telegram_chat_history (
    id bigint generated always as identity primary key,
    chat_id text not null,
    role text not null check (role in ('user', 'model')),
    content text not null,
    created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_chat_history_lookup
    ON public.telegram_chat_history(chat_id, created_at desc);

-- Restrict access to backend service role only
ALTER TABLE public.telegram_chat_history ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.telegram_chat_history TO service_role;
```

### 1.2 Apply Migration
Run in terminal:
```bash
supabase db push
```

---

## Phase 2: Inbound File Handling (`api/ai-agent/_telegramFiles.js`)

Create a helper module `api/ai-agent/_telegramFiles.js` to manage file downloads and document transmissions via the Telegram Bot API:

### 2.1 File Extraction
- `downloadTelegramFile(fileId)`:
  1. Call `https://api.telegram.org/bot<TOKEN>/getFile?file_id=<fileId>`.
  2. Fetch the raw buffer from `https://api.telegram.org/file/bot<TOKEN>/<file_path>`.
  3. Return `{ buffer, fileName, mimeType, size }`.
- `processTelegramInbound(message)`:
  - Extract text/caption: `message.text || message.caption || ""`.
  - Handle `message.photo`: select largest thumbnail, download buffer, return as base64 with `image/jpeg`.
  - Handle `message.document`:
    - If `application/pdf`: return base64 part for Gemini native PDF reading.
    - If `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`): extract raw text using `mammoth.extractRawText({ buffer })` and append to prompt.
    - If plain text / markdown / json: decode `buffer.toString("utf-8")` and append to prompt.
    - Enforce 4MB total attachment cap and max 10 attachments per request.

### 2.2 Document Transmission
- `sendTelegramDocument(chatId, buffer, filename, caption)`:
  - Construct `multipart/form-data` with `chat_id`, `document`, and `caption`.
  - POST to `https://api.telegram.org/bot<TOKEN>/sendDocument`.
- `sendTelegramChatAction(chatId, action = "typing" | "upload_document")`:
  - POST to `https://api.telegram.org/bot<TOKEN>/sendChatAction`.

---

## Phase 3: File Generation Engine (`api/ai-agent/_botGenerators.js`)

Create `api/ai-agent/_botGenerators.js` to build export files directly in memory:

### 3.1 Standalone Interactive Quiz HTML (`.html`)
- Export `generateStandaloneQuizHtml(title, questions)`:
  - Generate a single, zero-dependency HTML file containing CSS, JavaScript, and question data.
  - Includes dark/light mode, mobile responsive layout, option selection, instant scoring, timer, and explanations.
  - Allows students to practice the exam offline on any phone or laptop.

### 3.2 Platform-compatible Quiz JSON (`.json`)
- Export `generateQuizJson(title, questions, description)`:
  - Returns `JSON.stringify({ title, description, questions }, null, 2)` matching the platform schema in `public/src/shared/quiz-json.js`.
  - Can be directly imported into the website via the "استيراد ملف JSON" button.

### 3.3 Quiz Markdown (`.md`)
- Export `generateQuizMarkdown(title, questions)`:
  - Formats questions, multiple choice options, correct answer keys, and detailed explanations in readable GitHub-flavored Markdown.

### 3.4 Lesson Markdown and JSON (`.md`, `.json`)
- Export `generateLessonMarkdown(title, sections)` and `generateLessonJson(title, sections)`.

### 3.5 PDF Generation (`.pdf`)
- Install `pdfkit` dependency: `npm install pdfkit`.
- Export `generateQuizPdf(title, questions)`:
  - Generates a cleanly paginated PDF document with header, questions, options, and answers using `pdfkit`.

---

## Phase 4: Database Search & Retrieval Tools (`api/ai-agent/_botTools.js`)

Create `api/ai-agent/_botTools.js` declaring Gemini tool schemas and execution handlers using Supabase:

### 4.1 Tool Definitions (`BOT_TOOLS`)
1. `search_courses`:
   - Parameters: `{ education_type?: string, college?: string, year?: string, term?: string, query?: string }`
   - Queries `courses` table with text matching on name, college, and curriculum filters.
2. `get_course_contents`:
   - Parameters: `{ course_id: string }`
   - Queries `folders` (parent/subfolders), `quizzes` (filtered by `course_id`), and `lesson_public` (filtered by `course_id`).
   - Returns counts, titles, and IDs.
3. `fetch_quiz`:
   - Parameters: `{ quiz_id: string }`
   - Fetches full quiz data from `quizzes` table.
   - Generates web URL: `https://basmagi-quiz.vercel.app/q/${quiz_id}`.
4. `fetch_lesson`:
   - Parameters: `{ lesson_id: string }`
   - Fetches lesson data from `lesson_public`.
   - Generates web URL: `https://basmagi-quiz.vercel.app/lesson/${lesson_id}`.
5. `generate_quiz_file`:
   - Parameters: `{ title: string, format: "html"|"pdf"|"markdown"|"json", questions: Array<{ q, options, correct, multiSelect, answer, explanation }> }`
   - Invokes the corresponding builder from `_botGenerators.js` and calls `sendTelegramDocument`.
6. `generate_lesson_file`:
   - Parameters: `{ title: string, format: "markdown"|"json", sections: Array<{ title, content, questions }> }`
   - Invokes the builder and calls `sendTelegramDocument`.

### 4.2 Tool Execution Router
- `executeBotTool(toolName, args, chatId, supabase)`:
  - Dispatches calls to database queries or file generation.
  - Automatically sends generated files to the user's Telegram chat.
  - Returns structured results back to the Gemini tool loop.

---

## Phase 5: Telegram Bot Webhook Integration (`api/ai-agent/bot.js`)

Refactor `api/ai-agent/bot.js`:

1. **Delete `api/upload-folder.js`**: Reduce function count to ensure compliance with Vercel's 12-function cap.
2. **Setup Node.js Handler**:
   - Standard `export default async function handler(req, res)` signature.
   - Immediate `200 OK` acknowledgment on Telegram updates, with background processing.
3. **Conversation State Management**:
   - Fetch the last 12 messages from `telegram_chat_history` where `chat_id = :chatId` ordered by `created_at ASC`.
   - Assemble `contents` array with alternating `user` and `model` roles.
4. **File Extraction & User Prompt Construction**:
   - Extract documents/images using `_telegramFiles.js`.
   - Add inline image/PDF data and extracted text to the latest `user` turn.
5. **Gemini Loop with Function Calling**:
   - Call Gemini with rotated keys from `_keyPool.js`.
   - Model name: `gemini-flash-lite-latest` (or `gemini-2.5-flash`).
   - Support tool calling loop: if Gemini returns `functionCalls`, execute them via `_botTools.js`, append results, and call Gemini again until final text response is produced.
6. **Delivery & Persistence**:
   - Send text responses via `sendTelegramMessage`.
   - Save the user message and final assistant reply into `telegram_chat_history`.
   - Prune old entries exceeding 30 messages per `chat_id`.

---

## Phase 6: System Prompt & Behavioral Guidelines

Set the agent system prompt in `api/ai-agent/bot.js`:
- Identity: **El-Bashmebasamag (الباشــمبصمج)**, smart study helper for **منصة امتحانات بصمجي**.
- Tone: Encouraging, academic, concise, formatted for mobile messaging.
- Workflow for Exam Creation:
  - First show a clear preview of the proposed questions in chat.
  - Ask the user to confirm (e.g. "تمام", "أنشئ") and choose the desired format (`HTML`, `PDF`, `Markdown`, `JSON`).
  - Upon confirmation, trigger `generate_quiz_file` to send the document immediately.
- Workflow for Platform Search:
  - Provide direct web links (`https://basmagi-quiz.vercel.app/q/:id` or `/lesson/:id`).
  - Offer and send the standalone interactive `.html` quiz file for offline studying.
  - For Word (`.docx`) or PowerPoint (`.pptx`), provide instructions and direct links to the website's export modal.

---

## Verification & Deployment Checklist

1. [ ] Remove `api/upload-folder.js` and verify total API functions count is <= 12:
   ```powershell
   (Get-ChildItem "api" -Recurse -File -Include "*.js" | Where-Object { $_.Name -notlike "_*" }).Count
   ```
2. [ ] Install `pdfkit`:
   ```powershell
   npm install pdfkit
   ```
3. [ ] Push database migration:
   ```powershell
   supabase db push
   ```
4. [ ] Commit and create archive:
   ```powershell
   npm run zip
   git push
   ```
5. [ ] Live Testing on Telegram:
   - Verify multi-turn memory: greeting -> follow-up question.
   - Search test: query for university courses and request a quiz.
   - File creation test: send an image or text document, preview questions, confirm, and receive `.html` and `.pdf` files.
   - Format test: verify standalone `.html` opens and scores offline in browser.
