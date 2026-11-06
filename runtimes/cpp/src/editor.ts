import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, completeFromList } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

type Args = { host: HTMLElement; source: string; onChange: (source: string) => void; onRunAdvance: () => void; onRunStay: () => void };
const completions = ['bool','break','case','catch','char','class','const','constexpr','continue','cout','cin','double','else','enum','false','float','for','if','int','long','namespace','nullptr','private','protected','public','return','short','signed','std::array','std::cin','std::cout','std::map','std::set','std::string','std::unordered_map','std::vector','struct','switch','template','true','try','typedef','unsigned','using','void','while'].map(label=>({label,type:'keyword'}));
const cppHighlight = HighlightStyle.define([
  {tag:tags.keyword,color:'var(--nb-syntax-keyword)',fontWeight:'600'},
  {tag:[tags.typeName,tags.className],color:'var(--nb-syntax-type)'},
  {tag:tags.name,color:'var(--nb-syntax-builtin)'},
  {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],color:'var(--nb-syntax-function)'},
  {tag:[tags.variableName,tags.propertyName],color:'var(--nb-syntax-variable)'},
  {tag:[tags.string,tags.character,tags.special(tags.string)],color:'var(--nb-syntax-string)'},
  {tag:[tags.number,tags.bool],color:'var(--nb-syntax-number)'},
  {tag:tags.comment,color:'var(--nb-syntax-comment)',fontStyle:'italic'},
  {tag:[tags.operator,tags.punctuation],color:'var(--nb-syntax-operator)'},
]);
export function createCppEditor(args: Args) {
  let view: EditorView;
  view = new EditorView({parent: args.host, state: EditorState.create({doc: args.source, extensions: [lineNumbers(), cpp(), syntaxHighlighting(cppHighlight), EditorView.theme({'&':{backgroundColor:'var(--nb-code)',color:'var(--nb-ink)'},'.cm-content':{caretColor:'var(--nb-ink)'},'.cm-gutters':{backgroundColor:'var(--nb-panel-soft)',color:'var(--nb-muted)',border:0},'.cm-activeLine':{backgroundColor:'color-mix(in srgb,var(--nb-accent) 8%,transparent)'},'.cm-activeLineGutter':{backgroundColor:'color-mix(in srgb,var(--nb-accent) 8%,transparent)'},'.cm-cursor':{borderLeftColor:'var(--nb-ink)'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'color-mix(in srgb,var(--nb-accent) 30%,transparent)'},'&.cm-focused':{outline:'none'},'.cm-tooltip':{backgroundColor:'var(--nb-panel)',color:'var(--nb-ink)',border:'1px solid var(--nb-line)'},'.cm-tooltip-autocomplete ul li[aria-selected]':{backgroundColor:'var(--nb-panel-soft)',color:'var(--nb-ink)'}}), indentUnit.of('    '), autocompletion({override:[completeFromList(completions)]}), keymap.of([{key:'Shift-Enter',run:()=>{args.onRunAdvance();return true;}},{key:'Mod-Enter',run:()=>{args.onRunStay();return true;}},...defaultKeymap,indentWithTab]), EditorView.updateListener.of(update=>{if(update.docChanged)args.onChange(update.state.doc.toString());})]})});
  // The wrapper stays on a single line; horizontal scrolling preserves source layout.
  view.dispatch({effects: EditorView.scrollIntoView(0)});
  return {destroy:()=>view.destroy(),focus:()=>view.focus(),focusLine:(line:number)=>{const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},scrollIntoView:true});view.focus();}};
}



