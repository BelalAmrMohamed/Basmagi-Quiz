// Bundles worker + app + assets + lessons into ONE static dist/index.html, plus SEO files (robots, sitemap, manifest) and public/ icons.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadLessons } from './lessons.mjs';
const here = import.meta.dirname, dist = path.join(here, 'dist');

// Public URL: SITE_URL env, else Vercel's production URL, else the production domain.
const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const SITE = (process.env.SITE_URL || (vercel ? 'https://' + vercel : 'https://online-matlab-compiler.vercel.app')).replace(/\/$/, '');

const w = await build({ entryPoints: [path.join(here, 'src/worker.ts')], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const assets = JSON.parse(readFileSync(path.join(here, 'assets/assets.json'), 'utf8'));
const lessons = loadLessons(path.join(here, 'lessons'));
const m = await build({ entryPoints: [path.join(here, 'src/main.ts')], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true,
  define: { __WORKER_SRC__: JSON.stringify(w.outputFiles[0].text), __ASSETS__: JSON.stringify(assets), __LESSONS__: JSON.stringify(lessons) } });
const js = m.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(here, 'src/style.css'), 'utf8');
const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'WebApplication', name: 'MLWeb', url: SITE + '/', applicationCategory: 'EducationalApplication', operatingSystem: 'Any (web browser)', inLanguage: ['en', 'ar'],
    description: 'Free online MATLAB-style notebook for learning image processing in the browser, with 10 ready lessons and exercises.', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    image: SITE + '/og-image.jpg', author: { '@type': 'Person', name: 'Belal Amr Mohamed', url: 'https://belal-amr.vercel.app' } },
  { '@type': 'Person', name: 'Belal Amr Mohamed', url: 'https://belal-amr.vercel.app' }] }).replace(/</g, '\\u003c');
const lessonList = lessons.map(l => `<li><a href="${SITE}/#${l.id}">${l.title}</a></li>`).join('');
const html = readFileSync(path.join(here, 'src/index.html'), 'utf8')
  .replace('/*CSS*/', () => css).replace('/*JS*/', () => js)
  .replaceAll('%%SITE%%', SITE).replace('%%JSONLD%%', () => jsonld).replace('%%LESSONLIST%%', () => lessonList);
mkdirSync(dist, { recursive: true });
if (existsSync(path.join(here, 'public'))) cpSync(path.join(here, 'public'), dist, { recursive: true });
writeFileSync(path.join(dist, 'index.html'), html);
writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
const day = new Date().toISOString().slice(0, 10);
writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><lastmod>${day}</lastmod><priority>1.0</priority></url>\n</urlset>\n`);
writeFileSync(path.join(dist, 'site.webmanifest'), JSON.stringify({ name: 'MLWeb – Online MATLAB Image Processing Notebook', short_name: 'MLWeb', start_url: '/', display: 'standalone',
  background_color: '#12151c', theme_color: '#c2410c', icons: [
    { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ] }, null, 1));
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB', '| site', SITE, '| lessons', lessons.length);
