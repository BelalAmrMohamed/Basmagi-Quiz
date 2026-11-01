import { mathToSpeech, narrate } from "./speech.mjs";
const cases = [
 "f(x)=x^2","x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}","\\frac{d}{dx}x^2 = 2x","\\int_0^1 x\\,dx = \\frac{1}{2}","Z = 3x_1 + 5x_2","2x_1 + x_2 \\le 8",
 "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1","\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}","\\begin{aligned}2x+3&=11\\\\2x&=8\\\\x&=4\\end{aligned}","\\sqrt[3]{27}=3","e^{i\\pi}+1=0","\\alpha+\\beta=\\theta"
];
for (const L of ["ar","en"]) { console.log("==",L); for (const c of cases) { try { console.log(c,"=>",mathToSpeech(c,L)); } catch(e){ console.log(c,"ERR",e.message);} } }
