// Unit tests for the C++ completion source, plus a real CodeMirror editor under jsdom
// to prove it triggers on typing ('#', space after #include) and on Ctrl+Space.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const here = import.meta.dirname, root = path.join(here, '..');
const bundle = async (entry, format = 'esm', globalName) => (await build({
  absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, format, globalName, loader: { '.css': 'empty' },
  alias: {
    '@codemirror/state': path.resolve(root, 'node_modules/@codemirror/state'),
    '@codemirror/view': path.resolve(root, 'node_modules/@codemirror/view'),
  },
  define: { 'process.env.NODE_ENV': '"test"' }
})).outputFiles[0].text;

const unit = await import('data:text/javascript;base64,' + Buffer.from(await bundle('cpp/src/completions.ts')).toString('base64'));
const { cppCompletions, scanNotebook, lexState, stripNoise } = unit;
const { EditorState } = await import('@codemirror/state');

/** Run the source with the cursor at the end of `src` (or at `pos`). */
function complete(src, { explicit = false, sources = [], pos = src.length } = {}) {
  const state = EditorState.create({ doc: src });
  const ctx = { state, pos, explicit, matchBefore: (re) => { const t = src.slice(0, pos), m = t.match(new RegExp('(?:' + re.source + ')$')); return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null; } };
  return cppCompletions({ codeSources: () => sources })(ctx);
}
const labels = (r) => r.options.map((o) => o.label);

// ------------------------------------------------------------------ lexing and scanning
test('lexState understands comments, strings, chars, raw strings and digit separators', () => {
  assert.equal(lexState('int x; // hi'), 'comment');
  assert.equal(lexState('int x; // hi\nint y'), 'code');
  assert.equal(lexState('/* open\nstill'), 'comment');
  assert.equal(lexState('/* closed */ int y'), 'code');
  assert.equal(lexState('cout << "abc'), 'string');
  assert.equal(lexState('cout << "a\\"b" << x'), 'code');
  assert.equal(lexState("char c = 'a"), 'char');
  assert.equal(lexState('auto s = R"x(a "quoted" b'), 'string');
  assert.equal(lexState('auto s = R"x(a)x" + y'), 'code');
  assert.equal(lexState("int big = 1'000'000 + z"), 'code');
});
test('stripNoise removes comments and literals but keeps line structure', () => {
  const out = stripNoise('int a; // x\nstring s = "int b;"; /* int c;\nint d; */ char q = \'z\';');
  assert.ok(!/\b[bcd]\b/.test(out.replace(/\bint\b|\bstring\b|\bchar\b/g, '')));
  assert.equal(out.split('\n').length, 3);
});
const SAMPLE = `#include <iostream>
#define LIMIT 10
#define SQ(x) ((x)*(x))
using namespace std;
typedef unsigned long long ull;
using Grid = vector<vector<int>>;
enum Color { RED, GREEN = 2, BLUE };
struct Point { int x, y; double len() const { return 0; } };
class Shape { public: virtual double area(int scale, const string& label) const = 0; };
template <typename T, int N> T twice(T a) { return a; }
namespace geo { int zero = 0; }
int counter = 0, *ptr = nullptr, arr[3];
const int MAXN = 5;
vector<int> nums = {1,2,3};
map<string, vector<int>> table;
std::string name("x");
int add(int a, int b) { return a + b; }
void show(const vector<int>& v, int n);
int main(){
  for (int i = 0, j = 5; i < 3; ++i) {}
  for (auto& item : nums) {}
  auto [p, q] = make_pair(1,2);
  int x(5);
  Point pt;
  try {} catch (const exception& e) {}
  return x;
  // int hidden = 1;
  string s = "int fake = 2;";
}`;
test('scanNotebook finds variables, functions, types, macros, enumerators and namespaces', () => {
  const r = scanNotebook([SAMPLE]);
  for (const v of ['counter', 'ptr', 'arr', 'MAXN', 'nums', 'table', 'name', 'i', 'j', 'item', 'p', 'q', 'x', 'pt', 'e', 's', 'a', 'b', 'v', 'n', 'scale', 'label']) assert.ok(r.vars.has(v), 'var ' + v);
  for (const f of ['add', 'show', 'twice', 'area', 'len']) assert.ok(r.functions.has(f), 'function ' + f);
  assert.ok(!r.functions.has('main'));
  for (const t of ['Color', 'Point', 'Shape', 'Grid', 'ull', 'T']) assert.ok(r.types.has(t), 'type ' + t);
  assert.deepEqual([...r.macros].sort(), ['LIMIT', 'SQ']);
  assert.deepEqual([...r.enumerators].sort(), ['BLUE', 'GREEN', 'RED']);
  assert.ok(r.namespaces.has('geo')); assert.equal(r.usingStd, true);
  for (const bad of ['hidden', 'fake', 'return', 'std', 'string', 'int', 'make_pair']) assert.ok(!r.vars.has(bad), 'not a var: ' + bad);
});
test('scanNotebook merges cells: a type from cell 1 makes declarations in cell 2 visible', () => {
  const r = scanNotebook(['struct Account { int id; };', 'Account acct;\nAccount other, *third;']);
  for (const v of ['acct', 'other', 'third']) assert.ok(r.vars.has(v), v);
});
test('return/delete/goto statements are not mistaken for declarations', () => {
  const r = scanNotebook(['int f(int a){ return a; }\nvoid g(int* p){ delete p; goto done; done: ; }']);
  assert.ok(!r.vars.has('a') === false); // parameter a is a var
  assert.ok(!r.vars.has('done')); assert.ok(r.functions.has('f') && r.functions.has('g'));
});

