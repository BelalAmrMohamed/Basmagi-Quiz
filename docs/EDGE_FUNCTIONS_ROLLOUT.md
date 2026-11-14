# Moving Vercel functions to Supabase Edge Functions

Handlers in `api/` are bundled **unchanged** into Supabase Edge Functions by
`scripts/build-edge-functions.mjs`, with `supabase/functions/_shared/node-adapter.ts`
translating `Request/Response` <-> `(req, res)`. After editing any `api/*.js` that
a function uses (including `api/_*.js` helpers), run `npm run build:edge` and commit
the regenerated `supabase/functions/*/index.ts`.

| Edge function | Source | Client path(s) it replaces |
|---|---|---|
| `college-quiz` | `api/college-quiz.js` | `/api/colleges`, `/api/delete-quiz`, `/api/reports`, lesson comments |
| `upload-quiz`  | `api/upload-quiz.js`  | `/api/upload-quiz` |
| `ai-chat`      | `api/ai-agent/chat.js`  | `/api/ai-agent/chat` |
| `ai-usage`     | `api/ai-agent/usage.js` | `/api/ai-agent/usage` |
| `ai-bot`       | `api/ai-agent/bot.js`   | Telegram webhook (see step 5) |

## 1. Secrets (same values as the Vercel env vars)
Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(the shim maps the last one to the `SUPABASE_SERVICE_KEY` name the handlers read).
Set the rest (copy from the Vercel project settings):

```bash
supabase secrets set \
  JWT_SECRET=... ALLOWED_ORIGIN=https://<your-vercel-domain> SITE_ORIGIN=https://<your-vercel-domain> \
  INDEXNOW_KEY=... CRON_SECRET=... \
  AI_AGENT_GOOGLE_KEYS=... AI_AGENT_CLAUDE_KEYS=... AI_AGENT_DEEPSEEK_KEYS=... \
  TELEGRAM_BOT_TOKEN=... WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_VERIFY_TOKEN=...
```
Also copy any `*_LIMIT` variables the AI key pool reads (grep `limitEnv` in `api/ai-agent/_keyPool.js`).
`ALLOWED_ORIGIN` must contain your **current** Vercel domain, otherwise browsers block the responses (CORS).

## 2. Deploy (functions do their own auth, so JWT verification at the gateway is off)
```bash
npm run build:edge
supabase functions deploy college-quiz upload-quiz ai-chat ai-usage ai-bot --no-verify-jwt
```

## 3. Verify each function before switching the client
```bash
FN=https://<ref>.supabase.co/functions/v1
curl -s "$FN/college-quiz?education_type=University" | head -c 300      # list of colleges
curl -s -X POST $FN/upload-quiz -H 'content-type: application/json' -d '{}'   # 401 (no admin token)
curl -s $FN/ai-usage                                                    # usage JSON
```
In the browser console on your site (no release needed):
`localStorage.setItem("basmagi_edge_api", "college-quiz,ai-usage")` then reload and use reports,
colleges list, delete a test quiz. Compare latency in DevTools with the Vercel path. If it is
more than ~150 ms slower at the median, check that the Supabase region is close to your users.

## 4. Switch on (one function at a time, in this order)
Edit `ENABLED` in `public/src/shared/api-base.js`: `college-quiz`, `ai-usage`, `upload-quiz`, `ai-chat`.
Rollback = set it back to `false` (the Vercel routes in `vercel.json` stay in place).

## 5. Telegram bot (`ai-bot`)
Only after the other functions are stable:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<ref>.supabase.co/functions/v1/ai-bot"
```
Keep `api/ai-agent/bot.js` on Vercel for a week as a fallback (re-run `setWebhook` with the
old URL to roll back). WhatsApp: change the callback URL in the Meta dashboard the same way.

## 6. After a week of clean logs
Remove the migrated files from Vercel (`api/college-quiz.js`, ...) only if you no longer want
the fallback. Keep them while `ENABLED` is the rollback switch.

## Known limits
- Rate-limit maps are per-instance memory (same as on Vercel); unchanged behaviour.
- `ai-bot` bundle is ~1.8 MB (pdfkit, mammoth); expect a slower cold start than the others.
- Supabase Edge Functions on the Free plan have request-duration/CPU limits; watch the
  function logs for `546`/timeout errors on `upload-quiz` with large DOCX files.
