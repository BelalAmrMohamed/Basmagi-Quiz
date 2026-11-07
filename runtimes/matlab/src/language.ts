// =============================================================================
// runtimes/matlab/src/language.ts
// MATLAB syntax highlighting (CodeMirror StreamLanguage on top of the Octave mode)
// and the word lists shared with completions.ts.
// =============================================================================
import { StreamLanguage } from '@codemirror/language';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { tags } from '@lezer/highlight';

export const keywords = new Set([
  "break", "case", "catch", "continue", "else", "elseif", "end", "for", "function", "global", "if", "otherwise", "persistent", "return", "switch", "try", "while",
]);
export const builtins = new Set([
  "arrayfun", "cellfun", "cell", "struct", "fieldnames", "isfield", "isstruct", "iscell", "num2cell", "imread", "imwrite", "imshow", "imtool", "imfinfo", "imcrop", "imresize", "imrotate", "imhist", "histeq", "rgb2gray", "rgb2hsv", "rgb2ycbcr", "im2double", "im2uint8", "ind2rgb", "gray2ind", "uint8", "uint16", "uint32", "uint64", "int8", "int16", "int32", "int64", "single", "double", "logical", "abs", "acos", "asin", "atan", "ceil", "cos", "exp", "floor", "log", "log10", "max", "mean", "median", "min", "mod", "numel", "prod", "reshape", "round", "size", "sort", "sqrt", "std", "sum", "tan", "any", "all", "find", "length", "linspace", "zeros", "ones", "eye", "repmat", "flip", "fliplr", "flipud", "disp", "fprintf", "sprintf", "error", "warning", "clear", "clc", "figure", "plot", "title", "xlabel", "ylabel",
]);
export const types = new Set([
  "cell", "double", "int8", "int16", "int32", "int64", "logical", "single", "struct", "uint8", "uint16", "uint32", "uint64",
]);
export const constants = new Set(['false', 'true', 'eps', 'i', 'j', 'pi']);

const mode = {
  ...octave,
  tokenTable: {
    keyword: tags.keyword,
    builtin: tags.standard(tags.variableName),
    variable: tags.variableName,
    type: tags.typeName,
    constant: tags.atom,
    string: tags.string,
    number: tags.number,
    comment: tags.comment,
    operator: tags.operator,
    error: tags.invalid,
  },
  token(stream: Parameters<typeof octave.token>[0], state: Parameters<typeof octave.token>[1]) {
    const style = octave.token(stream, state);
    const word = stream.current();
    if (style === 'builtin' && keywords.has(word)) return 'keyword';
    if (style === 'variable') {
      if (types.has(word)) return 'type';
      if (builtins.has(word)) return 'builtin';
      if (constants.has(word)) return 'constant';
    }
    return style;
  },
};

export const matlabLanguage = StreamLanguage.define(mode);
