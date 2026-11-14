# Web bundling (public/dist)

`node scripts/build-web.mjs` (Vercel `buildCommand`) bundles every page's JS and CSS into `public/dist/`:

| Output | Used by | Caching |
|---|---|---|
| `dist/home.js`, `dist/home.css` | `index.html` | `no-cache` (cheap 304), they reference hashed chunks |
| `dist/pages/<page>.js`, `.css` | every other bundled page | same |
| `dist/chunks/*-<hash>.js`, `dist/assets/*` | shared / lazy code, fonts | 1 year, immutable |

`scripts/page-bundles.json` lists, per page, the modules (and CSS) that used to be linked from the
HTML, in the original order. The inline `<script type="module">` blocks of those pages now live in
`public/src/pages/*.js` (they must be inside the bundle so module state such as `side-menu` is shared).

Left as plain files on purpose: `embed-mode.js` (must run synchronously before render),
`analytics-beacon.js` (classic deferred script), `oauth-callback.html`, `offline.html`.

**Adding or changing a page:** edit its entry in `page-bundles.json`, make the HTML reference
`/dist/pages/<page>.js` and `/dist/pages/<page>.css` (absolute paths: SSR renders pages at other URLs).
Local dev: `npm run build:web` (or `npm run dev:web` to watch) before opening a page.
