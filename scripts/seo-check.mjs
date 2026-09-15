#!/usr/bin/env node
// =============================================================================
// scripts/seo-check.mjs
// Phase 5.2 of docs/plans/SEO-GEO-plan.md — zero-dependency regression check
// for the SEO/GEO implementation. Run against a live deployment:
//
//   npm run seo:check                                   # checks production
//   BASE_URL=https://my-preview.vercel.app npm run seo:check
//
// Exit code is non-zero on any failure, so this can be wired into CI /
// pre-commit / pre-deploy (plan Phase 6 §6 stretch item) without changes.
// No dependencies beyond Node's built-in fetch (Node 18+).
// =============================================================================

const BASE_URL = (process.env.BASE_URL || "https://basmagi-quiz.vercel.app").replace(/\/+$/, "");

const AI_BOTS = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-User",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "Bytespider",
];

const NOINDEX_PAGES = [
    "/control",
    "/settings",
    "/reports",
    "/result",
    "/profile",
    "/onboarding",
    "/offline",
    "/oauth-callback",
];

const STATIC_INDEXABLE_PAGES = [
    "/about",
    "/create-quiz",
    "/how-to-create-a-quiz",
    "/how-to-upload-a-quiz",
    "/how-to-use-ai-agent",
    "/privacy-policy",
    "/terms-of-service",
];

const FORBIDDEN_LOC_PATTERNS = [
    "/control",
    "/settings",
    "/profile\"",       // exact-ish guard against the private shell, not /@handle
    "/result",
    "/onboarding",
    "/oauth-callback",
    "/offline",
    ".html",
];

let passCount = 0;
let failCount = 0;
const failures = [];

function pass(label) {
    passCount++;
    console.log(`  \u2713 ${label}`);
}

function fail(label, detail) {
    failCount++;
    const line = detail ? `${label} — ${detail}` : label;
    failures.push(line);
    console.log(`  \u2717 ${line}`);
}

async function get(path) {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    try {
        const res = await fetch(url, { redirect: "manual" });
        const text = await res.text().catch(() => "");
        return { ok: res.ok, status: res.status, headers: res.headers, text, url };
    } catch (err) {
        return { ok: false, status: 0, headers: new Headers(), text: "", url, error: err.message };
    }
}

function hasMetaRobots(html, expectedSubstrings) {
    const match = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (!match) return false;
    const content = match[1].toLowerCase();
    return expectedSubstrings.every((s) => content.includes(s));
}

