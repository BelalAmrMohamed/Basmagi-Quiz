// =============================================================================
// api/local-asset.js
// 
// Workaround for a known bug in Vercel Dev on Windows where it fails to serve
// static files that contain spaces or Arabic characters.
// This route manually reads the file from the public directory and serves it.
// =============================================================================

import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const file = req.query.file;
  console.log(`[local-asset] Request received for file: ${file}`);
  if (!file) return res.status(400).send("No file specified");

  // Prevent directory traversal
  const safePath = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
  const absPath = path.join(process.cwd(), 'public', safePath);
  console.log(`[local-asset] Attempting to read: ${absPath}`);

  try {
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase();
      let contentType = 'text/plain';
      if (ext === '.json') contentType = 'application/json; charset=utf-8';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.svg') contentType = 'image/svg+xml';

      res.setHeader('Content-Type', contentType);
      // Cache locally to prevent constant re-reads
      res.setHeader('Cache-Control', 'public, max-age=3600');
      const stream = fs.createReadStream(absPath);
      stream.pipe(res);
    } else {
      res.status(404).send("File not found");
    }
  } catch (err) {
    res.status(500).send("Server error");
  }
}
