# SEO & GEO Implementation Plan — منصة امتحانات بصمجي

> **Status:** Draft (approved for implementation) · **Owner:** developer
> **Scope:** `public/`, `api/`, `vercel.json`, `supabase/`, `scripts/`
> **Goal:** Make the platform fully discoverable by classic search engines (SEO) **and** Generative Engines / LLM answer-machines (GEO — ChatGPT, Perplexity, Gemini, Bing Copilot, Google AI Overviews…), and make Google/Bing know **the moment** a new quiz, folder, or course is added — the same "new YouTube video drops" effect.

---

## 1. Executive Summary

The platform already has a solid foundation:

- Server-rendered meta for `/quiz/:id`, `/course/...`, `/@:handle` produced by `api/render-quiz.js`, `api/render-course.js`, `api/render-profile.js` (title/description/canonical/OG/Twitter + data-islands, edge-cached).
- A dynamic OG-image service (`api/og.js`, Satori) generating 1200×630 thumbnails for quizzes, courses, folders, and profiles.
- Google Search Console verification files present (`google0c1df2c3df22a824.html`, `google67d62c2618576950.html`).

What is **missing** and blocks "instant + whole-platform" discovery:

1. **Sitemap is static, tiny, and wrong** — 7 URLs only, includes `/control` (a noindex page!), omits `/about`, `/how-to-*`, and **all** quizzes, courses, folders, public profiles. Hardcoded `lastmod`.
2. **No discovery signal when content is created** — no IndexNow, no sitemap regeneration/resubmission, no cron, no feed.
3. **No GEO layer** — no `llms.txt` / `llms-full.txt`, no RSS/JSON feed, no explicit allowance for AI crawlers, no structured data (JSON-LD) on any dynamic page.
4. **List pages are empty shells for crawlers** — home/course/folder lists render via client-side JS; a JS-less bot or LLM fetcher sees no content links at all.
5. **Wrong indexability permissions** — `result.html`, `settings.html`, `profile.html`, `offline.html`, `onboarding.html` are indexable or canonicalize to home; only `control`, `oauth-callback`, `reports` are `noindex`.
6. **Stale/removed-page hygiene** — `sign-in.html` is gone but still referenced (`docs/issues.md`); the `index.html` BreadcrumbList JSON-LD uses `.html` URLs and skips `position: 5`; `/control` is advertised in the sitemap.

This plan fixes all of the above in ordered phases with exact file changes and a passing test for each.

---

## 2. Goals & Non-Goals

### Goals
1. **Instant publishing**: When an admin adds/edits/renames a quiz, folder, or course, search engines are told right away (seconds, not weeks).
2. **Whole-platform awareness**: Every indexable entity (static pages + colleges + courses + folders + quizzes + public profiles) is enumerable by any bot: XML sitemap, RSS/JSON feeds, `llms.txt`/`llms-full.txt`, and structured data.
3. **AI answerability (GEO)**: An LLM asked "what is بصمجي / what exams are on it / how do I study for subject X" can answer from our own first-party content.
4. **Clean index**: Removed/utility pages are `noindex`d or 410'd; dead links fixed; canonical URLs consistent.
5. **Measurable**: Search Console + Bing Webmaster wired up, plus an automated `npm run seo:check` so regressions fail fast.

### Non-goals
- Paid ads / link-building / paid SEO.
- Migrating to a full SSR framework. We keep the "serverless meta-injection + data-island" architecture and add *crawlable content islands*.
- Guaranteeing Google **instant** crawl: Google does not support IndexNow and has no public API for submitting arbitrary URLs. We achieve *as fast as Google allows* (fresh sitemap + accurate `lastmod` + resubmission + internal links) and *instant* for Bing/Naver/Seznam/Yandex via IndexNow (§3).

---

## 3. How "new YouTube video → Google knows" actually works for us

YouTube gets crawled fast because it is a Google property. For our site there is no single switch; the real stack is:

| Signal | Consumers | How we trigger it |
|---|---|---|
| Sitemap freshness (`lastmod` changes) | Google, Bing, all crawlers | Dynamic sitemap rebuilt from Supabase, edge-cached ≤1h. Google re-reads sitemaps often; correct `lastmod` speeds discovery. |
| IndexNow protocol | Bing, Naver, Seznam, Yandex | POST to `api.indexnow.org` from the upload path (fire-and-forget). Near-instant. Google does **not** support IndexNow. |
| Google Sitemaps API re-submission | Google | Service-account job re-submits the sitemap URL so Google re-fetches it promptly. Needs Search Console (already verified). |
| Search Console "URL Inspection → Request indexing" | Google | Manual runbook for the most important new URLs (quota-limited). No public API for arbitrary pages. |
| Daily cron sweep | All | Daily Vercel Cron scans `created_at`/`updated_at` of the last 24h and re-announces anything missed (uploads via AI agent, restore, rename…). |
| Internal links (SRR islands) | Google/Bing crawl budget | Real `<a>` links to children on course pages, breadcrumbs on quiz pages. |
| RSS / JSON feeds | LLM crawlers + feed readers | `/feed.xml` + `/feed.json` list the latest entities with OG-image enclosures. |

> **Design principle:** never block, slow, or fail an upload because of SEO notifications — all notifications are fire-and-forget with a best-effort retry queue (`api/_seoNotify.js`, Phase 2).

---

## 4. Current-State Audit

### 4.1 Static pages — indexability & metadata

| Page (clean URL) | robots today | Action |
|---|---|---|
| `/` (index.html) | index,follow | Keep; add Org/WebSite JSON-LD, feed links, fix BreadcrumbList. |
| `/about` | index,follow | Keep; add to sitemap; add Organization JSON-LD. |
| `/create-quiz` | *(none → index)* | Keep index (tool landing); add description meta; sitemap. |
| `/how-to-create-a-quiz` | index,follow | Keep; add to sitemap. |
| `/how-to-upload-a-quiz` | index,follow | Keep; add to sitemap. |
| `/how-to-use-ai-agent` | index,follow | Keep; add to sitemap. |
| `/privacy-policy` | index,follow | Keep; sitemap (already there). |
| `/terms-of-service` | index,follow | Keep; sitemap (already there). |
| `/settings` | index,follow ❌ | **noindex,nofollow**; remove from sitemap. |
| `/reports` | noindex,follow | Keep; not in sitemap. |
| `/result` | *(none → index)* ❌ | **noindex,nofollow**; not in sitemap. |
| `/profile` (private shell) | *(none → index)* ❌ | **noindex,nofollow** (public profile = `/@:handle`, stays indexable). |
| `/onboarding` | index,follow ❌ | **noindex,nofollow** (auth flow; replaced sign-in.html). |
| `/offline` | *(none → index)* ❌ | **noindex,nofollow**. |
| `/control` | noindex,nofollow | Keep; **remove from sitemap** (currently listed — bug). |
| `/oauth-callback` | noindex,nofollow | Keep; not in sitemap. |
| `/quiz.html` (raw template) | *(none)* | Add `noindex` to the template itself (rendered `/quiz/:id` stays indexable). |
| verification files | — | Keep (Google); add Bing meta/file when set up. |

