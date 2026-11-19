# AI Agent: Improvements Implementation Plan

Based on the 9 recommendations from the last session and a read of the current source files in the zip. (`ai-agent-fixes.patch` in the zip root belongs to the earlier fixes, not to these recommendations; the plan doesn't depend on it.)

**How to use this plan.** Each phase below is one self-contained patch, delivered as `git apply --ignore-whitespace <name>.patch` (repo files are CRLF; patches keep CRLF). Do them in order. Every phase lists files, steps, tests, a verification checklist, and rollback. Phases 0–4 are low risk. Phase 5 is medium. Phase 6 (streaming) is the big one.

---

## 0. Summary

| Phase | Recommendation | Patch | Risk | Size |
|---|---|---|---|---|
| 0 | #7 Tests for the loop (safety net) | `ai-agent-p0-tests.patch` | None | S |
| 1 | #1 Quota counts once per user turn | `ai-agent-p1-quota.patch` (+ migration) | Medium (DB + API + client) | M |
| 2 | #9 Prompt audit + guard test | `ai-agent-p2-prompts.patch` | Low | S |
| 3 | #3 Parallel read-only tools | `ai-agent-p3-parallel.patch` | Low | S |
| 4 | #4 Trim the context sent on each step | `ai-agent-p4-context.patch` | Low–Medium | M |
| 5 | #6 Undo for destructive tools | `ai-agent-p5-undo.patch` | Medium | M |
| 6 | #8 (partial) + #2 Extract turn runner, then streaming | `ai-agent-p6a-split.patch`, `ai-agent-p6b-streaming.patch` | High | L |
| 7 | #5 Shared tool schemas and authoring text | `ai-agent-p7-shared-schemas.patch` | Low–Medium | M |
| 8 | #8 (rest) Split the big files | several small patches | Low each, tedious | M |

Why this order: tests first so every later phase is checked against the loop's current behaviour. Quota next because it is the biggest cause of "the agent stopped". Prompt audit, parallel tools and trimming are small wins that make the agent faster and cheaper before the big changes. Streaming comes after the turn runner is extracted, because both touch `resendLastUserTurn`.

**Deploy order (every phase that touches `api/`):**
1. Run any SQL migration first (additive, safe with the old code still live).
2. Rebuild the edge bundle: `npm run build:edge ai-chat` (this regenerates `supabase/functions/ai-chat/index.ts`; commit it). Deploy it only if you use the edge host: `supabase functions deploy ai-chat --no-verify-jwt`. `api-base.js` has `"ai-chat": false` by default, so Vercel is the live host unless you opted in.
3. Deploy the Vercel app (front-end and `api/`).

The new code stays compatible with the old front-end and the old migration state, so a half-finished deploy never breaks the agent.

---

## Phase 0: Safety-net tests (#7)

**Goal:** lock in the loop behaviour fixed last time, so later phases can't quietly break it.

**Files**
- New `tests/agent-loop.test.js`
- New `tests/helpers/fake-chat.js` (scripted `fetch` stub)
- `package.json`: add `"test:ai-agent": "node --test tests/ai-agent-*.test.js tests/agent-loop.test.js"` (there is no `test` script today; existing tests run with `node --test`).

`core/agent-loop.js` has no DOM imports, so it runs in plain Node 22. The stub replaces `globalThis.fetch` and returns scripted `{text, toolCalls}` bodies for `/api/ai-agent/chat`.

**Cases to write**
1. Two `search_library` calls with different `query` both execute (the original bug).
2. Three `create_quiz` calls in one turn all execute.
3. Exact duplicate call (same name, same input, key order different) returns the "already done" tool result and the turn continues to the model's final answer.
4. Three consecutive all-duplicate steps stop the loop with `success: true`.
5. A tool throws 5 times, then succeeds: the loop keeps going; each error is pushed as `role:"tool", isError:true`; `sessionExecutedTools` no longer contains the failed signature.
6. Abort during a tool call returns `{aborted:true}` and marks remaining cards `aborted`.
7. `maxDepth` reached returns the Arabic error; `maxDepth: Infinity` does not.
8. History shape: every tool call id has exactly one `role:"tool"` reply, in call order.

**Verify:** `npm run test:ai-agent` is green on the current code. This phase changes no product code.

**Rollback:** delete the new files.

---

## Phase 1: Quota counts once per user turn (#1)

**Problem.** `chat.js` calls `increment_ai_agent_usage` once per request, and the loop sends one request per model round-trip. "Create 3 quizzes" can use 5+ of the 15. A turn can also die half-done because step 4 hit the limit.

**Design.** The client sends a `turnId` (UUID, one per user message). The server charges the daily counter once, on the first step of a turn. Later steps of the same turn are free, but only while the turn is still "live": under 60 steps and under 15 minutes old. That cap means a client that reuses one `turnId` forever gains nothing beyond one turn's worth of steps. A request without a valid `turnId` is charged per request exactly as today, so old cached front-ends keep working.

### 1a. Migration: `supabase/migrations/<timestamp>_ai_agent_turn_quota.sql`

```sql
CREATE TABLE IF NOT EXISTS public.ai_agent_turns (
  profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  turn_id    uuid NOT NULL,
  steps      integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, turn_id)
);
CREATE INDEX IF NOT EXISTS ai_agent_turns_started_at_idx ON public.ai_agent_turns (started_at);
ALTER TABLE public.ai_agent_turns ENABLE ROW LEVEL SECURITY;  -- no policies: service role only

CREATE OR REPLACE FUNCTION public.increment_ai_agent_usage_turn(
  p_profile_id uuid,
  p_turn_id uuid,
  p_daily_limit integer,
  p_max_steps integer DEFAULT 60,
  p_turn_ttl interval DEFAULT interval '15 minutes'
)
RETURNS TABLE(allowed boolean, usage_count integer, charged boolean) AS $$
DECLARE
  v_today date := (timezone('utc'::text, now()))::date;
  v_count integer;
  v_steps integer;
BEGIN
  IF random() < 0.02 THEN
    DELETE FROM public.ai_agent_turns WHERE started_at < now() - interval '2 days';
  END IF;

  -- 1) Continuation of a live turn: free step.
  UPDATE public.ai_agent_turns
     SET steps = steps + 1
   WHERE profile_id = p_profile_id AND turn_id = p_turn_id
     AND steps < p_max_steps AND started_at > now() - p_turn_ttl
  RETURNING steps INTO v_steps;

  IF v_steps IS NOT NULL THEN
    SELECT CASE WHEN ai_agent_usage_date = v_today THEN ai_agent_usage_count ELSE 0 END
      INTO v_count FROM public.user_profiles WHERE id = p_profile_id;
    RETURN QUERY SELECT true, COALESCE(v_count, 0), false;
    RETURN;
  END IF;

  -- 2) New (or expired / over-long) turn: charge one unit atomically, only if under the limit.
  UPDATE public.user_profiles
     SET ai_agent_usage_count = CASE WHEN ai_agent_usage_date = v_today THEN ai_agent_usage_count + 1 ELSE 1 END,
         ai_agent_usage_date  = v_today
   WHERE id = p_profile_id
     AND (ai_agent_usage_date <> v_today OR ai_agent_usage_count < p_daily_limit)
  RETURNING ai_agent_usage_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT CASE WHEN ai_agent_usage_date = v_today THEN ai_agent_usage_count ELSE 0 END
      INTO v_count FROM public.user_profiles WHERE id = p_profile_id;
    RETURN QUERY SELECT false, COALESCE(v_count, 0), false;   -- at limit, or no such profile
    RETURN;
  END IF;

  INSERT INTO public.ai_agent_turns (profile_id, turn_id, steps, started_at)
  VALUES (p_profile_id, p_turn_id, 1, now())
  ON CONFLICT (profile_id, turn_id) DO UPDATE SET steps = 1, started_at = now();

  RETURN QUERY SELECT true, v_count, true;
END;
$$ LANGUAGE plpgsql;
```

Leave the old `increment_ai_agent_usage` untouched (the fallback path uses it). Note the new function does **not** keep incrementing past the limit on denied attempts; the old one does.

### 1b. API
- New `api/ai-agent/_quota.js` exporting `chargeAgentTurn({ rpc, profileId, turnId, dailyLimit, maxSteps = 60 })`. The Supabase client is injected so it can be unit-tested. If `turnId` is not a UUID, call the old RPC (per-request charge).
- `api/ai-agent/chat.js`: read `turnId` from `req.body`; replace the `checkAndIncrementDailyUsage` call with `chargeAgentTurn`. Keep the 429 body (`dailyLimit`, `usageCount`). Update the header comment block (it still describes per-request metering). On success for non-admin platform-key requests, add `quota: { used, limit }` to the JSON so the UI can show "x of 15 messages today" later (optional UI, not part of this patch).
- Keep fail-closed behaviour on any RPC error.

### 1c. Client
- `core/agent-loop.js`: new param `turnId` (default `crypto.randomUUID()` when omitted), sent in the request body on every step of the turn.
- `ai-agent-chat.js` `resendLastUserTurn`: create one `turnId` per call and pass it to `runAgentLoop`. A retry of the same step (network blip) reuses it, so it stays free.

### 1d. Tests
- `tests/ai-agent-quota.test.js` with a fake `rpc`: invalid `turnId` → legacy RPC; valid → new RPC with the right args; RPC error → `allowed:false`; `charged` flag passed through.
- `tests/agent-loop.test.js`: every request in one turn carries the same `turnId`; a new turn gets a new one.
- SQL checks (run on a Supabase **branch** first, using the Supabase connector if attached, otherwise `supabase db reset` locally):
  1. First call of a turn: `allowed=true, charged=true`, count +1.
  2. Second call, same turn: `allowed=true, charged=false`, count unchanged.
  3. 61st step of the same turn: charged as a new unit.
  4. Same `turn_id` after 15 minutes: charged as a new unit.
  5. At limit (15): new turn → `allowed=false`, count stays 15 (not 16); an in-flight turn's later steps still pass.
  6. Day rollover: count resets to 1.
  7. Unknown profile id → `allowed=false`.

**Verify (manual):** with a non-admin anonymous profile, send "create 3 quizzes" and check `user_profiles.ai_agent_usage_count` went up by exactly 1. Then hit the limit and confirm the Arabic 429 message appears on the next *new* message, not midway through a turn.

**Rollback:** the old code path still works; revert `chat.js` and the client, and leave the table in place.

**Decisions I assumed (change if wrong):** limit stays at 15 per day, but now counts messages (so it is effectively much more generous); free-step cap 60 (just above `DEFAULT_MAX_DEPTH = 50`).

---

## Phase 2: Prompt audit and a guard test (#9)

**Confirmed leftovers**
1. `api/ai-agent/_tools.js` → `RESET_QUIZ_PAGE_TOOL.description` still says "this page only supports one tool call per turn". That is false now and steers the model away from valid multi-step plans. Rewrite: use `edit_quiz` to replace the quiz; use `reset_quiz_page` only for "clear and stop".
2. **Contradiction:** `CREATE_QUIZ_PAGE_SYSTEM_PROMPT` tells the model to *show the proposed content and ask for confirmation* before `edit_quiz`, while `EDIT_CURRENT_QUIZ_TOOL.description` says "Execute immediately when the requested edit is clear", and slash commands inject "no confirmation". The model gets mixed orders on that page. Proposed resolution: execute immediately for partial edits; keep a confirmation only when `questions` replaces the whole list. Decide this before editing the text (see Questions).
3. Telegram bot (`bot.js`): `MAX_TOOL_LOOPS = 5` is the same kind of arbitrary cap. The real limit is `maxDuration = 60`. Replace the count with a time budget (stop starting new tool rounds after about 45 s) and keep a high count ceiling (for example 12).

**Read-through checklist** (one pass each, note anything stale, contradictory or referring to a removed tool): `HOME_PAGE_SYSTEM_PROMPT`, `CREATE_QUIZ_PAGE_SYSTEM_PROMPT`, `LESSON_PAGE_SYSTEM_PROMPT`, `CREATE_LESSON_PAGE_SYSTEM_PROMPT`, `NOTEBOOK_PAGE_SYSTEM_PROMPT` in `ai-agent-default-prompts.js`; bot `SYSTEM_PROMPT`; every `description` in `_tools.js` and `_botTools.js`.

**Guard test:** `tests/ai-agent-prompts.test.js`
- No prompt or tool description matches `/one tool call|only one tool|ONE tool|per turn|once per reply/i`.
- Every identifier in a prompt that equals a key of `TOOLS_BY_NAME` exists, and (for the web agent) appears in that page's `toolNames` list (the lists live in `user-content-view.js`, `create-quiz.js`, and the lesson/notebook pages; export them as constants so the test can import them, or hard-code the expected sets in the test).

**Verify:** test green; manual check on the quiz editor page: "replace this quiz with a new one about X" executes in one step.

---

## Phase 3: Parallel read-only tools (#3)

**Honest expectation:** these tools are local (localStorage and the manifest), so the gain is small. Most of a turn's time is model round-trips. It is still a cheap, contained change, and it matters when `parse_item_info` has to fetch a manifest.

**Files:** `core/agent-loop.js`, `tests/agent-loop.test.js`.

**Steps**
1. Add `PARALLEL_SAFE_TOOLS = new Set(["search_library","parse_item_info","get_user_activity","get_creator_info","get_authoring_guide","fetch_attached_quiz","fetch_attached_lesson"])` and a `parallelSafeTools` param.
2. Refactor the per-call body of the execution loop into `runOne(entry)` that returns `{ok, resultText}` or `{ok:false, err}` with no history writes.
3. Walk the queue in order. Consecutive safe calls form a batch run with `Promise.allSettled`. A mutating call is a barrier: it runs alone, in its original position, after the batch before it finishes.
4. Apply results to `history`, cards and `sessionExecutedTools` **sequentially in original call order** after each batch (tool replies must stay paired and ordered for Gemini and Claude). Compute duplicate signatures before starting a batch so two identical calls in one batch don't both run.
5. Persist history once per batch, not once per call.
6. Abort: check `signal.aborted` after each await; mark unfinished cards `aborted`.

**Tests:** three delayed searches finish in about the time of one (use fake timers or measured delays); history order equals call order; one failing call in a batch doesn't block the others; `[search, create_quiz, search]` runs strictly in order; duplicate inside a batch runs once.

**Rollback:** `parallelSafeTools: new Set()` turns it off without reverting.

---

## Phase 4: Trim the context sent on each step (#4)

**Problem.** `toWireMessage` re-sends the whole `history` on every step: full tool results, full `create_quiz` payloads inside old `toolCalls`, and every old attachment as base64. That costs tokens and latency, and base64 in old messages can push a request past Vercel's 4.5 MB body cap (the 3 MB limit in `chat.js` is checked per message, not per request).

**Rules** (pure function, new file `core/context-trim.js`, called from `toWireMessage` in `ai-agent-chat.js`; the persisted history is never modified):
- "Current turn" = everything after the last non-tool user message. It is never trimmed.
- Older `role:"tool"` results over about 600 chars become the first 300 chars plus `…[trimmed N chars]`. The message and its `toolCallId` stay, so pairing is intact.
- Older user attachments: keep the base64 for the last 2 user turns only; earlier ones become a text marker (`[attachment: name]`). Platform-item attachments already travel as text, so they are unaffected.
- A size guard `estimateWireBytes(messages)`: if over about 3.5 MB, trim the oldest attachments first.
- Stage 2, behind a flag (`trimOldToolInputs`, default off until verified per provider): in older assistant `toolCalls`, replace heavy `input` payloads (`create_quiz`, `create_lesson`, `create_notebook`, `edit_item`, `edit_quiz`, `create_flashcards`) with a summary of identifying fields and counts. Keep `id`, `name` and `thoughtSignature` exactly as they are. Risk: the model may imitate the stub, so test it on all three providers before enabling.
- `history[0]` keeps its injected page context; never drop messages in this phase.

**Measure first:** log wire bytes before and after in dev (`console.debug`). Acceptance: at least 40% fewer bytes on a recorded 3-quiz conversation.

**Tests (`tests/context-trim.test.js`):** current turn untouched; every tool message still matches an assistant `toolCalls[].id`; idempotent; `history[0]` context preserved; attachment rules; size guard.

**Optional follow-up (measure first):** Anthropic prompt caching in `callClaude` (`cache_control` on system and tools). Only helps the Claude provider.

---

## Phase 5: Undo for destructive tools (#6)

**What I found:** `delete_quiz` (`user-content-view.js`) hard-deletes with `setInStorage`, although a trash exists (`moveToTrash`, `restoreTrashBatch(batchId)` in `user-content-trash.js`). Undo is mostly free once delete uses the trash. The quiz editor also already has its own history (`pushHistorySnapshot` / `resetHistory`).

**Design**
- Handlers get an optional second argument: `handler(toolCall, ctx)` with `ctx.registerUndo({ label, run, isStale })`. Handlers that don't use it are unchanged.
- `ai-agent-chat.js` keeps `cardsByCallId` (filled in `onToolCallStart`) and builds `ctx` per call in `executeToolCall`; `registerUndo` calls `card.setUndo(label, run, isStale)`.
- `tool-call-card.js`: new `setUndo()` renders a small "تراجع" button on a successful card. After a click the card shows "reverted" and the button is removed. If `isStale()` is true (the item was changed after the tool ran, checked via `meta.updatedAt`), the button is disabled with an explanation.
- After an undo, queue a one-line note ("[the user undid: …]") that `serializeWireMessage` prepends to the next user message, so the model doesn't assume the change still exists.

**Per tool**
| Tool | Undo |
|---|---|
| `delete_quiz` | Change to `moveToTrash([match], title)`; undo = `restoreTrashBatch(batchId)`. |
| `edit_quiz` (home) | `structuredClone` the entry before; undo writes it back if `updatedAt` still matches. |
| `edit_item` | Same snapshot approach (`tool-registry.js`). |
| `edit_current_quiz` / `reset_quiz_page` (editor) | Call `pushHistorySnapshot()` first (already done for edit); undo = the editor's own undo. Add the snapshot to `handleAiResetPageToolCall` too. |
| `create_*` | Out of scope (possible follow-up: undo = move to trash). |

Undo stays available while the card is on screen in this session. After a page reload the trash entry (for deletes) still exists in the trash panel.

**CSS:** small button in `ai-agent.css` matching the tool-card style.

**Tests:** trash round-trip for delete; stale detection; card `setUndo` toggling (needs `jsdom`, or test the pure `isStale`/snapshot helpers in Node).

---

## Phase 6: Streaming (#2), preceded by extracting the turn runner (#8, partial)

### 6a. Extract the turn runner (zero behaviour change)
- Move the body of `resendLastUserTurn` (about 150 lines) into `core/turn-runner.js` as `runTurn(deps)`, with DOM actions passed in as callbacks (`appendMessage`, `appendError`, `createToolCallCard`, typing controller, persistence).
- Verify: `npm run test:ai-agent`, `node --check` on touched files, and the manual smoke list at the end.

### 6b. Streaming

**Server (`api/ai-agent/chat.js`, `_providerClients.js`)**
- Accept `stream: true`. Respond `text/event-stream` with events: `thinking` (delta), `text` (delta), `toolCall` (complete call), `done`, `error`. Set `Cache-Control: no-store`, `X-Accel-Buffering: no`; add `export const maxDuration = 60`.
- Refactor each provider into a shared **request builder** plus two executors (`json` and `stream`) so the two paths can't drift:
  - Gemini: `:streamGenerateContent?alt=sse`; collect `thought:true` parts as thinking; tool calls arrive whole; keep `thoughtSignature`.
  - Claude: `stream:true`; accumulate `input_json_delta` per block and emit the call at `content_block_stop`.
  - DeepSeek: `stream:true`; accumulate `delta.tool_calls` by `index`.
- Errors before the first byte return a normal JSON error with the existing status mapping (429 / 503 / 502). Errors after that are an SSE `error` event.
- Quota is charged before streaming starts (unchanged). `recordPlatformUsage` runs after the stream ends. If the client disconnects (`req.on("close")`), abort the upstream fetch so no tokens are burned.
- **Edge host caveat:** `supabase/functions/_shared/node-adapter.ts` buffers `res.write` until `end()`, so the edge version of `ai-chat` returns the whole stream at once. It still works, just without the streaming feel. Updating the adapter to a `ReadableStream` is a separate follow-up.

**Client**
- `agent-loop.js`: replace `await response.json()` with `readChatResponse(response, handlers)`. It parses SSE incrementally (`TextDecoder` with `stream: true`, so Arabic characters split across chunks are safe) or falls back to `response.json()` when the content type isn't `text/event-stream`. It returns the same `{text, thinking, toolCalls}` object, so the loop logic below it doesn't change. Add `stream: true` to the request body behind a flag (`localStorage "basmagi_ai_stream"`, default on after testing).
- UI: new `onAssistantStream({text, thinking})` callback. The first delta creates the assistant bubble; later deltas update it with `renderMarkdown`, throttled to about 60 ms with `requestAnimationFrame` (re-rendering per token is quadratic). The final text replaces the content; no second bubble is created.
- Abort cancels the reader and the fetch; partial text is kept in the bubble and in history.

**Tests**
- SSE parser: events split across chunk boundaries, multi-byte split, `error` event, missing `done`.
- Provider stream assemblers fed recorded fixtures in `tests/fixtures/ai-agent-stream/` (one per provider: text only, tool call, text plus tool call).
- `agent-loop` with a fake streaming `Response`.

**Manual matrix:** 3 providers × (text only, tool call, text + tool, abort mid-stream, mid-stream provider error) × (platform key, own key). Also check the quota counter moves once per message.

**Rollback:** the flag; or send `stream:false` and everything behaves as before.

---

## Phase 7: Share schemas and authoring text with the Telegram bot (#5)

**Reality check.** The two tool sets are mostly different (the bot has `search_courses`, `export_quiz`, and so on). The real overlap is narrower than I first said, but drift has already happened: the bot's `generate_quiz_file.questions.items` lacks `questionKind: "complete"` and `strictMatch`, even though `_botGenerators.js` imports `complete-question.js` and can render fill-in-the-blank questions. The model on Telegram can't ask for them.

**Steps**
1. New `api/ai-agent/_schemas.js` exporting `QUESTION_ITEM_SCHEMA` (one definition, with the Gemini-proto comment about union types preserved) and `LESSON_BLOCK_SCHEMA`.
2. `_tools.js` (`CREATE_QUIZ_TOOL`, `EDIT_QUIZ_TOOL`, `EDIT_CURRENT_QUIZ_TOOL`, `CREATE_LESSON_TOOL`, …) and `_botTools.js` (`generate_quiz_file`, `generate_lesson_file`) import them.
3. Shared authoring text (LaTeX rules, 0-based `correct`, `{{answer|alt}}` syntax, True/False labels) in `public/src/shared/ai-agent-authoring.js`, used by the tool descriptions, by `handleGetAuthoringGuideToolCall` in `tool-registry.js`, and by the bot prompt. (`api/` already imports from `public/src/`, e.g. `_botGenerators.js`, so the pattern exists.)
4. Parity test `tests/ai-agent-schema-parity.test.js`: the bot and web quiz tools reference the same question schema object; the guide text contains the key rules.

**Verify:** `npm run build:edge ai-chat ai-bot` builds; a Telegram request for a fill-in-the-blank quiz now produces `complete` questions in the file.

---

## Phase 8: Split the big files (#8, rest)

Only after everything above. Rules: one extraction per commit, no behaviour change, run `npm run test:ai-agent` and the smoke list after each.

`ai-agent-chat.js` (2.7k lines), in this order:
1. `ai-agent-icons.js`: all `*_SVG` constants.
2. `ai-agent-export.js`: `exportConversation`.
3. `ai-agent-attachments.js`: picker, paste, preview modal, chips.
4. `ai-agent-messages.js`: `appendMessage`, thinking blocks, result-card group, rendering helpers.

Target: `ai-agent-chat.js` under about 1,500 lines. The turn runner was already extracted in 6a.

`ai-agent.css` (4.9k lines): **I recommend not splitting it yet.** Host pages link it directly and several page lists in `scripts/build-web.mjs` reference it, so a split means touching every host page and risks cascade-order bugs for little gain. Revisit if you want it. If you do, split by feature (tool cards, result cards, dropdown/menus, history, composer) and keep the original order.

---

## Smoke checklist (run after Phases 1, 3, 4, 5, 6)

On the home page «محتواي» and the quiz editor, with a platform key and with an own key:
1. "Create 3 quizzes about X": three cards appear, the result cards group at the bottom, the quota counter rose by 1.
2. "Search my library for A, then for B": both searches run.
3. Replace the quiz in the editor; undo it (Phase 5).
4. Attach a PDF, ask a question, then ask two follow-ups: the request still goes through (Phase 4).
5. Stop mid-answer: the UI recovers, no stuck "generating" state.
6. Reopen the saved conversation: cards and history render the same.

## Questions (defaults assumed above)

1. **Quota:** keep the limit at 15, now counted per message? Or raise or lower it?
2. **Editor confirmation (Phase 2):** for the quiz editor page, execute small edits immediately and only ask before replacing the whole question list? Or always ask, or never ask?
3. **Telegram bot cap:** replace `MAX_TOOL_LOOPS = 5` with a time budget (about 45 s) and a ceiling of 12?
4. **Undo scope:** delete, `edit_quiz`, `edit_item`, editor reset only (no undo for create tools)?
5. **Streaming host:** Vercel only for now; edge host stays non-streaming?
6. **Attachments in old turns (Phase 4):** keep base64 for the last 2 user turns only, older ones become a text marker?
7. **CSS split:** skip for now?

---

## Implementation status (updated 2026-11-19)

Delivered as two stacked patches: `ai-agent-improvements.patch` (phases 0-5, 7), then `ai-agent-improvements-2.patch` (phase 6a + this status). Apply them in that order. Test suite: `npm run test:ai-agent`; the full `node --test tests/*.test.js` has 5 failures that also fail on the untouched repo (docs sync, og PNG, gradeEssay LaTeX, two rich-input tests).

| Phase | Status | Notes |
| --- | --- | --- |
| 0. Safety-net tests | Done (patch 1) | `tests/agent-loop.test.js`, `tests/helpers/fake-chat.js`. Also fixed a bug: stopping mid-tool left the remaining cards on "running". |
| 1. Quota per user message | Done (patch 1) | Run migration `20261119120000_ai_agent_turn_quota.sql`. Verified with the 7 SQL checks on PostgreSQL 16. Old front-ends without `turnId` are charged per request. |
| 2. Prompt audit | Done (patch 1) | Stale "one tool per turn" text removed; `ai-agent-page-tools.js` is the single tool list per page; guard tests in `tests/ai-agent-prompts.test.js`; Telegram bot uses a 45 s time budget (`_botLoop.js`) with a no-tools wrap-up call. |
| 3. Parallel read-only tools | Done (patch 1) | `PARALLEL_SAFE_TOOLS` in `agent-loop.js`; mutating calls are barriers; results written in call order. |
| 4. Context trimming | Done (patch 1) | `core/context-trim.js`. Stage 2 (shrinking old tool inputs) is implemented but off by default (`trimOldToolInputs`). |
| 5. Undo | Done (patch 1) | «تراجع» on delete_quiz (now moves to trash), edit_quiz, edit_item, editor edit/reset. Undoing a reset may not restore the editor header title. |
| 6a. Extract turn runner | Done (patch 2) | `core/turn-runner.js` (no DOM); `resendLastUserTurn()` in `ai-agent-chat.js` is now a thin wrapper. `tests/turn-runner.test.js`. Auth resolution now sits inside the try block, so a token failure no longer leaves the panel stuck in "generating". |
| 6b. Streaming (SSE) | NOT done | Not in either patch. See "Remaining work". |
| 7. Shared schemas | Done (patch 1) | `api/ai-agent/_schemas.js`, `public/src/shared/ai-agent-authoring.js`; the Telegram bot can now request fill-in-the-blank questions. Parity tests in `tests/ai-agent-schema-parity.test.js`. |
| 8. File splits | NOT done | Not started. |

### Decisions taken that go beyond the plan
- The home page now offers `create_notebook`, `edit_item` and `get_authoring_guide` (its prompt already promised them).
- Lesson-editor and notebook prompts: clear requests run immediately; confirmation stays for replacing a whole quiz/lesson and for deleting (same rule as the quiz editor).
- The generated bundles `supabase/functions/ai-chat/index.ts` and `ai-bot/index.ts` are NOT in the patches. After applying, run `npm run build:edge -- ai-chat ai-bot` and commit them.

### Remaining work
**6b. Streaming.** Design agreed in the plan; a first server-side draft was written and then dropped from the patches because it has no tests yet. To do, in order:
1. `core/sse.js`: pure incremental SSE parser + `readSse(body, signal)` (shared by server and browser; decode with a streaming `TextDecoder`).
2. `api/ai-agent/_providerClients.js`: split each provider into request builder (`stream` flag: Gemini `streamGenerateContent?alt=sse`, DeepSeek/Claude `stream: true`), response parser, and a stream assembler (Gemini: parts arrive whole; DeepSeek: `tool_calls` fragments accumulate by `index`; Claude: `input_json_delta` pieces joined per block, parsed at `content_block_stop`). Add `openProviderStream()` that throws the same errors as `callProvider` before the first byte.
3. `api/ai-agent/chat.js`: `stream: true` in the body answers with SSE events `thinking` / `text` / `toolCall` / `done` (full result + `quota`) / `error`; errors before the first byte stay normal JSON errors; abort the upstream request when the client disconnects; meter usage after the stream ends; `export const maxDuration = 60`.
4. Client: `agent-loop.js` sends `stream: true`, reads SSE with `readSse`, calls a new `onAssistantStream` callback (already forwarded by `turn-runner.js` as `ui.onAssistantStream`), and falls back to the JSON path if the response is not `text/event-stream`. `ai-agent-chat.js` renders a live assistant bubble.
5. Tests: fixture streams per provider (plain text, text + one tool call, text + two tool calls) fed through the assemblers, SSE parser split at every byte offset, and one end-to-end loop test with a fake streaming `fetch`.

**8. File splits** (pure moves, no behaviour change, one commit each, `npm run build:web` + tests after each): history/storage helpers, attachments, the settings/model menu, and message rendering out of `ai-agent-chat.js`, keeping `createAIAgentFab()` as the public entry point.
