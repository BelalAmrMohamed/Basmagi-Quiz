// =============================================================================
// api/seo.js
// Consolidated SEO/GEO discovery endpoint. Four unrelated read-only surfaces
// merged into ONE Vercel Function to stay under Hobby's 12-function cap —
// see docs/plans/SEO-GEO-plan.md, "Risks" row on serverless function limits.
// The plan's Appendix A originally specified four separate route files
// (sitemap-dynamic.js, feeds.js, llms-full.js, cron-seo.js); all four are
// implemented here instead, dispatched by ?type=, exactly like
// api/college-quiz.js already merges unrelated handlers by HTTP method.
//
// Routed via vercel.json rewrites so public paths are exactly what the plan
// specifies (clients never see ?type=):
//   GET /sitemap-dynamic.xml  -> /api/seo?type=sitemap
//   GET /feed.xml             -> /api/seo?type=feed&format=rss
//   GET /feed.json            -> /api/seo?type=feed&format=json
//   GET /llms-full.txt        -> /api/seo?type=llms-full
//   (cron) /api/seo?type=cron -> Vercel Cron only, see vercel.json "crons"
//
// All four share one Supabase query set (api/_catalog.js) so sitemap, feeds,
// llms-full, and the cron sweep can never drift out of sync with each other.
//
// Bounded pagination (Vercel Hobby cron/timeout constraints): the quizzes
// table — the one most likely to grow large as uploads accumulate — is
// fetched in bounded .range() pages inside loadPublicCatalog() (see
// api/_catalog.js's fetchAllQuizzes), not one unbounded SELECT. That keeps
// every action here, including the cron sweep below, comfortably inside
// Vercel Hobby's 10s serverless execution limit even as the library grows.
// courses/folders/profiles stay single unbounded queries since those track
// curriculum structure rather than upload volume and remain small.
// =============================================================================

import { loadPublicCatalog, filterRecentlyChanged } from "./_catalog.js";
import { escapeXml, absUrl } from "./_urls.js";
import { notifySearchEngines } from "./_seoNotify.js";

const SITE_ORIGIN = "https://basmagi-quiz.vercel.app";
const OG_IMAGE_VERSION = 3; // keep in sync with render-quiz.js / render-course.js

// Cache-Control shared by every read-only discovery document here (plan §6.3,
// user-adjustment #3): 1h fresh, 24h stale-while-revalidate. Vercel's Edge
// Network serves the cached copy to concurrent crawlers, shielding Supabase
// from simultaneous cold reads even under a crawler traffic spike.
const DISCOVERY_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

// ── Sitemap (dynamic part) ───────────────────────────────────────────────────