function hasCanonical(html) {
    return /<link\s+rel=["']canonical["']\s+href=["'][^"']+["']/i.test(html);
}

function hasDescription(html) {
    return /<meta\s+name=["']description["']\s+content=["'][^"']+["']/i.test(html);
}

function hasLangRtl(html) {
    return /<html[^>]*\blang=["']ar["'][^>]*\bdir=["']rtl["']/i.test(html)
        || /<html[^>]*\bdir=["']rtl["'][^>]*\blang=["']ar["']/i.test(html);
}

function extractLocs(xml) {
    const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    return matches.map((m) => m[1]);
}

// ── 1. robots.txt ────────────────────────────────────────────────────────────

async function checkRobotsTxt() {
    console.log("\n[1] robots.txt");
    const { ok, text, status } = await get("/robots.txt");
    if (!ok) return fail("robots.txt reachable", `HTTP ${status}`);
    pass("robots.txt reachable");

    if (/^Sitemap:\s*\S+/im.test(text)) {
        pass("robots.txt has a Sitemap: line");
    } else {
        fail("robots.txt has a Sitemap: line", "not found");
    }

    if (/Disallow:\s*\/\s*$/im.test(text) && !/User-agent:\s*\*/i.test(text)) {
        fail("robots.txt does not blanket-disallow crawling");
    } else {
        pass("robots.txt does not blanket-disallow crawling");
    }

    // AI-bot allow-listing (plan §6.5 / §8) is a stretch beyond the base
    // `Allow: /` wildcard already covering every UA. Only fail if an AI bot
    // is *explicitly* disallowed somewhere — don't require redundant
    // per-bot blocks when the wildcard already allows everything.
    let explicitlyBlocked = [];
    for (const bot of AI_BOTS) {
        const uaBlock = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?(?=User-agent:|$)`, "i");
        const m = text.match(uaBlock);
        if (m && /Disallow:\s*\/\s*$/im.test(m[0])) explicitlyBlocked.push(bot);
    }
    if (explicitlyBlocked.length) {
        fail("no AI/LLM crawler explicitly disallowed", explicitlyBlocked.join(", "));
    } else {
        pass("no AI/LLM crawler explicitly disallowed");
    }
}

// ── 2. Sitemap index + children ──────────────────────────────────────────────

let dynamicSitemapLocs = [];

async function checkSitemaps() {
    console.log("\n[2] Sitemap index & children");
    const idx = await get("/sitemap.xml");
    if (!idx.ok) return fail("/sitemap.xml reachable", `HTTP ${idx.status}`);
    pass("/sitemap.xml reachable");

    if (/<sitemapindex[\s>]/i.test(idx.text)) {
        pass("/sitemap.xml is a <sitemapindex>");
    } else {
        fail("/sitemap.xml is a <sitemapindex>", "root element not found");
    }

    const children = extractLocs(idx.text);
    if (!children.length) fail("sitemap index lists child sitemaps", "none found");

    for (const childUrl of children) {
        const path = childUrl.replace(BASE_URL, "");
        const res = await get(path);
        if (res.ok) {
            pass(`child sitemap reachable: ${path}`);
        } else {
            fail(`child sitemap reachable: ${path}`, `HTTP ${res.status}`);
        }
        if (path.includes("sitemap-dynamic")) {
            dynamicSitemapLocs = extractLocs(res.text);
        }
    }

    if (dynamicSitemapLocs.length > 0) {
        pass(`sitemap-dynamic.xml lists ${dynamicSitemapLocs.length} URL(s)`);
    } else {
        fail("sitemap-dynamic.xml lists at least one URL", "0 URLs found — expected \u22651 quiz/course/folder");
    }

    const staticRes = await get("/sitemap-static.xml");
    const staticLocs = staticRes.ok ? extractLocs(staticRes.text) : [];
    const allLocs = [...staticLocs, ...dynamicSitemapLocs];

    const offenders = allLocs.filter((loc) =>
        FORBIDDEN_LOC_PATTERNS.some((pat) => loc.includes(pat.replace('"', "")))
    );
    if (offenders.length) {
        fail("no forbidden URL in any sitemap", offenders.slice(0, 5).join(", "));
    } else {
        pass("no forbidden URL (/control, .html, noindex pages) in any sitemap");
    }
}

// ── 3. Feeds ──────────────────────────────────────────────────────────────────

async function checkFeeds() {
    console.log("\n[3] Feeds (RSS + JSON)");
    const rss = await get("/feed.xml");
    if (rss.ok && /<rss[\s>]/i.test(rss.text)) {
        pass("/feed.xml returns valid-looking RSS");
    } else {
        fail("/feed.xml returns valid-looking RSS", rss.ok ? "no <rss> root" : `HTTP ${rss.status}`);
    }

    const json = await get("/feed.json");
    if (json.ok) {
        try {
            const parsed = JSON.parse(json.text);
            if (parsed.items && Array.isArray(parsed.items)) {
                pass("/feed.json parses with an items[] array");
            } else {
                fail("/feed.json parses with an items[] array", "items missing/not array");
            }
        } catch {
            fail("/feed.json parses as JSON", "JSON.parse threw");
        }
    } else {
        fail("/feed.json reachable", `HTTP ${json.status}`);
    }
}

// ── 4. GEO discovery documents ───────────────────────────────────────────────

async function checkGeoDocs() {
    console.log("\n[4] GEO discovery documents (llms.txt / llms-full.txt)");
    const llms = await get("/llms.txt");
    if (llms.ok) pass("/llms.txt reachable");
    else fail("/llms.txt reachable", `HTTP ${llms.status}`);

    const llmsFull = await get("/llms-full.txt");
    if (llmsFull.ok) {
        pass("/llms-full.txt reachable");
        if (llmsFull.text.length > 100) {
            pass("/llms-full.txt has substantive content");
        } else {
            fail("/llms-full.txt has substantive content", `only ${llmsFull.text.length} bytes`);
        }
    } else {
        fail("/llms-full.txt reachable", `HTTP ${llmsFull.status}`);
    }
}

// ── 5. Static page indexability ──────────────────────────────────────────────

async function checkStaticIndexablePages() {
    console.log("\n[5] Static indexable pages (description, canonical, lang/dir, HTTP 200)");
    for (const path of STATIC_INDEXABLE_PAGES) {
        const res = await get(path);
        if (!res.ok) {
            fail(`${path} returns 200`, `HTTP ${res.status}`);
            continue;
        }
        pass(`${path} returns 200`);

        if (hasDescription(res.text)) pass(`${path} has <meta name="description">`);
        else fail(`${path} has <meta name="description">`);

        if (hasCanonical(res.text)) pass(`${path} has <link rel="canonical">`);
        else fail(`${path} has <link rel="canonical">`);

        if (hasLangRtl(res.text)) pass(`${path} has lang="ar" dir="rtl"`);
        else fail(`${path} has lang="ar" dir="rtl"`);
    }
}

// ── 6. noindex pages ─────────────────────────────────────────────────────────

async function checkNoindexPages() {
    console.log("\n[6] noindex pages carry noindex robots meta");
    for (const path of NOINDEX_PAGES) {
        const res = await get(path);
        if (!res.ok) {
            // Some of these (oauth-callback, control) may legitimately 404/redirect
            // outside a real auth/admin flow; only fail on a hard 5xx.
            if (res.status >= 500) fail(`${path} does not 5xx`, `HTTP ${res.status}`);
            else pass(`${path} reachable (HTTP ${res.status}, not a server error)`);
            continue;
        }
        if (hasMetaRobots(res.text, ["noindex"])) {
            pass(`${path} has noindex robots meta`);
        } else {
            fail(`${path} has noindex robots meta`, "missing or not noindex");
        }
    }
}

// ── 7. JSON-LD on a sample dynamic page ──────────────────────────────────────

async function checkStructuredData() {
    console.log("\n[7] Structured data (JSON-LD) on sample dynamic pages");

    const quizLoc = dynamicSitemapLocs.find((l) => l.includes("/quiz/"));
    if (quizLoc) {
        const res = await get(quizLoc.replace(BASE_URL, ""));
        const ldBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        if (ldBlocks.length > 0) {
            pass(`sample quiz page has ${ldBlocks.length} JSON-LD block(s)`);
            const allValid = ldBlocks.every((b) => {
                try { JSON.parse(b[1]); return true; } catch { return false; }
            });
            if (allValid) pass("sample quiz JSON-LD blocks all parse");
            else fail("sample quiz JSON-LD blocks all parse", "JSON.parse threw on at least one");
        } else {
            fail("sample quiz page has JSON-LD", "no <script type=\"application/ld+json\"> found");
        }
    } else {
        fail("sample quiz page has JSON-LD", "no /quiz/ URL found in dynamic sitemap to sample");
    }

    const courseLoc = dynamicSitemapLocs.find((l) => l.includes("/course/"));
    if (courseLoc) {
        const res = await get(courseLoc.replace(BASE_URL, ""));
        const ldBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        if (ldBlocks.length > 0) pass(`sample course page has ${ldBlocks.length} JSON-LD block(s)`);
        else fail("sample course page has JSON-LD", "no <script type=\"application/ld+json\"> found");
    } else {
        fail("sample course page has JSON-LD", "no /course/ URL found in dynamic sitemap to sample");
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`SEO/GEO check against ${BASE_URL}\n(docs/plans/SEO-GEO-plan.md §5.2)`);

    await checkRobotsTxt();
    await checkSitemaps();
    await checkFeeds();
    await checkGeoDocs();
    await checkStaticIndexablePages();
    await checkNoindexPages();
    await checkStructuredData();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`${passCount} passed, ${failCount} failed`);
    if (failCount > 0) {
        console.log("\nFailures:");
        for (const f of failures) console.log(`  - ${f}`);
        process.exitCode = 1;
    } else {
        console.log("All SEO/GEO checks passed.");
    }
}

main().catch((err) => {
    console.error("seo-check crashed:", err);
    process.exitCode = 1;
});
