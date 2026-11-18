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