### 4.2 Dynamic pages — current coverage

| Route | Renderer | Injects today | Missing today |
|---|---|---|---|
| `/quiz/:id`, `/q/:id` | `api/render-quiz.js` | title, description, canonical, OG, Twitter, `quiz:id` island, 1h SWR cache | JSON-LD (Quiz + BreadcrumbList), feed `<link>`, visible content island |
| `/course/:full` (+ nested folders) | `api/render-course.js` | title/desc/OG/canonical, `course:*`/`folder:*` islands, counts | JSON-LD (CollectionPage + ItemList of real children + BreadcrumbList); **actual child links as visible HTML** |
| `/@:handle` | `api/render-profile.js` | admin meta islands, title/desc/OG | JSON-LD (ProfilePage/Person), visible summary |
| `/api/og?…` | `api/og.js` (edge) | dynamic OG PNGs | — (works; bump `?v=` only on layout change) |

### 4.3 Content data source (mirrored into sitemap / feeds / llms)

- `quizzes`: `id`, `title`, `data->meta->>id` (public URL id), `data->meta->description`, `data->stats->questionCount/questionTypes`, `course_id`, `folder_id`, `created_at`, `synced_at`, `password`, legacy `path/category/subject/subfolder`.
- `courses`: `id`, `name`, `education_type`, `college`/`college_id`, `year`, `term`, `icon`, `created_at`, `updated_at`.
- `folders`: `id`, `course_id`, `name`, `parent_folder_id`, `created_at`, `updated_at`.
- `admin_users`: `handle`, `display_name`, `avatar_url`, `thumbnail_url` → `/@:handle`.
- `quiz_access`: `quiz_path`, `password_hash`, `is_private`, `allowed_emails` → **exclude any protected quiz from sitemap/feed/llms.**
- Public reads already allowed by RLS (`20260904010000_public_relational_reads.sql`) with the anon key — new endpoints reuse the same anon client pattern as `render-course.js`.

### 4.4 URL-building rules to mirror exactly (zero dead links)

