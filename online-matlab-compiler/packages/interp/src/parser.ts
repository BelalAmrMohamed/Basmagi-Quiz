// MATLAB-subset lexer + parser. Pure TypeScript, no DOM/Node dependencies.
export class MatlabError extends Error {}
export type Tok = { t: string; v: any; sp: boolean; line: number };
const KW = new Set(['for', 'while', 'if', 'elseif', 'else', 'end', 'function', 'return', 'break', 'continue', 'switch', 'case', 'otherwise']);
// Commands MATLAB allows in "command syntax" (e.g. `imfinfo 'x.png'`, `hold on`).
const CMDS = new Set(['imfinfo', 'clear', 'close', 'help', 'doc', 'lookfor', 'format', 'hold', 'who', 'whos', 'clc', 'figure', 'clearvars', 'imtool', 'imshow']);

export function lex(src: string): Tok[] {
  src = src.replace(/\r\n?/g, '\n');
  // command syntax -> function-call syntax, also after `;` or `,` (e.g. `hold on; imfinfo 'a.png'`)
  const CMD_RE = /(^\s*|[;,]\s*)([A-Za-z]\w*)[ \t]+(?![=(])((?:'[^']*'|"[^"]*"|[^\s;,%'"=(])(?:'[^']*'|"[^"]*"|[^;,%'"])*?)(?=\s*(?:[;,%]|$))/g;
  src = src.split('\n').map(l => l.replace(CMD_RE, (m, pre, name, rest) => {
    if (!CMDS.has(name)) return m;
    const args = rest.match(/'[^']*'|"[^"]*"|[^\s]+/g)!.map((x: string) => (/^['"]/.test(x) ? x : `'${x}'`));
    return `${pre}${name}(${args.join(',')})`;
  })).join('\n');
  const toks: Tok[] = [], st: string[] = [];
  let i = 0, line = 1;
  const push = (t: string, v: any, sp: boolean) => toks.push({ t, v, sp, line });
  while (i < src.length) {
    let sp = false;
    while (src[i] === ' ' || src[i] === '\t') { i++; sp = true; }
    if (i >= src.length) break;
    const c = src[i], top = st[st.length - 1];
    if (c === '%') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('...', i)) { while (i < src.length && src[i] !== '\n') i++; i++; line++; continue; }
    if (c === '\n') {
      i++;
      if (top === '(') { line++; continue; }
      if (top === '[' || top === '{') push('op', ';', sp); else push('nl', '\n', sp);
      line++; continue;
    }
    let m: RegExpExecArray | null;
    const rest = src.slice(i, i + 64);
    if ((m = /^(\d+(\.(?![*\/^\\'])\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest))) { push('num', parseFloat(m[0]), sp); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const w = m[0];
      if (KW.has(w) && !(w === 'end' && st.length)) push('kw', w, sp); else push('id', w, sp);
      i += w.length; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) { if (src[j] === '"') j++; s += src[j]; j++; }
      push('str', s, sp); i = j + 1; continue;
    }
    if (c === "'") {
      const p = toks[toks.length - 1];
      const operand = p && (p.t === 'num' || p.t === 'id' || p.t === 'str' || (p.t === 'op' && [')', ']', '}', "'", ".'"].includes(p.v)));
      if (operand && !(sp && top === '[')) { push('op', "'", sp); i++; continue; }
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '\n' && !(src[j] === "'" && src[j + 1] !== "'")) { if (src[j] === "'") j++; s += src[j]; j++; }
      push('str', s, sp); i = j + 1; continue;
    }
    const two = src.substr(i, 2);
    const op = ['.*', './', '.^', ".'", '==', '~=', '<=', '>=', '&&', '||'].includes(two) ? two : c;
    if ('([{'.includes(op)) st.push(op); else if (')]}'.includes(op)) st.pop();
    push('op', op, sp); i += op.length;
  }
  push('nl', '\n', false); push('eof', null, false);
  return toks;
}

export function parse(src: string): any[] {
  const toks = lex(src); let p = 0, inMat = false;
  const peek = () => toks[p], nxt = () => toks[p++];
  const isOp = (v: string) => toks[p].t === 'op' && toks[p].v === v;
  const isKw = (v: string) => toks[p].t === 'kw' && toks[p].v === v;
  const err = (m: string): never => { throw new MatlabError(`Parse error (line ${toks[p].line}): ${m}`); };
  const expectOp = (v: string) => { if (!isOp(v)) err(`expected '${v}'`); p++; };
  const skipSeps = () => { while (peek().t === 'nl' || isOp(';') || isOp(',')) p++; };

  function block(terms: string[]): any[] {
    const out: any[] = [];
    for (;;) {
      skipSeps();
      const t = peek();
      if (t.t === 'eof' || (t.t === 'kw' && terms.includes(t.v))) return out;
      out.push(statement());
    }
  }
  function endOfStmt(): boolean { // returns the "show result" flag
    let show = true;
    if (isOp(';')) { show = false; p++; } else if (isOp(',') || peek().t === 'nl') p++;
    else if (peek().t !== 'eof' && peek().t !== 'kw') err('unexpected token ' + JSON.stringify(peek().v));
    return show;
  }
  function statement(): any {
    const t = peek();
    if (t.t === 'kw') {
      p++;
      switch (t.v) {
        case 'switch': {
          const value = expr();
          const cases: any[] = [];
          let otherwise: any[] | null = null;
          skipSeps();
          while (isKw('case') || isKw('otherwise')) {
            if (isKw('case')) {
              p++;
              const match = expr();
              skipSeps();
              cases.push({ match, body: block(['case', 'otherwise', 'end']) });
            } else {
              p++;
              skipSeps();
              otherwise = block(['end']);
              break;
            }
          }
          if (!isKw('end')) err("missing 'end'");
          p++;
          return { k: 'switch', value, cases, otherwise };
        }
        case 'for': {
          const paren = isOp('('); if (paren) p++;
          const v = nxt().v; expectOp('='); const e = expr(); if (paren && isOp(')')) p++;
          return { k: 'for', v, e, body: endBlock() };
        }
        case 'while': { const c = expr(); return { k: 'while', c, body: endBlock() }; }
        case 'if': {
          const clauses: any[] = []; let els: any[] | null = null;
          let c = expr(); let body = block(['elseif', 'else', 'end']); clauses.push({ c, body });
          for (;;) {
            if (isKw('elseif')) { p++; c = expr(); body = block(['elseif', 'else', 'end']); clauses.push({ c, body }); }
            else if (isKw('else')) { p++; els = block(['end']); }
            else break;
          }
          if (!isKw('end')) err("missing 'end'");
          p++;
          return { k: 'if', clauses, els };
        }
        case 'function': return func();
        case 'break': case 'continue': case 'return': endOfStmt(); return { k: t.v };
        default: err(`unexpected '${t.v}'`);
      }
    }
    if (isOp('[')) { // multi-assign [a,b] = ...
      let q = p + 1, d = 1;
      while (d && toks[q].t !== 'eof') {
        if (toks[q].t === 'op' && toks[q].v === '[') d++;
        if (toks[q].t === 'op' && toks[q].v === ']') d--;
        q++;
      }
      if (toks[q].t === 'op' && toks[q].v === '=') {
        p++; const lhs: any[] = [];
        while (!isOp(']')) {
          if (isOp(',')) { p++; continue; }
          if (isOp('~')) { p++; lhs.push(null); continue; }
          lhs.push(lvalue(primaryPostfix()));
        }
        p++; p++;
        const rhs = expr();
        return { k: 'assign', lhs, rhs, show: endOfStmt() };
      }
    }
    const e = expr();
    if (isOp('=')) { p++; const rhs = expr(); return { k: 'assign', lhs: [lvalue(e)], rhs, show: endOfStmt() }; }
    return { k: 'expr', e, show: endOfStmt() };
  }
  function lvalue(e: any) {
    if (e.k === 'id' || e.k === 'idx' || e.k === 'cellidx' || e.k === 'field') return e;
    return err('invalid assignment target');
  }
  function endBlock() { const b = block(['end']); if (!isKw('end')) err("missing 'end'"); p++; return b; }
  function func() {
    let outs: string[] = [], name: string;
    if (isOp('[')) { p++; while (!isOp(']')) { if (isOp(',')) { p++; continue; } outs.push(nxt().v); } p++; expectOp('='); name = nxt().v; }
    else { name = nxt().v; if (isOp('=')) { p++; outs = [name]; name = nxt().v; } }
    const params: string[] = [];
    if (isOp('(')) { p++; while (!isOp(')')) { if (isOp(',')) { p++; continue; } params.push(nxt().v); } p++; }
    const body = block(['end', 'function']);
    if (isKw('end')) p++;
    return { k: 'func', name, params, outs, body };
  }

  // ---- expressions (lowest to highest precedence) ----
  function expr(): any { return bin(0); }
  const LV = [['||'], ['&&'], ['|'], ['&'], ['<', '<=', '>', '>=', '==', '~=']];
  function bin(l: number): any {
    if (l === LV.length) return range();
    let a = bin(l + 1);
    while (peek().t === 'op' && LV[l].includes(peek().v)) { const op = nxt().v; a = { k: 'bin', op, a, b: bin(l + 1) }; }
    return a;
  }
  function range(): any {
    const a = add();
    if (isOp(':') && !(toks[p + 1].t === 'op' && [')', ',', ']'].includes(toks[p + 1].v))) {
      p++; const b = add();
      if (isOp(':')) { p++; const c = add(); return { k: 'range', a, step: b, b: c }; }
      return { k: 'range', a, step: null, b };
    }
    return a;
  }
  function add(): any {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      if (inMat && peek().sp && !toks[p + 1].sp) break; // [1 -2] is two elements
      const op = nxt().v; a = { k: 'bin', op, a, b: mul() };
    }
    return a;
  }
  function mul(): any {
    let a = unary();
    while (['*', '/', '.*', './', '\\'].some(isOp)) { const op = nxt().v; a = { k: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary(): any {
    if (isOp('-') || isOp('+') || isOp('~') || isOp('!')) { const op = nxt().v; return { k: 'un', op: op === '!' ? '~' : op, a: unary() }; }
    return power();
  }
  function power(): any {
    let a = primaryPostfix();
    while (isOp('^') || isOp('.^')) { const op = nxt().v; a = { k: 'bin', op, a, b: powOperand() }; }
    return a;
  }
  function powOperand(): any {
    if (isOp('-') || isOp('+') || isOp('~')) { const op = nxt().v; return { k: 'un', op, a: powOperand() }; }
    return primaryPostfix();
  }
  function args(close: string): any[] {
    const saved = inMat; inMat = false; const a: any[] = [];
    while (!isOp(close)) {
      if (peek().t === 'eof') err(`missing '${close}'`);
      if (isOp(',')) { p++; continue; }
      if (isOp(':') && toks[p + 1].t === 'op' && [',', close].includes(toks[p + 1].v)) { p++; a.push({ k: 'colon' }); continue; }
      a.push(expr());
    }
    p++; inMat = saved; return a;
  }
  function primaryPostfix(): any {
    let e = primary();
    for (;;) {
      if (isOp("'") || isOp(".'")) { p++; e = { k: 'post', a: e }; continue; }
      if (isOp('(')) { p++; e = { k: 'apply', a: e, args: args(')') }; continue; }
      if (isOp('{')) { p++; e = { k: 'cellidx', a: e, args: args('}') }; continue; }
      if (isOp('.')) {
        p++;
        if (peek().t !== 'id') err('expected a field name after "."');
        e = { k: 'field', a: e, n: nxt().v };
        continue;
      }
      break;
    }
    return e;
  }
  function primary(): any {
    const t = nxt();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'end') return { k: 'end' };
      if (isOp('(') && !(inMat && peek().sp)) { p++; return { k: 'idx', n: t.v, args: args(')') }; }
      return { k: 'id', n: t.v };
    }
    if (t.t === 'op') {
      if (t.v === '(') { const saved = inMat; inMat = false; const e = expr(); inMat = saved; expectOp(')'); return { k: 'paren', a: e }; }
      if (t.v === '{') {
        const saved = inMat; inMat = true; const rows: any[][] = []; let row: any[] = [];
        while (!isOp('}')) {
          if (peek().t === 'eof') err("missing '}'");
          if (isOp(';')) { p++; if (row.length) rows.push(row); row = []; continue; }
          if (isOp(',')) { p++; continue; }
          row.push(expr());
        }
        p++; if (row.length) rows.push(row); inMat = saved; return { k: 'cellmat', rows };
      }
      if (t.v === '[') {
        const saved = inMat; inMat = true; const rows: any[][] = []; let row: any[] = [];
        while (!isOp(']')) {
          if (peek().t === 'eof') err("missing ']'");
          if (isOp(';')) { p++; if (row.length) rows.push(row); row = []; continue; }
          if (isOp(',')) { p++; continue; }
          row.push(expr());
        }
        p++; if (row.length) rows.push(row); inMat = saved; return { k: 'mat', rows };
      }
    }
    return err(`unexpected ${JSON.stringify(t.v)}`);
  }
  const prog = block([]);
  if (peek().t !== 'eof') err(`unexpected '${peek().v}'`);
  return prog;
}
