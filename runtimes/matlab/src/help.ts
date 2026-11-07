// =============================================================================
// runtimes/matlab/src/help.ts
// MATLAB-specific entries of the help dialog (the generic notebook shortcuts come from the shell).
// Each item: [title, English text, Arabic text].
// =============================================================================
import type { Engine } from '../../shared/engine';

export const MATLAB_HELP: NonNullable<Engine['help']> = {
  title: 'MLWeb help',
  intro: 'Search supported MATLAB-style commands and notebook shortcuts.',
  items: [
    ["switch / case", "Choose one branch with switch value, case value, otherwise, and end.", "اختر فرعاً باستخدام switch وcase وotherwise وend."],
    ["Arrays and cells", "Create numeric arrays with [1 2; 3 4] and cell arrays with {1, \"text\"}.", "أنشئ مصفوفة رقمية مثل [1 2; 3 4] أو خلية مثل {1, \"text\"}."],
    ["Structs", "Read and assign fields with s.name; create values with struct('name', value).", "اقرأ وعيّن الحقول باستخدام s.name؛ وأنشئ البنية عبر struct."],
    ["Image input/output", "imread, imwrite, imshow, imtool, imfinfo, and histeq.", "أوامر الصور: imread وimwrite وimshow وimtool وimfinfo وhisteq."],
    ["Image transforms", "rgb2gray, rgb2hsv, rgb2ycbcr, imcrop, imresize, imrotate, imhist.", "تحويلات الصور: rgb2gray وrgb2hsv وrgb2ycbcr وimcrop وimresize وimrotate وimhist."],
    ["Array operations", "size, numel, length, reshape, repmat, indexing, ranges, and logical masks.", "عمليات المصفوفات: size وnumel وlength وreshape وrepmat والفهرسة والنطاقات."],
    ["Math and display", "sum, mean, max, min, abs, sqrt, disp, fprintf, sprintf, and error.", "الحساب والعرض: sum وmean وmax وmin وabs وsqrt وdisp وfprintf وsprintf وerror."],
    ["Compatibility", "MLWeb implements an educational MATLAB-style subset; it is not a full MATLAB runtime.", "يقدم MLWeb مجموعة تعليمية بأسلوب MATLAB وليس بيئة MATLAB كاملة."],
  ],
};
