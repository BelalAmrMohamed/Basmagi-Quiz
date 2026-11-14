// =============================================================================
// public/src/components/ai-agent/ai-agent-usage.js
// Client for GET /api/ai-agent/usage — the platform's shared API-key pool
// usage shown in the model menu's "View Usage" submenu. Small in-memory cache
// so hovering the submenu repeatedly doesn't hammer the endpoint.
// =============================================================================
import { apiUrl } from "../../shared/api-base.js";
const CACHE_MS = 30_000;
let cache = null; // { at, data }
let inflight = null;

/** @returns {Promise<{groups: Array<{id:string,label:string,percentLeft:number,window:string,resetsAt:string}>}>} */
export function fetchPlatformUsage({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.data);
  if (inflight) return inflight;
  inflight = fetch(apiUrl("/api/ai-agent/usage"), { headers: { Accept: "application/json" } })
    .then((r) => {
      if (!r.ok) throw new Error(`usage ${r.status}`);
      return r.json();
    })
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** "Weekly limit, resets in 6d 23h" (Arabic UI). */
export function formatReset(resetsAt, now = Date.now()) {
  const ms = Math.max(0, new Date(resetsAt).getTime() - now);
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const when = d > 0 ? `${d}ي ${h}س` : h > 0 ? `${h}س ${m}د` : `${m}د`;
  return `الحد الأسبوعي، يتجدد خلال ${when}`;
}