function buildSitemapXml(catalog) {
    const urlEntries = [];

    for (const c of catalog.courses) {
        urlEntries.push({ loc: c.url, lastmod: c.lastmod, changefreq: "weekly", priority: "0.8" });
    }
    for (const f of catalog.folders) {
        urlEntries.push({ loc: f.url, lastmod: f.lastmod, changefreq: "weekly", priority: "0.7" });
    }
    for (const q of catalog.quizzes) {
        urlEntries.push({ loc: q.url, lastmod: q.lastmod, changefreq: "monthly", priority: "0.9" });
    }
    for (const p of catalog.profiles) {
        urlEntries.push({ loc: p.url, lastmod: p.lastmod, changefreq: "monthly", priority: "0.5" });
    }

    const body = urlEntries
        .map((e) => {
            const lastmodTag = e.lastmod ? `<lastmod>${escapeXml(new Date(e.lastmod).toISOString())}</lastmod>` : "";
            return `  <url><loc>${escapeXml(e.loc)}</loc>${lastmodTag}<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function handleSitemap(req, res) {
    const catalog = await loadPublicCatalog();

    if (!catalog) {
        // Never 500 on a sitemap request (plan §6.3 guard) — degrade to an
        // empty urlset (the static sitemap-static.xml sibling in the index
        // still carries the static pages) and tell caches not to keep the
        // failure around.
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`);
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", DISCOVERY_CACHE_CONTROL);
    return res.status(200).send(buildSitemapXml(catalog));
}

// ── Feeds (RSS 2.0 + JSON Feed 1.1) ──────────────────────────────────────────

const FEED_ENTRY_LIMIT = 50;
const FEED_CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=3600";

function collectFeedEntries(catalog) {
    // Interleave quizzes + courses + folders by lastmod/createdAt, newest
    // first, capped at FEED_ENTRY_LIMIT (plan §6.4).
    const entries = [];

    for (const q of catalog.quizzes) {
        entries.push({
            kind: "quiz",
            title: q.title,
            description: q.description || (q.courseName ? `امتحان في مقرر ${q.courseName}` : "امتحان جديد"),
            url: q.url,
            date: q.lastmod || q.createdAt,
            category: q.courseName || null,
            ogImage: absUrl(`/api/og?type=quiz&id=${encodeURIComponent(q.metaId)}&v=${OG_IMAGE_VERSION}`),
        });
    }
    for (const c of catalog.courses) {
        entries.push({
            kind: "course",
            title: c.name,
            description: `مقرر ${c.name}`,
            url: c.url,
            date: c.lastmod,
            category: c.education_type || null,
            ogImage: null,
        });
    }
    for (const f of catalog.folders) {
        entries.push({
            kind: "folder",
            title: f.name,
            description: `مجلد ${f.name}`,
            url: f.url,
            date: f.lastmod,
            category: null,
            ogImage: null,
        });
    }

    entries.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    return entries.slice(0, FEED_ENTRY_LIMIT);
}

function buildRssXml(entries) {
    const items = entries
        .map((e) => {
            const pubDate = e.date ? new Date(e.date).toUTCString() : new Date().toUTCString();
            const enclosure = e.ogImage
                ? `<enclosure url="${escapeXml(e.ogImage)}" type="image/png" length="0"/>`
                : "";
            const category = e.category ? `<category>${escapeXml(e.category)}</category>` : "";
            return [
                "  <item>",
                `    <title>${escapeXml(e.title)}</title>`,
                `    <link>${escapeXml(e.url)}</link>`,
                `    <guid isPermaLink="true">${escapeXml(e.url)}</guid>`,
                `    <description>${escapeXml(e.description)}</description>`,
                `    <pubDate>${pubDate}</pubDate>`,
                category ? `    ${category}` : "",
                enclosure ? `    ${enclosure}` : "",
                "  </item>",
            ]
                .filter(Boolean)
                .join("\n");
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>أحدث امتحانات بصمجي</title>
  <link>${SITE_ORIGIN}</link>
  <description>آخر الامتحانات والمواد المضافة على منصة امتحانات بصمجي</description>
  <language>ar</language>
  <ttl>30</ttl>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

function buildJsonFeed(entries) {
    return JSON.stringify(
        {
            version: "https://jsonfeed.org/version/1.1",
            title: "أحدث امتحانات بصمجي",
            home_page_url: SITE_ORIGIN,
            feed_url: absUrl("/feed.json"),
            language: "ar",
            items: entries.map((e) => ({
                id: e.url,
                url: e.url,
                title: e.title,
                content_text: e.description,
                date_published: e.date ? new Date(e.date).toISOString() : undefined,
                tags: e.category ? [e.category] : undefined,
                image: e.ogImage || undefined,
            })),
        },
        null,
        2,
    );
}

async function handleFeed(req, res) {
    const format = req.query?.format === "json" ? "json" : "rss";
    const catalog = await loadPublicCatalog();

    if (!catalog) {
        res.setHeader("Cache-Control", "no-store");
        if (format === "json") {
            res.setHeader("Content-Type", "application/feed+json; charset=utf-8");
            return res.status(200).send(buildJsonFeed([]));
        }
        res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
        return res.status(200).send(buildRssXml([]));
    }

    const entries = collectFeedEntries(catalog);
    res.setHeader("Cache-Control", FEED_CACHE_CONTROL);

    if (format === "json") {
        res.setHeader("Content-Type", "application/feed+json; charset=utf-8");
        return res.status(200).send(buildJsonFeed(entries));
    }
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    return res.status(200).send(buildRssXml(entries));
}

// ── llms-full.txt (dynamic, exhaustive GEO catalog) ──────────────────────────

function formatQuestionTypesLabel(types) {
    if (!types) return null;
    if (Array.isArray(types)) return types.join(", ");
    return String(types);
}

function buildLlmsFullTxt(catalog) {
    const lines = ["# منصة امتحانات بصمجي — الفهرسة الكاملة", ""];

    // Group courses by education_type/college for readable sectioning.
    const byCollege = new Map();
    for (const course of catalog.courses) {
        const key = course.college || course.education_type || "عام";
        if (!byCollege.has(key)) byCollege.set(key, []);
        byCollege.get(key).push(course);
    }

    const foldersByCourse = new Map();
    for (const f of catalog.folders) {
        if (!f.parent_folder_id) {
            if (!foldersByCourse.has(f.course_id)) foldersByCourse.set(f.course_id, []);
            foldersByCourse.get(f.course_id).push(f);
        }
    }
    const quizzesByCourse = new Map();
    const quizzesByFolder = new Map();
    for (const q of catalog.quizzes) {
        if (q.folderId) {
            if (!quizzesByFolder.has(q.folderId)) quizzesByFolder.set(q.folderId, []);
            quizzesByFolder.get(q.folderId).push(q);
        } else if (q.courseId) {
            if (!quizzesByCourse.has(q.courseId)) quizzesByCourse.set(q.courseId, []);
            quizzesByCourse.get(q.courseId).push(q);
        }
    }

    function quizLine(q) {
        const typesLabel = formatQuestionTypesLabel(q.questionTypes);
        const countLabel = q.questionCount != null ? `${q.questionCount} سؤال` : null;
        const details = [countLabel, typesLabel].filter(Boolean).join(", ");
        const descPart = q.description ? `, ${q.description}` : "";
        return `  - [امتحان ${q.title}](${q.url})${details ? ` — ${details}` : ""}${descPart}`;
    }

    for (const [college, courses] of byCollege.entries()) {
        lines.push(`## ${college}`);
        for (const course of courses) {
            const parts = [course.education_type, course.year, course.term].filter(Boolean).join(", ");
            lines.push(`### مقرر ${course.name}${parts ? ` (${parts})` : ""}`);

            const directQuizzes = quizzesByCourse.get(course.id) || [];
            for (const q of directQuizzes) lines.push(quizLine(q));

            const childFolders = foldersByCourse.get(course.id) || [];
            for (const folder of childFolders) {
                const folderQuizzes = quizzesByFolder.get(folder.id) || [];
                lines.push(`- مجلد ${folder.name}: ${folderQuizzes.length} امتحان`);
                for (const q of folderQuizzes) lines.push(`  ${quizLine(q)}`);
            }
            lines.push("");
        }
    }

    for (const p of catalog.profiles) {
        lines.push(`- [${p.displayName}](${p.url})`);
    }

    return lines.join("\n") + "\n";
}

async function handleLlmsFull(req, res) {
    const catalog = await loadPublicCatalog();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (!catalog) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send("# منصة امتحانات بصمجي — الفهرسة الكاملة\n\n(تعذر تحميل البيانات مؤقتًا)\n");
    }

    res.setHeader("Cache-Control", DISCOVERY_CACHE_CONTROL);
    return res.status(200).send(buildLlmsFullTxt(catalog));
}

// ── Cron sweep ────────────────────────────────────────────────────────────────

async function handleCron(req, res) {
    // Vercel Cron requests carry the x-vercel-cron header, but that header
    // alone isn't a secret — a request forged with the same header name from
    // outside Vercel's infrastructure could still reach this far. Layer in
    // Vercel's own recommended CRON_SECRET check too: when the env var is
    // set, only Authorization: Bearer <CRON_SECRET> is accepted (Vercel
    // attaches this automatically to its own cron invocations once the env
    // var exists). If CRON_SECRET isn't configured yet, fall back to the
    // header-presence check alone so the cron still works out of the box.
    const isVercelCron = req.headers["x-vercel-cron"] !== undefined;
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers["authorization"];
    const secretOk = cronSecret ? authHeader === `Bearer ${cronSecret}` : true;

    if (!isVercelCron || !secretOk) {
        return res.status(403).json({ error: "Forbidden" });
    }

    const catalog = await loadPublicCatalog();
    if (!catalog) {
        console.error("[cron-seo] catalog load failed; skipping this run");
        return res.status(200).json({ ok: false, reason: "catalog load failed" });
    }

    const recent = filterRecentlyChanged(catalog, 24);
    const urls = [
        ...recent.courses.map((c) => c.url),
        ...recent.folders.map((f) => f.url),
        ...recent.quizzes.map((q) => q.url),
        ...recent.profiles.map((p) => p.url),
    ];

    await notifySearchEngines({ add: urls, reason: "cron" });

    console.log(
        "[cron-seo] swept",
        "courses:", recent.courses.length,
        "folders:", recent.folders.length,
        "quizzes:", recent.quizzes.length,
        "profiles:", recent.profiles.length,
    );

    return res.status(200).json({
        ok: true,
        announced: urls.length,
        breakdown: {
            courses: recent.courses.length,
            folders: recent.folders.length,
            quizzes: recent.quizzes.length,
            profiles: recent.profiles.length,
        },
    });
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const type = req.query?.type;

    if (type === "sitemap") return handleSitemap(req, res);
    if (type === "feed") return handleFeed(req, res);
    if (type === "llms-full") return handleLlmsFull(req, res);
    if (type === "cron") return handleCron(req, res);

    return res.status(400).json({ error: "Unknown or missing ?type=" });
}