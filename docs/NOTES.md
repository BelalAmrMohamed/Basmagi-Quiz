# Notes

## Password-protected quizzes (migration `20261118120000_quiz_questions_private.sql`)

**Deploy order.** Apply the migration and deploy the matching code together.
The previous front-end still selects `quizzes.data`, which browsers can no
longer read, so quizzes would stop loading if the migration lands first. To
roll back, restore the old column grant on `public.quizzes` (including `data`)
and redeploy the previous code; the new RPCs are harmless to leave in place.

**What changed**
- Browsers cannot read `quizzes.data`. `quiz_public` returns only `meta` and
  `stats` for a protected quiz. The questions come from `unlock_quiz(quiz_id,
  password)` after the server verifies the password. Lessons already worked
  this way.
- `verify_quiz_password` keeps its old contract (returns the stored value, or
  NULL). It is now rate limited like `unlock_quiz`.
- Anything that reads `quizzes` with the **anon** key must read `quiz_public`
  instead. Service-role code (edge functions, `api/*` with the service key)
  is unaffected, and the MCP function already skips protected quizzes.
- New columns on `quizzes` are private to browsers by default. Add them to the
  `GRANT SELECT (...)` list and to the `quiz_public` view if the browser needs
  them.

**Rate limits** (constants at the top of `_quiz_pw_check`): 8 wrong guesses per
client per quiz per 10 minutes, and 150 wrong guesses per quiz overall per 10
minutes. The client key comes from `cf-connecting-ip`, `x-real-ip`, or the last
`X-Forwarded-For` hop. The per-quiz ceiling is the backstop if that header can
be spoofed. Trade-off: a determined attacker can burn the 150 per-quiz guesses
and make real students wait up to 10 minutes. Raise the ceiling if that
happens. Attempts are stored (hashed client key) in
`quiz_password_attempts`, trimmed after a day. To unlock someone manually:
`delete from quiz_password_attempts where quiz_id = '<id>';`

**Behaviour changes to expect**
- A protected quiz now asks for the password wherever its questions are needed
  (quiz page, download, copy). Copying a whole folder skips protected quizzes
  unless they were already unlocked in that tab.
- "Ask the assistant", embedded lesson quizzes and the Telegram bot never read
  protected questions, even after the user unlocks the quiz.
- Admins edit a quiz through the new `get-quiz` admin action (no password
  needed). The password is never returned, only whether one is set.
- Unlocked questions are kept in the tab's `sessionStorage`
  (`bq_unlocked_quiz:<id>`), so the quiz and result pages don't re-ask.
- A short title, description and question count of a protected quiz are still
  public (cards, link previews). Only the questions are hidden.

**Known limits**
- Passwords are still unsalted SHA-256 in the database. That only matters if
  the database itself leaks. Salted hashing would be a separate change.
- A downloaded protected quiz file embeds the stored hash so it stays
  protected offline. Someone who already unlocked it holds the questions.
- The result page may show the password dialog unstyled if its unlock cache
  is missing (not checked against that page's CSS).

## Vercel Hobby plan: 12 serverless functions

The project is at the limit: 12 Node functions in `api/` (`admin`, `ai-agent/bot`,
`ai-agent/chat`, `ai-agent/usage`, `auth`, `college-quiz`, `render-course`,
`render-profile`, `render-quiz`, `seo`, `upload-quiz`, `user-profile`).
Edge functions (`api/og.js`, `api/render-ai-agent.js`, both with
`export const config = { runtime: "edge" }`) do not count. Before adding any
new file under `api/`, make it Edge, put it in a Supabase edge function, or
merge it into an existing handler.

`/ai-agent` and `/my-content/ai-agent` are served by `api/render-ai-agent.js`
(Edge). It fetches the site's own home page and swaps in the agent's title,
description and thumbnail. If that fetch fails (for example a protected
preview deployment) it redirects to `/my-content`.

## محتواي naming cleanup

The local collection is "user content" (quizzes, lessons, notebooks, folders,
courses), not "user quizzes". Renamed:

| Before | After |
|---|---|
| `user-quiz-card.js` | `user-content-card.js` |
| `user-quizzes-folders.js` | `user-content-folders.js` |
| `user-quizzes-view.js` | `user-content-view.js` |
| `user-quizzes-trash.js`, `-trash-panel.js/.css` | `user-content-trash*.js/.css` |
| `copy-to-my-quizzes.js` | `copy-to-my-content.js` |
| `renderUserQuizzesView`, `readUserQuizzes`, `saveUserQuizzes`, ... | `...UserContent...` |
| `.user-quizzes-container`, `.user-quiz-select-checkbox`, `data-user-quizzes-card`, ... | `.user-content-*`, `data-user-content-card` |
| `createUserQuizCard`, `showUserQuizActionsOverlay`, `closeUserQuizContextMenu`, ... | `...UserContent...` |

The Arabic section name «امتحاناتك» became «محتواي» where it names the section
(buttons, notifications, AI agent actions, the how-to page). Plain uses like
"your exams" (page descriptions, "نتائج امتحاناتك") were left alone.

**Deliberately not renamed** (renaming would orphan data or break old links):
- localStorage keys `user_quizzes`, `user_quizzes_trash`,
  `user_quizzes_trash_retention_days`. Every user's saved content lives there.
  Renaming them needs a one-time migration that copies old to new.
- Legacy routes: `#my-quizzes` hashes still work (navigation.js), and
  `sign-in.js` still sends magic links to `/#my-quizzes` because the Supabase
  redirect allow-list may pin that exact URL. Change both together.
- `search-manager.js` and `user-content-view.js` still accept the old
  section name «امتحاناتك» when matching saved folder titles.
- Quiz-specific names (`buildUserQuizEntry`, `playUserQuiz`, `quiz.js`,
  `quiz-data-loader.js`, the `data-quiz-id` attribute) stay: those really are
  about quizzes.
- CHANGELOG.md history was not rewritten.

Run `npm run docs:check` (and `npm run docs:build` if it complains): the
how-to page was edited in both `docs-src` and `public`, and this sandbox
couldn't run the docs build.

## No links for local items

Items saved in محتواي exist only in the user's browser, so a link to them is
dead for everyone else. Local items no longer show or hand out a link:
- Quiz info modal: no "رابط الامتحان" row for a local quiz (lesson and notebook
  info modals already did this).
- AI agent "created item" card: the open action is now a button, not an
  `<a href>` that could be copied.
Links remain for published items only.

## After the SEO/GEO Update (Related to `_catalog.js`)
One thing worth a note for docs/issues.md's Phase 5.3 line: since the profiles lastmod now falls back to created_at (no edit timestamp exists on admin_users), if you ever add an updated_at column to that table for other reasons, it's a one-line swap back in _catalog.js to get accurate profile freshness in the sitemap/feed. Not urgent — just flagging it so it doesn't get lost.

Everything from Phases 0–5 is now implemented and passing against production. Phase 6 remains intentionally untouched as stretch/optional, per the plan.

## Notebook Page Related, C++ Cloud Runtime Related
The `PISTON_TOKEN` secret is not set, its necessary for the backup.

If it's decided to be added, run this Supabase powershell command: 
```shell
supabase secrets set PISTON_TOKEN="your-piston-token"
```