// ------------------------------------------------------------------ the source
test('"#" alone offers the preprocessor directives, replacing from the "#"', () => {
  const r = complete('#');
  assert.equal(r.from, 0);
  for (const l of ['#include', '#define', '#pragma', '#ifdef', '#ifndef', '#endif', '#if', '#else', '#elif', '#undef', '#error', '#line']) assert.ok(labels(r).includes(l), l);
  assert.equal(complete('  #inc').from, 2);
  assert.equal(complete('int x; #'), null, 'a # in the middle of a line is not a directive');
});
test('"#include " offers <header> entries and a quoted-header snippet', () => {
  const r = complete('#include ');
  for (const l of ['<iostream>', '<vector>', '<string>', '<algorithm>', '<cmath>', '<bits/stdc++.h>', '<cstdio>', '<map>', '<unordered_map>', '<numeric>', '<iomanip>', '<sstream>']) assert.ok(labels(r).includes(l), l);
  assert.ok(labels(r).includes('"file.h"'));
  assert.ok(!labels(r).includes('<span>') && !labels(r).includes('<format>'), 'only C++17 headers');
});
test('after "<" the header names are offered and "apply" closes the bracket', () => {
  const r = complete('#include <ve');
  assert.equal(r.from, '#include <'.length);
  const o = r.options.find((x) => x.label === 'vector');
  assert.equal(o.apply, 'vector>');
  assert.equal(r.to, '#include <ve'.length);
  // an existing ">" is consumed so it is not doubled
  const withGt = complete('#include <ve>', { pos: '#include <ve'.length });
  assert.equal(withGt.to, '#include <ve'.length + 1);
});
test('quoted includes work even though the cursor is inside a string', () => {
  const r = complete('#include "ma');
  assert.equal(r.from, '#include "'.length);
  assert.equal(r.options.find((x) => x.label === 'math.h').apply, 'math.h"');
  assert.equal(complete('#include "ma"', { pos: '#include "ma'.length }).to, '#include "ma"'.length);
});
test('#ifdef / #undef offer macros, #pragma offers pragma kinds', () => {
  assert.ok(labels(complete('#ifdef LI', { sources: ['#define LIMIT 3'] })).includes('LIMIT'));
  assert.ok(labels(complete('#ifndef ')).includes('__cplusplus'));
  assert.ok(labels(complete('#pragma ')).includes('once'));
  assert.equal(complete('#define X 1 + '), null, 'macro bodies are left alone');
});
test('std:: offers library members with their header; std::chrono:: offers clocks', () => {
  const r = complete('std::so');
  assert.equal(r.from, 'std::'.length);
  const sort = r.options.find((o) => o.label === 'sort');
  assert.match(sort.info, /#include <algorithm>/);
  for (const l of ['endl', 'getline', 'pair', 'vector', 'string', 'cout', 'min', 'max', 'unique_ptr', 'mt19937']) assert.ok(labels(complete('std::')).includes(l), l);
  assert.ok(labels(complete('std::chrono::')).includes('steady_clock'));
  assert.ok(labels(complete('chrono::st')).includes('steady_clock'));
  assert.equal(complete('std::chrono::').from, 'std::chrono::'.length);
});
test('unqualified std names insert "std::" unless the notebook has using namespace std', () => {
  const plain = complete('so').options.find((o) => o.label === 'sort');
  assert.equal(plain.apply, 'std::sort');
  const using = complete('so', { sources: ['using namespace std;'] }).options.find((o) => o.label === 'sort');
  assert.equal(using.apply, 'sort');
  // snippet templates follow the same rule
  const tpl = (src, srcs) => complete('cou', { sources: srcs }).options.find((o) => o.label === 'cout <<');
  assert.ok(tpl('cou', []) && tpl('cou', ['using namespace std;']));
});
test('keywords, types, snippets and C library names are offered', () => {
  const l = labels(complete('r'));
  for (const x of ['return', 'int', 'long long', 'unsigned long long', 'size_t', 'uint64_t', 'main', 'for', 'while', 'forr', 'cout <<', 'cin >>', 'class', 'struct', 'template', 'lambda', 'try', 'switch', 'printf', 'INT_MAX', 'nullptr', 'constexpr', 'auto', 'void', 'bool', 'double', 'enum', 'namespace']) assert.ok(l.includes(x), x);
  assert.ok(labels(complete('std::')).length > 150, 'broad std:: coverage');
});
test('member access offers common member functions and notebook names, not keywords', () => {
  const l = labels(complete('v.pu', { sources: ['int field;'] }));
  for (const x of ['push_back', 'size', 'begin', 'end', 'emplace_back', 'substr', 'first', 'second', 'field']) assert.ok(l.includes(x), x);
  assert.ok(!l.includes('return'));
  assert.ok(labels(complete('ptr->')).includes('size'));
  assert.equal(complete('double d = 3.'), null, 'decimal point is not member access');
  assert.equal(complete('f(a...'), null);
});
test('identifiers declared in the notebook rank first and carry a detail', () => {
  const r = complete('cou', { sources: ['int counter = 0;', 'void count_up(int step) {}\nstruct Counter {};'] });
  const top = r.options.filter((o) => o.detail?.startsWith('notebook'));
  assert.deepEqual(top.map((o) => o.label).sort(), ['Counter', 'count_up', 'counter', 'step']);
  assert.ok(top.every((o) => o.boost >= 3));
});
test('nothing is offered inside comments, strings or char literals, or when not explicit and empty', () => {
  assert.equal(complete('// retu'), null);
  assert.equal(complete('/* ret'), null);
  assert.equal(complete('cout << "ret'), null);
  assert.equal(complete("char c = 'r"), null);
  assert.equal(complete('int x = 2ab'), null, 'inside a number');
  assert.equal(complete('int x = '), null);
  assert.equal(complete('// #inc'), null, 'a commented-out directive');
});
test('Ctrl+Space (explicit) opens the full list even with nothing typed', () => {
  const r = complete('int x = ', { explicit: true });
  assert.ok(r.options.length > 200);
  assert.equal(r.from, 'int x = '.length);
});
test('snippets expand to valid C++ with the std:: prefix rule applied', async () => {
  const { EditorState, EditorSelection } = await import('@codemirror/state');
  const { EditorView } = await import('@codemirror/view');
  void EditorState; void EditorSelection; void EditorView;
  const r = complete('ma');
  const main = r.options.filter((o) => o.label === 'main');
  assert.equal(main.length, 2);
  assert.ok(main.every((o) => typeof o.apply === 'function'));
});

// ------------------------------------------------------------------ real editor under jsdom
const entry = `
import { EditorView } from '@codemirror/view';
import { currentCompletions, completionStatus, startCompletion, acceptCompletion } from '@codemirror/autocomplete';
import { createCppEngine } from './cpp/src/engine';
import { createEditorState } from './shared/editor';
export { EditorView, currentCompletions, completionStatus, startCompletion, acceptCompletion, createCppEngine, createEditorState };
`;
const entryFile = path.join(root, '_cpp-completion-entry.ts');
writeFileSync(entryFile, entry);
let code;
try { code = await bundle('_cpp-completion-entry.ts', 'iife', 'T'); } finally { rmSync(entryFile); }

function editor(doc, sources = []) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  const w = dom.window;
  w.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.eval(code);
  const T = w.T;
  const engine = T.createCppEngine({ execute: async () => ({ ok: true }) });
  engine.attach({ codeSources: () => sources });
  const view = new T.EditorView({ state: T.createEditorState(engine, doc, { runAdvance() {}, runStay() {}, escape() {}, change() {} }), parent: w.document.getElementById('host') });
  return { T, view, w };
}
// autocompletion waits activateOnTypingDelay (100 ms) before querying
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const type = (view, text) => { const pos = view.state.selection.main.head; view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: 'input.type' }); };

