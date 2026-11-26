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
    ["Numeric classes", "double, single, int8, uint8, int16, uint16, int32, uint32, logical and cast convert between classes (rounding half away from zero and saturating); class, isa, intmax, intmin and whos report them. Integers combine only with the same integer class or with double/single/logical (result keeps the integer class); imread stays 8-bit; im2uint16, im2single, im2double and im2uint8 scale by the class range.", "الأصناف الرقمية: double وsingle وint8 وuint8 وint16 وuint16 وint32 وuint32 وlogical وcast للتحويل بين الأصناف (تقريب وإشباع)؛ وclass وisa وintmax وintmin وwhos لعرضها. الأعداد الصحيحة تُدمج فقط مع نفس الصنف أو مع double/single/logical؛ وimread يبقى 8 بت؛ وim2uint16 وim2single وim2double وim2uint8 تحوّل حسب مدى الصنف."],
    ["Image input/output", "imread, imwrite, imshow, imtool, imfinfo, and histeq.", "أوامر الصور: imread وimwrite وimshow وimtool وimfinfo وhisteq."],
    ["Image transforms", "rgb2gray, rgb2hsv, rgb2ycbcr, imcrop, imresize, imrotate, imhist.", "تحويلات الصور: rgb2gray وrgb2hsv وrgb2ycbcr وimcrop وimresize وimrotate وimhist."],
    ["Array operations", "size, numel, length, reshape, repmat, indexing, ranges, and logical masks.", "عمليات المصفوفات: size وnumel وlength وreshape وrepmat والفهرسة والنطاقات."],
    ["Math and display", "sum, mean, max, min, abs, sqrt, disp, fprintf, sprintf, and error.", "الحساب والعرض: sum وmean وmax وmin وabs وsqrt وdisp وfprintf وsprintf وerror."],
    ["Math and arrays (extended)", "median, mode, std, var, diff, cumprod, norm, dot, cross, det, inv, rank, eye, magic, diag, tril, triu, meshgrid, kron, permute, circshift, flip, rot90, unique, histc, accumarray, ismember, isequal, bitand, bitor, bitxor, bitshift, intmax, intmin, rng, randn.", "رياضيات ومصفوفات موسعة: median وmode وstd وvar وdiff وcumprod وnorm وdot وcross وdet وinv وrank وeye وmagic وdiag وtril وtriu وmeshgrid وkron وpermute وcircshift وflip وrot90 وunique وhistc وaccumarray وismember وisequal وbitand وbitor وbitxor وbitshift وintmax وintmin وrng وrandn."],
    ["Strings", "strcat, strrep, strsplit, strjoin, strtrim, upper, lower, strcmpi, strncmp, str2double, str2num, int2str, mat2str, num2str, sprintf and fprintf with vector recycling (%d %f %g %e %s %c %%).", "النصوص: strcat وstrrep وstrsplit وstrjoin وstrtrim وupper وlower وstrcmpi وstrncmp وstr2double وstr2num وint2str وmat2str وnum2str وsprintf وfprintf مع إعادة تدوير المتجهات."],
    ["Time and sound", "pause(s) waits up to 5 s per call; beep plays a short tone; tic and toc measure time.", "الوقت والصوت: pause(s) تنتظر حتى 5 ثوانٍ؛ وbeep تشغل نغمة قصيرة؛ وtic وtoc لقياس الزمن."],
    ["Compatibility", "MLWeb implements an educational MATLAB-style subset; it is not a full MATLAB runtime.", "يقدم MLWeb مجموعة تعليمية بأسلوب MATLAB وليس بيئة MATLAB كاملة."],
  ],
};
