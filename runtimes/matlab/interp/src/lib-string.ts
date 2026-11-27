import { parse } from './parser';
import { T, V, C, isT, isC, isStr, toStr, str, mk, num, scalarOf } from './values';
import { Def, err, T_, sprintfFmt } from './lib-common';

function safeParseNumericMatrix(s: string): T | null {
  const tr = s.trim();
  if (!tr) return mk('double', [0, 0]);
  try {
    const ast = parse(tr);
    if (ast.length !== 1 || ast[0].k !== 'expr') return null;
    const evalLit = (e: any): number[][] | null => {
      if (e.k === 'num') return [[e.v]];
      if (e.k === 'un' && e.op === '-' && e.a.k === 'num') return [[-e.a.v]];
      if (e.k === 'un' && e.op === '+' && e.a.k === 'num') return [[e.a.v]];
      if (e.k === 'id' && /^(inf|Inf)$/i.test(e.n)) return [[Infinity]];
      if (e.k === 'id' && /^(nan|NaN)$/i.test(e.n)) return [[NaN]];
      if (e.k === 'id' && e.n === 'pi') return [[Math.PI]];
      if (e.k === 'mat') {
        if (!e.rows.length) return [];
        const out: number[][] = [];
        for (const r of e.rows) {
          const row: number[] = [];
          for (const item of r) {
            const sub = evalLit(item);
            if (!sub || sub.length !== 1) return null;
            row.push(...sub[0]);
          }
          out.push(row);
        }
        return out;
      }
      return null;
    };
    const mat = evalLit(ast[0].e);
    if (!mat) return null;
    if (!mat.length) return mk('double', [0, 0]);
    const rows = mat.length, cols = mat[0].length;
    if (mat.some(r => r.length !== cols)) return null;
    const t = mk('double', [rows, cols]);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) t.data[i + rows * j] = mat[i][j];
    return t;
  } catch {
    return null;
  }
}