- Quiz URL id = `data->meta->>id` (see `fetchQuizMeta` in render-quiz.js; client `exam-card.js` shares `/quiz/` + `encodeURIComponent(examId)`).
- Course/folder URL = `/course/` + slug chain, where slug = `toSlug(name)` = `name.trim().replace(/-/g,"--").replace(/\s+/g,"-")` — must mirror `public/src/features/home/slug-utils.js` and the copies already in render-course.js / og.js.
- Slug resolution is case/format-insensitive; always emit the canonical slugified form in URLs.
- Profile URL = `/@{handle}`.
- **Disambiguation edge case:** two courses can share a slug (uniqueness is the slot `(education_type, college_id, year, term, name)`). render-course resolves ambiguity via `?education_type=`. The sitemap must append `?education_type=X` only for colliding slugs (exact match against every other course's `toSlug(name)`); otherwise omit.

### 4.5 Other facts shaping the plan

- Vercel: `cleanUrls: true`, `outputDirectory: public`. `api/` files starting with `_` are not exposed as HTTP routes (confirmed pattern: `_courseFolders.js`, `_middleware.js`, …). New shared modules must use the `_` prefix.
- Serverless function count is already large; **do not add new route files where an existing multi-action route can host it** (integration map in Appendix A).
- Content is created from several server paths: `api/upload-quiz.js` (quiz insert), `api/upload-folder.js` (quizzes under folders), `api/_courseFolders.js` (`resolveCourse()` / `resolveFolderPath()` create course/folder rows), `api/admin.js` (rename/move/soft-delete/restore), `api/college-quiz.js` (delete quiz). The notification hook (Phase 2) must cover ALL of them.
- OG versioning: bump `OG_IMAGE_VERSION` in render-quiz.js / render-course.js **only** when the og.js layout changes.

---

## 5. Strategy (five pillars)

1. **Correctness first (Phase 0)** — indexability permissions, canonical consistency, stale references, clean sitemap base.
2. **Enumerability (Phase 1)** — dynamic sitemap + RSS/JSON feeds so every entity is discoverable and machines can diff "what's new".
3. **Publishing signals (Phase 2)** — IndexNow on every content mutation + daily cron sweep + optional Google Sitemaps API resubmission.
4. **AI/LLM readiness (Phase 3) + crawl/render quality (Phase 4)** — llms.txt / llms-full.txt, AI-bot allow-listing, JSON-LD everywhere, visible SSR islands, internal linking.
5. **Measurement (Phase 5)** — Search Console/Bing setup + `npm run seo:check`.

---

## Phase 0 — Housekeeping & correctness (quick wins)

### 0.1 Fix indexability of app/utility pages
Edit these files (add/change the `<meta name="robots">` line right after the existing description meta):
- `public/settings.html` → `noindex, nofollow`
- `public/result.html` → `noindex, nofollow`
- `public/profile.html` → `noindex, nofollow`
- `public/offline.html` → `noindex, nofollow`
- `public/onboarding.html` → `noindex, nofollow` (keep its canonical pointing at home; harmless)
- `public/quiz.html` (raw template) → `noindex, nofollow` (**only** the template; the `/quiz/:id` route keeps `index,follow`)
- `public/create-quiz.html` → add `index, follow` explicitly + a real `<meta name="description">` (it currently has none).

Do **not** touch the renderer-injected pages (`/quiz/:id`, `/course/...`, `/@:handle`) — those stay indexable; `render-profile.js` serves the public profile while `public/profile.html` (private shell) becomes noindex.

### 0.2 Fix the homepage JSON-LD (`public/index.html`)
- The current BreadcrumbList skips `position: 5`, uses `.html` URLs, and omits `/about` + how-to pages.
- Replace items with clean URLs and sequential positions: `1 /` · `2 /about` · `3 /create-quiz` · `4 /how-to-create-a-quiz` · `5 /privacy-policy` · `6 /terms-of-service`.
- Add `WebSite` + `EducationalOrganization` JSON-LD blocks (name, alternateName, url, description, `inLanguage: "ar"`, `sameAs`: GitHub repo `https://github.com/BelalAmrMohamed/Basmagi-Quiz`, X `https://x.com/BelalAmrDev`, portfolio `https://portfolio-of-belal.vercel.app/`).

### 0.3 Remove stale references & dead URLs
- Remove the `sign-in.html` task line from `docs/issues.md` (this plan replaces it). Verified: nothing in `public/` or `api/` references `sign-in.html`.
- Add legacy redirects in `vercel.json` (for old bookmarks/backlinks):
  - `/sign-in.html`, `/sign-in` → `/` (302)
  - `/login.html`, `/login`, `/log-in.html` → `/` (302)
- All internal links should use clean URLs (never `.html`), since `cleanUrls` canonicalizes.

### 0.4 Sitemap correctness (immediate, before Phase 1 dynamism)
Apply §6.2's static part now and drop `/control` from the sitemap. No dead/utility pages listed.

**Acceptance (Phase 0):** curl every page above and assert the correct robots meta; `npm run seo:check` (Phase 5) reports no *indexable* page missing description/canonical.

---

## Phase 1 — Dynamic sitemap + feeds (whole platform enumerable)

### 6.1 Endpoints & routing

| Endpoint | Backing file | Route config |
|---|---|---|
| `/sitemap.xml` | **static index** → `public/sitemap.xml` (sitemap *index* file, not URL list) | none (static file) |
| `/sitemap-static.xml` | static URL list → `public/sitemap-static.xml` | none (static file) |
| `/sitemap-dynamic.xml` | `api/sitemap-dynamic.js` | `vercel.json`: `{"source": "/sitemap-dynamic.xml", "destination": "/api/sitemap-dynamic"}` |
| `/feed.xml` · `/feed.json` | `api/feeds.js` (reads `?format=`) | `{"source": "/feed.xml", "destination": "/api/feeds?format=rss"}`, `{"source": "/feed.json", "destination": "/api/feeds?format=json"}` |
| `/llms-full.txt` | `api/llms-full.js` | `{"source": "/llms-full.txt", "destination": "/api/llms-full"}` (Phase 3) |

`public/sitemap.xml` becomes a `<sitemapindex>` pointing at `/sitemap-static.xml` and `/sitemap-dynamic.xml`. This avoids the static-file-vs-rewrite precedence question entirely and follows Google's sitemap-index guidance.

### 6.2 Static part — `public/sitemap-static.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://basmagi-quiz.vercel.app/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/about</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/create-quiz</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/how-to-create-a-quiz</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/how-to-upload-a-quiz</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/how-to-use-ai-agent</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/privacy-policy</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>
  <url><loc>https://basmagi-quiz.vercel.app/terms-of-service</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>
```

This replaces the current 7-URL `public/sitemap.xml`, drops `/control`, adds `/about` + the three how-to pages + `/create-quiz`.

### 6.3 Dynamic part — `api/sitemap-dynamic.js`

Node.js serverless (same anon-client pattern as render-course.js). Returns `application/xml; charset=utf-8`, `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` (1h fresh SWR 24h — matches render-quiz caching; the daily cron in Phase 2 re-announces anyway).

**Query set (3 parallel queries, anon key):**
1. `quizzes`: `.select("data, password, created_at, synced_at, course_id, folder_id")` — emit one `<url>` per row where `data->meta->id` is non-empty, `password` is NULL/empty **and** no matching `quiz_access.password_hash` (join client-side by `path` from a 4th small query on `quiz_access`), and the quiz has a resolvable course/folder (or legacy path). URL: `https://basmagi-quiz.vercel.app/quiz/{meta.id}`. `lastmod` = `coalesce(synced_at, created_at)`.
2. `courses`: `.select("id, name, education_type, created_at, updated_at")` → `/course/{toSlug(name)}` (append `?education_type=` only for colliding slugs, §4.4). `lastmod` = `coalesce(updated_at, created_at)`.
3. `folders`: `.select("id, course_id, name, parent_folder_id, created_at, updated_at")` → resolve the full ancestor slug chain (walk `parent_folder_id` up to the course, build the path recursively, emit once per node): `/course/{courseSlug}/{folderSlug1}/...`. Use the same slug helpers as render-course.js (single source: copy `toSlug` into a tiny `api/_urls.js` shared module).
4. `admin_users`: `.select("handle, created_at")` with non-null handles → `/@{handle}`. (No `updated_at` column exists on this table — confirmed live via `42703`; `created_at` is the only timestamp available, so profile `lastmod` reflects account-creation time, not last-edit time.)

**Guards:**
- Skip quizzes with no `meta.id`, with passwords, private (`quiz_access`), or whose `data.meta.title` is empty.
- Dedupe slugs by lowercase; skip courses/folders whose slug is empty after `toSlug`.
- Escape XML (`& < > " '`).
- If Supabase fails → return the *static* URLset only (never 500) + `Cache-Control: no-store` so the next request retries.

**Validation step (must-pass):** for 50 random emitted quiz URLs and every course/folder URL, `curl -I` (or headless fetch) returns 200 and contains the right canonical; cross-check 10 random emitted URLs against the exact strings produced by `exam-card.js` / `category-view.js`/`navigation.js` URL builders.

### 6.4 Feeds — `api/feeds.js` (RSS 2.0 + JSON Feed 1.1)

Why feeds for GEO: ChatGPT/perplexity-class crawlers and many aggregators treat RSS/JSON feeds as first-party content channels; a feed also gives us a stable "what changed recently" document we can point IndexNow/crons at.

- One handler, two content types by `?format=rss|json`. Edge cache 15 min (`s-maxage=900`).
- **Feed contents** (limit 50 entries, newest first):
  - Latest public quizzes: `<title>{quiz title}</title>`, `<link>{/quiz/{meta.id}}</link>`, `<description>`, `<guid isPermaLink="true">` = the quiz URL, `<pubDate>` = `coalesce(synced_at, created_at)`, `<enclosure url="{og image}?v=3" type="image/png" length="0"/>`, `<category>{course name}</category>`.
  - New courses and folders interleaved (a rename produces a `lastmod` bump on its entry).
  - Ensures robots/discovery: JSON Feed `home_page_url` + `feed_url`, RSS `<channel><ttl>30</ttl>` and `<lastBuildDate>`.
- **Head `<link>` tags** added to `public/index.html` (and injected by the renderers):
  - `<link rel="alternate" type="application/rss+xml" title="أحدث امتحانات بصمجي" href="https://basmagi-quiz.vercel.app/feed.xml">`
  - `<link rel="alternate" type="application/feed+json" href="https://basmagi-quiz.vercel.app/feed.json">`

### 6.5 `robots.txt` (rewrite now, final version in Phase 3)

```txt
User-agent: *
Allow: /
Disallow: /api/admin
Disallow: /api/auth
Disallow: /api/reports
Disallow: /api/upload-quiz
Disallow: /api/upload-folder
Disallow: /api/user-profile
Disallow: /api/ai-agent
Disallow: /api/delete-quiz
# OG images and the public college listing must stay crawlable:
Allow: /api/og
Allow: /api/colleges

# --- New: allow AI / LLM crawlers explicitly (GEO; full set in Phase 3) ---
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: Bytespider
Allow: /

Sitemap: https://basmagi-quiz.vercel.app/sitemap.xml
# llms.txt: https://basmagi-quiz.vercel.app/llms.txt  (Phase 3)
```

Notes:
- We disallow only the **write/data API surface** (`/api/admin`, `/api/auth`, `/api/reports`, uploads, AI agent, user profile). We explicitly **allow** `/api/og` — crawlers must fetch the OG thumbnail images referenced by every `og:image`/`twitter:image`. Everything else (including the sitemap children and discovery documents) is allowed by the base `Allow: /`; never disallow sitemaps.
- `*` specificity: an AI-bot block later is always added after this base block so its `Allow: /` rules win for those user-agents.
- `/llms.txt`, `/feed.xml`, `/feed.json`, `/llms-full.txt` are statically/dynamically served and stay crawlable (they are discovery documents, not app APIs).

**Acceptance (Phase 1):** `curl https://basmagi-quiz.vercel.app/sitemap.xml` returns a valid `<sitemapindex>` with both children reachable; dynamic sitemap lists ≥1 quiz, all courses/folders, and no `/control`; `/feed.xml` valid (xmllint/tidy or `seo:check`), every feed `<link>` resolves 200.

---

## Phase 2 — Instant publishing signals ("YouTube-like" discovery)

### 7.1 Shared module — `api/_seoNotify.js` (underscore prefix → not a route)

Exports one async function used everywhere content changes:

```js
// Called AFTER a successful DB write. Never throws, never awaits response completion.
export async function notifySearchEngines({
  add = [],   // URLs created or updated (will be announced)
  remove = [],// URLs that should disappear (fed back into the sitemap/feed only)
  reason = "publish",
} = {}) { ... }
```

Behavior:
1. **IndexNow** (Bing/Naver/Seznam/Yandex): build `https://api.indexnow.org/indexnow?url={url1},{url2},...&key={KEY}&keyLocation={KEYLOC}`. The key file lives at `public/{KEY}.txt` (static, protocol requirement). Generate once (e.g. `npm run seo:key` script) and set `INDEXNOW_KEY` env var to the plain key; the concrete public key file is `public/<key>.txt`. Submit at most 1000 URLs per ping; batched via `Promise.race` + 5s timeout; on network/4xx failure push to a simple retry list in a in-memory + `localStorage`-free design (best-effort; the daily cron is the safety net).
2. **Sitemap/feed warm-up (optional but cheap):** fire a GET to `https://basmagi-quiz.vercel.app/sitemap-dynamic.xml` and `/feed.xml` with `Cache-Control: no-cache` to bust the edge cache so the next real bot fetch is fresh. (Vercel edge purge would require paid features; this is the free approach.)
3. **Google:** no direct ping (Indexing API is JobPosting/BroadcastEvent-only). Instead, the daily cron (7.3) re-submits the sitemap via the Google **Sitemaps API** when a service account is configured. Until then, Google benefits from the fresh `lastmod` + sitemap re-read.
4. Always resolve/log: `console.log("[seoNotify]", reason, add.length, remove.length)`.

`remove` URLs are *not* submitted to IndexNow (the protocol has no delete verb). Their removal is handled by the sitemap/feed being rebuilt server-side (they simply stop appearing), and by serving HTTP **410** for known-deleted IDs if we add a tiny redirect rule (optional; Vercel rewrite — see 7.4).

### 7.2 Integration points (exact call sites — Appendix A expands each)

| File | Where | What to notify |
|---|---|---|
| `api/_courseFolders.js` | `resolveCourse()` — inside the `if (insertErr)` retry else after successful `insert` | add: `/course/{toSlug(name)}` |
| `api/_courseFolders.js` | `resolveFolderPath()` — after successful `insert` of each segment | add: full `/course/{courseSlug}/…/{newFolderSlug}` URL |
| `api/upload-quiz.js` | after `supabase.from("quizzes").insert(...)` succeeds (single-quiz branch) | add: `/quiz/{data.meta.id}`; if an existing quiz was *updated* in place, also add its URL |
| `api/upload-folder.js` | after each `quizzes` insert in the folder loop | add each `/quiz/{meta.id}` + new folder/course URLs created by `resolveCourse`/`resolveFolderPath` (dedupe) |
| `api/admin.js` | `rename-item` action after DB update; `move-item` after update | rename: add new URL, remove old URL; move: add new URL, remove old URL |
| `api/admin.js` | `delete-*` + `restore-*` actions after success | delete: remove URLs (batch); restore: add URLs back |
| `api/college-quiz.js` | quiz delete branch | remove: `/quiz/{id}` |

Rule of thumb: **one `notifySearchEngines` call per top-level request handler, after the transaction is confirmed**, never inside loops (batch the URL lists).

### 7.3 Vercel Cron sweep — `api/cron-seo.js`

- Add to `vercel.json`: `"crons": [{ "path": "/api/cron-seo", "schedule": "0 4 * * *" }]` (04:00 UTC daily; check your Vercel plan's cron quota — Hobby allows a small number of crons).
- Handler guards with the Vercel Cron secret header (`x-vercel-cron` + `Authorization`), else 403.
- Job logic:
  1. Query `courses`/`folders`/`quizzes` where `updated_at`/`created_at` ≥ now−24h (same filters as sitemap §6.3 incl. password exclusion).
  2. Build URLs via `api/_urls.js`, then call `notifySearchEngines({ add: urls, reason: "cron" })`.
  3. Fetch `/sitemap-dynamic.xml?nocache=<ts>` and `/feed.xml?nocache=<ts>` to revalidate edge caches.
  4. If `GOOGLE_SERVICE_ACCOUNT_*` envs are configured (Phase 2b), also re-submit `sitemap.xml` via the Google Sitemaps API and log the result.
  5. Log counts; keep the whole run under the function timeout (queries are indexed).

### 7.4 Handle removed URLs correctly (410 vs 404)

- Deleted quizzes keep their old URL 404-ing today. Better: `api/college-quiz.js` delete branch can't change the past; instead add a **known-deleted registry** by inserting a tombstone row into a small new table `seo_tombstones` (`url text primary key, deleted_at timestamptz`) from the delete/soft-delete paths, and create `api/tombstone.js` (rewrite rules `"/quiz/:id"`, `"/course/:full"` → `"/api/tombstone?...` placed **before** the existing renderer rewrites in `vercel.json`) that answers **410 Gone** for tombstoned URLs and falls through to the normal renderer otherwise. (Keep URL matching exact and safe.)
- Simpler alternative if a new table/rewrite ordering proves fiddly: let deleted URLs 404 (fine for SEO — Google treats 404/410 the same for removal) and rely on sitemap regeneration to drop them. **Decision to confirm at implementation:** do the 410 tombstone only if the Rewrite ordering test passes cleanly.

### 7.5 (Phase 2b, optional) Google automation

Google's official levers for generic pages:
1. **Google Sitemaps API** (`PUT https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps/{sitemapPath}`) using a service account added to the Search Console property → re-submitting the sitemap makes Google re-read it promptly. This is the highest-leverage Google automation available to us.
2. **URL Inspection "Request indexing"** — UI only, no public API; include a runbook: after a bulk upload, open Search Console → URL Inspection for the top 5–10 new URLs and click "Request indexing" (about 2/day/URL allowed).

Env to document: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (or a JSON key env), `GOOGLE_SITE_URL`. Wire into cron-seo step 4. **Not a blocker** — the site still gets discovered via sitemap freshness without it.

**Acceptance (Phase 2):** run an end-to-end upload of a test quiz/course/folder against a staging deploy → within seconds a `seoNotify` log line appears, IndexNow responds 200 (Bing receives pings), the dynamic sitemap contains the new URLs after ≤1h, and the daily cron (or manual trigger) reports the same URL set.

---

## Phase 3 — GEO / AI-engine discoverability

### 8.1 `public/llms.txt` (static, hand-written, always current)

Follows the [llmstxt.org](https://llmstxt.org) convention. This is the file ChatGPT/Perplexity/Claude/lm.systems-style tooling reads first. Draft:

```txt
# منصة امتحانات بصمجي | Basmagi - Quiz Platform

> منصة تعليمية عربية مجانية تحتوي على مكتبة امتحانات تفاعلية خاصة بكلية
> الحاسبات والمعلومات ولجميع المراحل التعليمية، مع أسئلة اختيار من متعدد
> وصح/خطأ ومقالي، وشرح لكل سؤال، وتصحيح فوري، ونسخ لامتحاناتك، ومتابعة
> تقدمك، ومساعد ذكاء اصطناعي (الباشمبصمج).

## المميزات الأساسية
- [إنشاء امتحاناتك التفاعلية](https://basmagi-quiz.vercel.app/create-quiz): أنشئ امتحانًا بصيغ اختيار من متعدد، صح/خطأ، ومقالي مع شرح وصور وفيديو.
- [كيفية إنشاء امتحان](https://basmagi-quiz.vercel.app/how-to-create-a-quiz): دليل خطوة بخطوة.
- [كيفية رفع امتحان للمشرفين](https://basmagi-quiz.vercel.app/how-to-upload-a-quiz): دليل الإدخال الجماعي.
- [الباشمبصمج — مساعد AI](https://basmagi-quiz.vercel.app/how-to-use-ai-agent): مساعد ذكاء اصطناعي لفهم وشرح الأسئلة وتحضير الامتحانات.

## التخصصات والمواد (قائمة كاملة محدثة باستمرار)
- [القائمة الكاملة للمواد والمجلدات والامتحانات العامة](https://basmagi-quiz.vercel.app/llms-full.txt)
- [آخر الامتحانات والمواد المضافة (RSS)](https://basmagi-quiz.vercel.app/feed.xml)
- [خريطة الموقع الشاملة (Sitemap)](https://basmagi-quiz.vercel.app/sitemap.xml)

## عن المنصة
- [قصة المنصة](https://basmagi-quiz.vercel.app/about)
- المنصة مجانية بالكامل، باللغة العربية، وتعمل على جميع الأجهزة، ولا تتطلب إنشاء حساب لحل الامتحانات العامة.
```

Rules to enforce by convention:
- Never list URLs that are `noindex` (control/settings/result/profile shell…) here.
- Keep the "مميزات" section short; point to `llms-full.txt` for exhaustive enumeration.

### 8.2 `api/llms-full.txt` / `api/llms-full.js` (dynamic, exhaustive)

Same query set as §6.3 (reuse a shared `api/_catalog.js` that returns the full typed catalog: colleges → courses → folders → quizzes with title/description/count). Rendered as plain text in the llms.txt style:

```txt
# منصة امتحانات بصمجي — الفهرسة الكاملة

## كلية الحاسبات والمعلومات
### مقرر {course name} (قسم/نظام {edu}, سنة {year}, ترم {term})
- مجلد {folder name}: {n} امتحان
  - [امتحان {title}]{url} — {n} سؤال ({types}), {description}
```

- Edge cache 1h (`s-maxage=3600, stale-while-revalidate=86400`); `Content-Type: text/plain; charset=utf-8`.
- **Excludes** password-protected/private quizzes (same guard as sitemap).
- **Cap:** if the catalog grows past ~100k lines, fall back to "top-level course list + per-course llms files" (`/llms-full/{courseSlug}.txt`) and link them from llms.txt — note in the code; not needed at current scale.
- Rewrite: `vercel.json` `{ "source": "/llms-full.txt", "destination": "/api/llms-full" }`.

### 8.3 AI-bot allowance (final robots.txt additions on top of §6.5)

Append one more block after the §6.5 set:

```txt
User-agent: Amazonbot
Allow: /
User-agent: meta-externalagent
Allow: /
User-agent: cohere-ai
Allow: /
User-agent: CCBot
Allow: /
```

Also add the comment `# AI/LLM crawlers are welcome: /llms.txt and /llms-full.txt describe the platform.` and an `AISitemap:` hint line (`AISitemap: https://basmagi-quiz.vercel.app/sitemap.xml`) — a comment convention some AI crawlers honor; harmless either way.

### 8.4 Structured data (JSON-LD) on dynamic pages

**`api/render-quiz.js` — inject before `</head>` alongside the existing meta tags:**

```json
{
  "@context": "https://schema.org",
  "@type": ["LearningResource", "Quiz"],
  "name": "<quiz title>",
  "description": "<quiz description>",
  "url": "https://basmagi-quiz.vercel.app/quiz/<id>",
  "inLanguage": "ar",
  "learningResourceType": "Exam / Practice Test",
  "educationalUse": "Assessment",
  "isAccessibleForFree": true,
  "dateCreated": "<created_at>",
  "dateModified": "<synced_at|created_at>",
  "author": { "@type": "Organization", "name": "منصة امتحانات بصمجي",
              "url": "https://basmagi-quiz.vercel.app" },
  "provider": { "@type": "Organization", "name": "منصة امتحانات بصمجي",
                "sameAs": ["https://github.com/BelalAmrMohamed/Basmagi-Quiz"] }
}
```
Plus a `BreadcrumbList` scoped to the quiz's course/folder chain when `course_id`/`folder_id` resolve (positions: home → course → [folder…] → quiz).

**`api/render-course.js` — inject:**

1. `CollectionPage` with `name` = course/folder name, `description`, `url`, `inLanguage`, `isPartOf`.
2. `ItemList` (positions 1..n) listing **actual immediate children** — upgrade the count queries to also fetch child folder names + quiz `data->meta->>id` / titles (one extra query pair; reuse for the SSR island in 8.5), each item linking `/course/...` or `/quiz/...`.
3. Same-page `BreadcrumbList`.

**`api/render-profile.js` — inject:** `ProfilePage` with `about` = `Person` (name from `display_name`, `url` = `/@handle`, `image` = thumbnail).

Citation-style SEO: every injected `description` should be one precise Arabic sentence mentioning the material/course and question count (already largely done by `buildTitle`; extend to og:description using `data.meta.description` or a generated fallback like `"امتحان {title} — {n} سؤال في {course}"`).

### 8.5 Server-rendered visible content islands ("spider islands")

Robots that fetch raw HTML without executing JS (many AI crawlers; classic bots pre-render era) must still see real content and real `<a>` links.

- **`/course/:...` (highest value — already server-routed):** inside the injected `</head>` you cannot put body content, so instead: render a **JS-disabled-friendly block** by injecting a `<div id="seo-catalog">` right after `<body>`…`</body>` in the shell HTML. In `render-course.js`, before returning the HTML, insert:

```html
<noscript><div class="seo-catalog" style="position:absolute;left:-9999px" aria-hidden="true">
  <h2>محتوى {course}</h2>
  <ul>
    <li><a href="/course/{courseSlug}/{folderSlug}">{folderName} ({n} امتحان)</a></li>
    <li><a href="/quiz/{meta.id}">{quiz title}</a></li>
  </ul>
</div></noscript>
```

  Adding the block to the DOM: insert into a dedicated empty container the SPA renders into (check `container` element in `root-view.js`); but for JS crawlers the SPA replaces content anyway, and for HTML-only crawlers the `<noscript>` text is what gets indexed. Keep it visually hidden (offscreen) on purpose so the app UI is untouched.
- **Quiz pages:** inject a `<noscript>` block after `<body>` in `quiz.html`'s template processing (render-quiz.js already string-replaces the template — add one more replacement) containing: quiz title, question count/types, course link, og image `<img src ...>` (alt text), and a "الأجوبة تظهر بعد الحل" note. Crawlers/LLMs then get ground-truth facts from the page itself, not just meta.
- **Home page:** the root `/` is a static file; we can't query Supabase at static-serve time. Mitigation (chosen): Google renders JS for `/`, and **every leaf entity is directly reachable** through `/sitemap-dynamic.xml`, `/llms-full.txt`, and `/course/*` islands. Optional stretch: a `api/render-home.js` UA-based prerender (see Phase 6) if analytics later show JS-render problems.

### 8.6 GEO-ready copy guidelines (content policy for admins)

- Quiz `title`: `<Subject> — <Year/Term> [<variant>]` (Arabic first, quantity and question type visible in title or description).
- Always fill `description`: 1–3 Arabic sentences, mention course name, number of questions, and what the student practices (e.g. "مراجعة شاملة لقواعد اللغة الإنجليزية — 30 سؤال اختياري مع شرح").
- Course `name`/folder names: stable, exact known spellings (no abbreviations) — slugs depend on them.
- Prefer Arabic-first text everywhere visible (helpful for Arabic LLM responses).
- Add these guidelines to `docs/issues.md` or a `docs/content-seo.md` note so editors follow them.

**Acceptance (Phase 3):** `llms.txt` + `/llms-full.txt` resolve 200 and enumerate all public content; robot tests (`seo:check`) assert AI-bot user agents are allowed and no noindex URL appears in feeds/llms/sitemap; Schema.org validator passes for a sample quiz and course URL.

---

## Phase 4 — Crawl, render & internal-linking polish

### 4.1 Canonical & URL hygiene

- Move `public/sitemap.xml`, `public/sitemap-static.xml`, `public/llms.txt` (and keep `feed.xml`/`feed.json` dynamic) — all URLs inside every document use the **clean** form (no `.html`), matching `cleanUrls` canonicalization.
- `index.html` BreadcrumbList and all footer links: clean URLs; verify against `vercel.json`'s negation list (it already whitelists clean names).
- `og:url`/`twitter` on every static page: ensure they use `https://basmagi-quiz.vercel.app/{clean}` (audit existing files: `quiz.html` defaults already get replaced by the renderer; check `profile.html`, `result.html`, `create-quiz.html` — replace any `.html` value).
- Add `rel="canonical"` meta to static pages currently missing one (`/about`, how-to pages, privacy/terms, create-quiz): keep self-referencing clean URLs.

### 4.2 Query-string & content negotiation

- Renderer routes ignore unknown query params (they fall through to the SPA). That is correct — do **not** rush to block them; but ensure `canonical` never includes tracking params (it already doesn't).
- `?v=` on OG image URLs is versioning, not duplicate content — fine as-is (cache-busted by design).

### 4.3 Internal linking improvements

- **Quiz → course:** render-quiz.js should also emit a `spoken` breadcrumb line in the SSR island (§8.5) linking to the quiz's course/folder URL. If `course_id`/`folder_id` resolve, build the chain via the same queries as the sitemap.
- **Course → children:** §8.5 island links children; additionally ensure the SPA's rendered category view links use absolute clean URLs (already does: `category-view.js` builds `/course/...`).
- **Static ↔ dynamic:** from `/about` and the how-to pages, add one or two contextual links to `/course/...` (e.g., the first course page) — static pages currently link only to other static pages; a little juice toward dynamic authority pages helps crawl priority. (Pick in implementation; keep natural.)
- **Footer sitemap links:** add `<link rel="sitemap" type="application/xml" href="/sitemap.xml">`? Not a standard-required tag — instead rely on robots.txt. Skip.

### 4.4 Performance & robots extras

- `max-image-preview:large` / `max-video-preview:-1` — already present on index/quiz/onboarding; ensure the same robots line on `about.html`, how-to pages, and dynamic renderers (render-quiz.js injects onto a template that has it; syllabus check in `seo:check`).
- `lang="ar" dir="rtl"` — present on index; confirm the same on every template (`quiz.html`, `profile.html`, `result.html`, `settings.html`, `create-quiz.html`, how-to pages, about, privacy, terms) — missing `lang` on any page is an easy SEO-a11y win.

**Acceptance (Phase 4):** `seo:check` asserts canonical is self clean, `lang="ar" dir="rtl"` on all templates, no `.html` links in any sitemap/feed/JSON-LD, robots directives match Phase 0.

---

## Phase 5 — Measurement & operations

### 5.1 Search Console & Bing setup runbook (document once here, actions manual)

1. **Google Search Console** — verification files already deployed (`google0c1df2c3df22a824.html`, `google67d62c2618576950.html`, 53 bytes each, standard). Add property `https://basmagi-quiz.vercel.app/` → set site owner/admins for the dev account → Submit `sitemap.xml`.
2. **Bing Webmaster Tools** — add site, verify via the "meta tag" method (inject `<meta name="msvalidate.01" content="…">` into `index.html` `<head>`) or XML-file method (`BingSiteAuth.xml` in `public/`) → submit `sitemap.xml` → note IndexNow auto-detection (Bing auto-discovers our IndexNow pings by reading the key file).
3. **Yandex Webmaster (optional)** — IndexNow covers it too once verified; no extra work beyond verifying the property.

### 5.2 `npm run seo:check` — `scripts/seo-check.mjs`

A zero-dependency Node script (production URL via `BASE_URL` env, default `https://basmagi-quiz.vercel.app`). Checks:
1. `robots.txt` → `Sitemap:` line present; each AI-bot user-agent listed with `Allow: /`.
2. `/sitemap.xml` well-formed `sitemapindex`; both children 200; dynamic child parses as XML via a tiny regex-based element walker (no deps) — or `fetch` + `DOMParser`-equivalent split on `<url>`.
3. No `<loc>` contains `/control`, `/settings`, `/profile$`, `/result`, `/onboarding`, `/oauth-callback`, `/offline`, or any `.html`.
4. Every listed static page (`/about`, `/how-to-*`, `/create-quiz`, `/privacy-policy`, `/terms-of-service`) returns 200 and has `<meta name="description"` + canonical.
5. Noindex assertions: `/control`, `/settings`, `/reports`, `/result`, `/profile`, `/onboarding`, `/offline` contain `noindex`.
6. `/llms.txt`, `/llms-full.txt`, `/feed.xml`, `/feed.json` → 200.
7. JSON-LD present on a sample `/quiz/<id>` and `/course/<name>` (grab one id from the dynamic sitemap).
8. Exit code non-zero on any failure → hooks into `npm test`/pre-commit.

Add scripts entry: `"seo:check": "node scripts/seo-check.mjs"`.

### 5.3 Ongoing hygiene

- Search Console → Coverage: treat any new "Excluded/Noindex" row for a *public* dynamic URL as a bug (bit-rot in renderers).
- 404 report → top new 404s inspected monthly; add redirects or tombstones.
- Feed/llms-full staleness: cron logs wrap up (Phase 2) already re-warm; if any endpoint errors, `seo:check` catches it.

**Acceptance (Phase 5):** `npm run seo:check` passes against production; Search Console + Bing properties show the sitemap as "success"; a monthly 404-review note is in `docs/issues.md`.

---

## Phase 6 — Stretch / optional (only after Phases 0–5 ship green)

1. **Google Indexing automation via service account** — wire cron-seo step 4 (§7.5) + document in `docs/search-console-service-account.md`. Needs a GCP project + service account added as a Search Console owner. Highest-leverage Google automation available on the free tier.
2. **UA-based home prerender** — `api/render-home.js` that, when the request `User-Agent` matches a bot set, serves `index.html` with a data-island of top courses/quizzes (from `api/_catalog.js`); humans keep the static file. Requires carefully reordering `vercel.json` — **only attempt if `seo:check`/analytics prove JS-render gaps**.
3. **Custom domain** (e.g. `basmagi.com`) — brand authority, cleaner URLs, and required later for true Search Console/IndexNow trust. Verify domain property, update `SITE_ORIGIN` env + every hardcoded origin reference (robots, sitemap, feeds, llms, og.js, render-*).
4. **hreflang (future English version)** — `alternate` links per page once a second locale exists.
5. **Schema.org Dataset / ItemList for the college catalog** (`/api/colleges`) so the education inventory itself is a structured resource.
6. **CI gate** — run `npm run seo:check` on a preview deployment URL in the deploy pipeline before merge.
7. **OpenSearch description** (`/opensearch.xml` + `<link rel="search" type="application/opensearchdescription+xml">`) so browsers/AI agents can find the site search.

---

## Risks, tradeoffs & mitigations

| Risk | Mitigation |
|---|---|
| SEO notifications slow uploads | Fire-and-forget + 5s `Promise.race` + daily cron safety net; upload path never awaits IndexNow. |
| Sitemap/feed/llms edge-cache staleness (≤1h) | SWR pattern + cron re-warm (`?nocache=`) + correct `lastmod`. 1h is well within "Google notices soon" budgets. |
| Serverless function/plan limits (Vercel Hobby) | New *route* functions kept to 4 (`sitemap-dynamic`, `feeds`, `llms-full`, `cron-seo`); everything else in `_`-prefixed shared modules; cron count ≤1. Consider Pro if cron limits bite. |
| Supabase anon-key exposure for catalog reads | All data is already public via RLS; only public/aggregate fields used (never full `data` payloads, passwords, emails). |
| IndexNow key file abuse | Key is public by protocol design; pings can only *announce* URLs, never modify anything. Keep the key in env (not source); `public/<key>.txt` is intentionally static. |
| Abusive AI crawler traffic | Config-only robots.txt adjustment to disallow that specific `User-agent`; no code change needed. |
| Slugs colliding → wrong sitemap URLs | Emit `?education_type=` for ambiguous courses; `seo:check` cross-checks a random URL sample against client builders. |
| RSS/JSON feed bloat | Cap 50 entries; absolute URLs; `guid` permaLink = canonical URL. |
| 410 tombstone rewrite complexity | Fallback documented: plain 404 + sitemap regeneration is SEO-equivalent. |
| Home page JS-rendered gap for HTML-only bots | Every leaf reachable via sitemap/course islands; Phase 6 option 2 exists if analytics say otherwise. |
| Hardcoded `SITE_ORIGIN` in many files | Centralize via `api/_urls.js`, reading `SITE_ORIGIN` env once (pattern already used in og.js). |

---

## Definition of Done (whole-plan acceptance)

1. A new public quiz appears in `/sitemap-dynamic.xml`, `/feed.xml`, and `/llms-full.txt` within ≤1h of upload.
2. The upload endpoint emits an IndexNow ping to `api.indexnow.org` for that exact URL within seconds (log-verified); the daily cron would catch anything missed.
3. `npm run seo:check` passes against production: no indexable page missing description/canonical, no noindex URL in sitemap/feeds/llms, robots allows AI bots, sitemap/feed/llms all 200.
4. `/control`, `/settings`, `/result`, `/profile`, `/onboarding`, `/offline`, `/reports`, `/oauth-callback` are all `noindex` and absent from every SEO artifact.
5. Removed-page hygiene complete: `sign-in.html` references gone, legacy redirects added, BreadcrumbList fixed.
6. Structured data validates (schema.org) on a sample quiz, course, and profile page.
7. This plan is the source of truth: each file change references its phase; the `docs/issues.md` SEO task line is replaced by a pointer to this file.

---

## Appendix A — Files to change/create (map)

**Static / config**
- `public/sitemap.xml` → becomes a sitemap *index* (rewrite content).
- `public/sitemap-static.xml` → new (static URL list).
- `public/llms.txt` → new.
- `public/robots.txt` → rewrite.
- `public/{INDEXNOW_KEY}.txt` → new key file (generated; deployed but kept out of source conventions).
- `public/index.html` → JSON-LD + feed `<link>`s + BreadcrumbList/canonical fixes.
- `public/quiz.html` + `about.html`, `create-quiz.html`, `how-to-*.html`, `privacy-policy.html`, `terms-of-service.html` → meta/robots/lang tweaks.
- `public/settings.html`, `result.html`, `profile.html`, `offline.html`, `onboarding.html` → add noindex.
- `vercel.json` → rewrites (`/sitemap-dynamic.xml`, `/feed.xml`, `/feed.json`, `/llms-full.txt`), legacy redirects (`/sign-in*`, `/login*`), `crons`.
- `package.json` → `seo:check` script.
- `docs/issues.md` → scrub sign-in.html line; add monthly 404-review note.

**New API files** (`_`-prefixed helpers are non-route)
- `api/_urls.js` — slug + absolute-URL builders (single source of truth).
- `api/_catalog.js` — public catalog query set shared by sitemap/feeds/llms/cron/renderers.
- `api/_seoNotify.js` — IndexNow + cache warm.
- `api/sitemap-dynamic.js` (route) · `api/feeds.js` (route) · `api/llms-full.js` (route) · `api/cron-seo.js` (route)
- `api/tombstone.js` (route, optional, §7.4)
- `scripts/seo-check.mjs` (Phase 5)

**Modified API files**
- `api/render-quiz.js` — JSON-LD (Quiz + breadcrumb) + noscript island + feed `<link>`.
- `api/render-course.js` — JSON-LD (CollectionPage + ItemList) + real-child SSR island.
- `api/render-profile.js` — JSON-LD (ProfilePage/Person).
- `api/_courseFolders.js` — notify after course/folder create.
- `api/upload-quiz.js`, `api/upload-folder.js` — notify after inserts.
- `api/admin.js` — notify on rename/move/delete/restore.
- `api/college-quiz.js` — notify removal on delete.

**Data (optional)**
- `supabase/migrations/<ts>_seo_tombstones.sql` — tombstone table for 410s if chosen.

---

## Appendix B — References

- llms.txt spec: https://llmstxt.org
- IndexNow protocol: https://www.indexnow.org (Bing/Naver/Seznam/Yandex — Google does not participate)
- Google Sitemaps API: https://developers.google.com/webmaster-tools/sitemaps-api
- Google URL Inspection guidelines: https://support.google.com/webmasters/answer/9012289
- Google sitemaps overview/lastmod: https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- Bing Webmaster Tools: https://www.bing.com/webmasters
- vercel.json (rewrites/crons): https://vercel.com/docs/projects/project-configuration
- URL builders in this repo to mirror: `public/src/features/home/slug-utils.js` (toSlug), `exam-card.js` (buildExamShareUrl), `category-view.js`, `navigation.js`