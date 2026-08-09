const fs = require('fs');
const path = require('path');
const publicDir = path.join(__dirname, 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html') && !f.startsWith('google'));
for (const file of files) {
  const filePath = path.join(publicDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('/_vercel/insights/script.js')) {
    content = content.replace('</body>', '    <script defer src="/_vercel/insights/script.js"></script>\n</body>');
    fs.writeFileSync(filePath, content);
    console.log('Injected into ' + file);
  }
}