export function registerString(def: Def) {
  def('sprintf', a => [str(sprintfFmt(toStr(a[0]), a.slice(1), 'sprintf'))]);
  def('fprintf', (a, _n, I) => { I.host.print(sprintfFmt(toStr(a[0]), a.slice(1), 'fprintf')); return []; });

  def('num2str', a => {
    const t = T_(a[0], 'num2str');
    if (t.cls === 'char') return [t];
    const fmtArg = a[1];
    const fmtNum = (v: number): string => {
      if (fmtArg) {
        if (isStr(fmtArg)) return sprintfFmt(toStr(fmtArg), [num(v)], 'num2str');
        const p = Math.max(1, Math.floor(scalarOf(fmtArg)));
        return Number.isInteger(v) ? String(v) : String(+v.toPrecision(p));
      }
      return Number.isInteger(v) ? String(v) : String(+v.toPrecision(5));
    };
    if (t.data.length === 1) return [str(fmtNum(t.data[0]))];
    const r = t.dims[0] || 0, c = t.dims[1] || 0;
    if (r === 0 || c === 0) return [str('')];
    const strs = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => fmtNum(t.data[i + r * j])));
    const w = Math.max(...strs.flat().map(x => x.length));
    const lines = strs.map(row => row.map(x => x.padStart(w)).join('  '));
    if (lines.length === 1) return [str(lines[0].trimStart())];
    const ml = Math.max(...lines.map(l => l.length));
    const out = mk('char', [lines.length, ml]);
    for (let i = 0; i < lines.length; i++) {
      const padded = lines[i].padEnd(ml, ' ');
      for (let j = 0; j < ml; j++) out.data[i + lines.length * j] = padded.charCodeAt(j);
    }
    return [out];
  });

  def('int2str', a => {
    const t = T_(a[0], 'int2str');
    const r = t.dims[0] || 0, c = t.dims[1] || 0;
    if (r === 0 || c === 0) return [str('')];
    const strs = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => String(Math.round(t.data[i + r * j]))));
    const w = Math.max(...strs.flat().map(x => x.length));
    const lines = strs.map(row => row.map(x => x.padStart(w)).join('  '));
    if (lines.length === 1) return [str(lines[0].trimStart())];
    const ml = Math.max(...lines.map(l => l.length));
    const out = mk('char', [lines.length, ml]);
    for (let i = 0; i < lines.length; i++) {
      const padded = lines[i].padEnd(ml, ' ');
      for (let j = 0; j < ml; j++) out.data[i + lines.length * j] = padded.charCodeAt(j);
    }
    return [out];
  });

  def('mat2str', a => {
    const t = T_(a[0], 'mat2str');
    const p = a[1] && !isStr(a[1]) ? Math.max(1, Math.floor(scalarOf(a[1]))) : 15;
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(p)));
    const [r, c] = t.dims;
    if (r === 0 || c === 0) return [str('[]')];
    if (t.data.length === 1) return [str(fmt(t.data[0]))];
    const rows = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => fmt(t.data[i + r * j])).join(' '));
    return [str(`[${rows.join(';')}]`)];
  });

  def('strcat', a => {
    if (!a.length) return [str('')];
    if (a.some(isC)) {
      const len = Math.max(...a.map(x => (isC(x) ? x.data.length : 1)));
      const out: V[] = [];
      for (let i = 0; i < len; i++) {
        let s = '';
        for (const x of a) s += isC(x) ? toStr(x.data[x.data.length === 1 ? 0 : i]) : toStr(x);
        out.push(str(s));
      }
      return [{ cls: 'cell', dims: [1, len], data: out } as C];
    }
    return [str(a.map(x => toStr(x)).join(''))];
  });

  def('strrep', a => [str(toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])))]);
  def('strtrim', a => {
    if (isC(a[0])) return [{ cls: 'cell', dims: a[0].dims.slice(), data: a[0].data.map(x => str(toStr(x).trim())) } as C];
    return [str(toStr(a[0]).trim())];
  });
  def('upper', a => {
    if (isC(a[0])) return [{ cls: 'cell', dims: a[0].dims.slice(), data: a[0].data.map(x => str(toStr(x).toUpperCase())) } as C];
    return [str(toStr(a[0]).toUpperCase())];
  });
  def('lower', a => {
    if (isC(a[0])) return [{ cls: 'cell', dims: a[0].dims.slice(), data: a[0].data.map(x => str(toStr(x).toLowerCase())) } as C];
    return [str(toStr(a[0]).toLowerCase())];
  });
  def('strsplit', a => {
    const s = toStr(a[0]);
    const parts = a[1] ? s.split(toStr(a[1])) : s.trim().split(/\s+/).filter(Boolean);
    return [{ cls: 'cell', dims: [1, parts.length], data: parts.map(str) } as C];
  });
  def('strjoin', a => {
    if (!isC(a[0])) err('Error using strjoin: First input must be a cell array of strings.');
    const sep = a[1] ? toStr(a[1]) : ' ';
    return [str(((a[0] as any).data as V[]).map(toStr).join(sep))];
  });
  def('strcmp', a => [num(+(isStr(a[0]) && isStr(a[1]) && toStr(a[0]) === toStr(a[1])), 'logical')]);
  def('strcmpi', a => [num(+(isStr(a[0]) && isStr(a[1]) && toStr(a[0]).toLowerCase() === toStr(a[1]).toLowerCase()), 'logical')]);
  def('strncmp', a => {
    const n = Math.max(0, Math.floor(scalarOf(a[2])));
    return [num(+(isStr(a[0]) && isStr(a[1]) && toStr(a[0]).slice(0, n) === toStr(a[1]).slice(0, n)), 'logical')];
  });
  def('strncmpi', a => {
    const n = Math.max(0, Math.floor(scalarOf(a[2])));
    return [num(+(isStr(a[0]) && isStr(a[1]) && toStr(a[0]).slice(0, n).toLowerCase() === toStr(a[1]).slice(0, n).toLowerCase()), 'logical')];
  });
  def('str2double', a => {
    if (isC(a[0])) {
      const out = mk('double', a[0].dims.slice());
      a[0].data.forEach((x, i) => {
        const s = toStr(x).trim();
        out.data[i] = s === '' ? NaN : Number(s);
      });
      return [out];
    }
    const s = toStr(a[0]).trim();
    return [num(s === '' ? NaN : Number(s))];
  });
  def('str2num', (a, nargout) => {
    const res = safeParseNumericMatrix(toStr(a[0]));
    if (!res) return nargout > 1 ? [mk('double', [0, 0]), num(0, 'logical')] : [mk('double', [0, 0])];
    return nargout > 1 ? [res, num(1, 'logical')] : [res];
  });
}
