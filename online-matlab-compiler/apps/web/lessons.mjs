import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
// Lesson file: header lines "@key value", then cells separated by "%% md" / "%% code".
export function parseLesson(text) {
  const lesson = { id: '', title: '', group: '', files: [], cells: [] };
  let cur = null;
  for (const ln of text.replace(/\r\n?/g, '\n').split('\n')) {
    let m;
    if (!cur && (m = /^@(\w+)\s*(.*)$/.exec(ln))) { if (m[1] === 'files') lesson.files = m[2].split(/\s+/).filter(Boolean); else lesson[m[1]] = m[2].trim(); }
    else if ((m = /^%%\s+(md|code)\s*$/.exec(ln))) { cur = { type: m[1], lines: [] }; lesson.cells.push(cur); }
    else if (cur) cur.lines.push(ln);
  }
  lesson.cells = lesson.cells.map(c => ({ type: c.type, src: c.lines.join('\n').replace(/^\n+|\n+$/g, '') }));
  return lesson;
}
export function loadLessons(dir) {
  const order = ['section-1', 'section-2', 'section-3', 'section-4', 'lecture-1', 'lecture-2', 'lecture-3', 'lecture-4', 'lecture-5', 'lecture-6'];
  return readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => parseLesson(readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
