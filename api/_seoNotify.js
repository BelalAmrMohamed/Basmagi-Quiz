// =============================================================================
// api/_seoNotify.js
// Fire-and-forget "publish" signal, called AFTER a successful DB write from
// every content-mutation endpoint (plan §7.1/§7.2). Never throws, never
// blocks the response it's called from, never awaited to completion by the
// caller — call it and move on:
//
//   notifySearchEngines({ add: [quizUrl(id)] }); // no `await` at call sites
//
// Design principle (plan §3): never block, slow, or fail an upload because
// of SEO notifications.
//
// Underscore prefix -> not a route.
// =============================================================================

import { SITE_ORIGIN, absUrl } from "./_urls.js";

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || null;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_PING = 1000; // IndexNow protocol limit
const FETCH_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
    ]);
}

async function pingIndexNow(urls) {
    if (!INDEXNOW_KEY) {
        // Not configured yet — this is a soft no-op, not an error. The daily
        // cron + sitemap freshness still carry Google/Bing discovery even
        // without IndexNow configured.
        return { skipped: true, reason: "INDEXNOW_KEY not set" };
    }
    if (urls.length === 0) return { skipped: true, reason: "no urls" };

    const batch = urls.slice(0, MAX_URLS_PER_PING);
    const body = JSON.stringify({
        host: new URL(SITE_ORIGIN).host,
        key: INDEXNOW_KEY,
        keyLocation: absUrl(`/${INDEXNOW_KEY}.txt`),
        urlList: batch,
    });

    try {
        const result = await withTimeout(
            fetch(INDEXNOW_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body,
            }),
            FETCH_TIMEOUT_MS,
        );

        if (result?.timedOut) {
            return { ok: false, reason: "timeout" };
        }
        // IndexNow returns 200/202 on success; 4xx on malformed key/host.
        return { ok: result.ok, status: result.status };
    } catch (err) {
        return { ok: false, reason: err?.message || "fetch failed" };
    }
}

async function warmCache() {
    // Busts the edge cache for the two most-fetched discovery documents so
    // the next real crawler request gets fresh data sooner than the 1h SWR
    // window would otherwise allow. Best-effort — a failure here is not
    // logged as an error since it only affects freshness, not correctness.
    const targets = [absUrl("/sitemap-dynamic.xml"), absUrl("/feed.xml")];
    await Promise.allSettled(
        targets.map((url) =>
            withTimeout(fetch(`${url}?nocache=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }), FETCH_TIMEOUT_MS),
        ),
    );
}

/**
 * Called AFTER a successful DB write. Never throws.
 *
 * @param {Object} opts
 * @param {string[]} [opts.add] - URLs created or updated (announced via IndexNow).
 * @param {string[]} [opts.remove] - URLs that should disappear. Not submitted
 *   to IndexNow (the protocol has no delete verb) — their removal is
 *   reflected by the sitemap/feed simply no longer listing them once
 *   regenerated. Kept as a parameter so call sites have one obvious place
 *   to report deletions, even though today it only affects the log line.
 * @param {string} [opts.reason]
 */
export async function notifySearchEngines({ add = [], remove = [], reason = "publish" } = {}) {
    try {
        const uniqueAdd = [...new Set(add.filter(Boolean))];

        const [indexNowResult] = await Promise.allSettled([
            pingIndexNow(uniqueAdd),
            warmCache(),
        ]);

        const indexNowSummary =
            indexNowResult.status === "fulfilled" ? indexNowResult.value : { ok: false, reason: "rejected" };

        console.log("[seoNotify]", reason, "add:", uniqueAdd.length, "remove:", remove.length, indexNowSummary);
    } catch (err) {
        // Never let a notification failure surface to the caller.
        console.error("[seoNotify] unexpected error (ignored):", err?.message || err);
    }
}