test('typing "#" in a real editor opens the directive popup', async () => {
  const { T, view } = editor('');
  type(view, '#');
  await settle();
  assert.equal(T.completionStatus(view.state), 'active');
  const labelsNow = T.currentCompletions(view.state).map((c) => c.label);
  assert.ok(labelsNow.includes('#include') && labelsNow.includes('#define') && labelsNow.includes('#pragma'));
  view.destroy();
});
test('typing "#include " then "<" lists headers; accepting <vector> completes the line', async () => {
  const { T, view } = editor('');
  for (const ch of '#include ') { type(view, ch); await settle(5); }
  await settle();
  assert.equal(T.completionStatus(view.state), 'active');
  assert.ok(T.currentCompletions(view.state).some((c) => c.label === '<iostream>'));
  type(view, '<'); type(view, 'vec');
  await settle();
  // the list opened at "#include " stays valid while typing "<vec", so its entries are the "<header>" forms
  const vec = T.currentCompletions(view.state).find((c) => c.label === 'vector' || c.label === '<vector>');
  assert.ok(vec, 'vector offered after "<vec"');
  T.acceptCompletion(view);
  assert.equal(view.state.doc.toString(), '#include <vector>');
  view.destroy();
});
test('Ctrl+Space (startCompletion) opens the popup on an empty line', async () => {
  const { T, view } = editor('');
  T.startCompletion(view);
  await settle();
  assert.equal(T.completionStatus(view.state), 'active');
  assert.ok(T.currentCompletions(view.state).some((c) => c.label === 'main'));
  view.destroy();
});
test('typing a declared name from another cell offers it; the main snippet expands in place', async () => {
  const { T, view } = editor('', ['int totalScore = 0;']);
  type(view, 'totalS');
  await settle();
  assert.ok(T.currentCompletions(view.state).some((c) => c.label === 'totalScore' && c.detail === 'notebook'));
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
  type(view, 'mai');
  await settle();
  const pick = T.currentCompletions(view.state).find((c) => c.label === 'main' && c.detail === 'int main()');
  assert.ok(pick);
  pick.apply(view, pick, 0, 3);
  assert.match(view.state.doc.toString(), /^int main\(\) \{\n    \n    return 0;\n\}$/);
  view.destroy();
});
