import{a as I}from"./chunk-TEZIBS4P.js";import{a as S,e as j,f as Q}from"./chunk-J5BBYOFQ.js";import{P as b}from"./chunk-HFOYQOFP.js";import{a as D}from"./chunk-JOVBCH5E.js";async function N(l,p,m=[],A={}){let{includeAnswers:t=!0,includeUserAnswers:c=!0,includeExplanations:y=!0,answerPlacement:i="inline"}=A,g=!1,h=!1,x=!1;p.forEach(e=>{S(e)?x=!0:e.options&&e.options.length===2?h=!0:g=!0});let n="\u0625\u062E\u062A\u064A\u0627\u0631\u064A";x&&!g&&!h?n="\u0645\u0642\u0627\u0644\u064A":x&&(n="Mixed (MCQ, True/False, Essay)");let $=new Date().toLocaleDateString(),r=`<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${l.title||"Quiz Examination"}</title>
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3CradialGradient id='bulbG' cx='36%25' cy='28%25' r='68%25'%3E%3Cstop offset='0%25' stop-color='%23FFFDE7'/%3E%3Cstop offset='22%25' stop-color='%23FFF59D'/%3E%3Cstop offset='58%25' stop-color='%23FFEB3B'/%3E%3Cstop offset='100%25' stop-color='%23FBC02D'/%3E%3C/radialGradient%3E%3ClinearGradient id='sA' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%23F0F0F0'/%3E%3Cstop offset='100%25' stop-color='%23BDBDBD'/%3E%3C/linearGradient%3E%3ClinearGradient id='sB' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%23DEDEDE'/%3E%3Cstop offset='100%25' stop-color='%239E9E9E'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='256' cy='242' r='180' fill='%23FFEB3B' opacity='0.15'/%3E%3Ccircle cx='256' cy='242' r='130' fill='%23FFEB3B' opacity='0.25'/%3E%3Cline x1='256' y1='140' x2='256' y2='104' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='326' y1='172' x2='351' y2='147' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='358' y1='242' x2='394' y2='242' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='326' y1='312' x2='351' y2='337' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='186' y1='312' x2='161' y2='337' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='154' y1='242' x2='118' y2='242' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='186' y1='172' x2='161' y2='147' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cpath d='M 164,285 A 94,94 0 1,1 348,285 Q 345,342 312,350 L 200,350 Q 167,342 164,285 Z' fill='url(%23bulbG)'/%3E%3Cellipse cx='214' cy='192' rx='18' ry='37' fill='white' opacity='0.38' transform='rotate(-22,214,192)'/%3E%3Cellipse cx='206' cy='183' rx='8' ry='15' fill='white' opacity='0.55' transform='rotate(-22,206,183)'/%3E%3Ctext x='256' y='270' text-anchor='middle' dominant-baseline='central' font-family='Georgia, serif' font-size='114' font-weight='700' fill='%231A237E'%3E?%3C/text%3E%3Crect x='198' y='350' width='116' height='15' rx='3' fill='url(%23sA)'/%3E%3Crect x='205' y='365' width='102' height='13' rx='3' fill='url(%23sB)'/%3E%3Crect x='213' y='378' width='86' height='13' rx='3' fill='url(%23sA)'/%3E%3Crect x='224' y='391' width='64' height='13' rx='7' fill='url(%23sB)'/%3E%3C/svg%3E">

<!-- \u2500\u2500 Markdown + KaTeX integration (mirrored from create-quiz) \u2500\u2500
           Math is PRE-RENDERED at generation time when window.katex is available
           in the app context (the KaTeX CSS below styles that pre-rendered HTML).
           The auto-render extension acts as a guaranteed client-side fallback:
           if pre-rendering was skipped (katex not yet loaded in the app), the
           $\u2026$ delimiters survive in the HTML and auto-render picks them up here.
           No defer/async on katex.min.js \u2014 it must be synchronous so auto-render
           can reference window.katex immediately. Pinned to 0.16.9. No SRI. -->
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
      <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
      <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
      <script>
        document.addEventListener("DOMContentLoaded", function () {
          if (typeof renderMathInElement === "function") {
            renderMathInElement(document.body, {
              delimiters: [
                { left: "$$", right: "$$", display: true  },
                { left: "$",  right: "$",  display: false }
              ],
              throwOnError: false,
              // Skip nodes that already contain rendered KaTeX so we don't
              // double-process text that was successfully pre-rendered at
              // export time.
              ignoredClasses: ["katex", "katex-html"]
            });
          }
        });
      <\/script>

      <script type="module">
        const ICON_COPY = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>\`;
        const ICON_CHECK = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>\`;

        window.copyCodeBlock = (btn) => {
          const wrapper = btn.closest(".code-block-wrapper");
          if (!wrapper) return;
          const codeEl = wrapper.querySelector("code");
          if (!codeEl) return;

          navigator.clipboard
            .writeText(codeEl.innerText)
            .then(() => {
              const original = btn.innerHTML;
              btn.innerHTML = ICON_CHECK;
              btn.classList.add("copied");
              btn.setAttribute("aria-label", "Copied!");
              setTimeout(() => {
                btn.innerHTML = original;
                btn.classList.remove("copied");
                btn.setAttribute("aria-label", "Copy code");
              }, 2000);
            })
            .catch(() => {
              // Fallback: select the text so the user can Ctrl+C manually
              const range = document.createRange();
              range.selectNodeContents(codeEl);
              const sel = window.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
              }
            });
        };
      <\/script>

      <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #e0e0e0; background: #121212; }
          h1 { color: #ffffff; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 30px; text-align: center; }
          .meta { text-align: center; color: #888; margin-bottom: 40px; font-style: italic; }
          .question-card { background: #1e1e1e; border-radius: 12px; padding: 25px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid #333; }
          .q-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 0.9rem; color: #aaa; }
          .q-text { font-size: 1.1rem; font-weight: 600; color: #fff; margin-bottom: 20px; }
          .options-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
          .option { padding: 10px 15px; margin-bottom: 8px; border-radius: 6px; background: rgba(255,255,255,0.05); font-size: 0.95rem; }
          .user-answer { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid #3b82f6; font-weight: 600; margin-top: 15px; padding: 12px 15px; border-radius: 8px; }
          .user-answer.wrong { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
          .user-answer.skipped { background: rgba(156, 163, 175, 0.2); color: #9ca3af; border: 1px solid #6b7280; }
          .correct-answer { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; font-weight: 600; margin-top: 15px; padding: 12px 15px; border-radius: 8px; }
          .explanation { margin-top: 15px; padding: 15px; background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; color: #dbeafe; font-size: 0.95rem; }
          .essay-box { background: #2a2a2a; padding: 15px; border-radius: 8px; border-left: 3px solid #f59e0b; margin-top: 10px; }
          .essay-score { padding: 12px 15px; border-radius: 8px; font-size: 0.9rem; margin-top: 10px; border-left: 3px solid; font-weight: 600; }
          .essay-score.correct { background: rgba(16,185,129,0.15); border-color: #10b981; color: #34d399; }
          .essay-score.partial { background: rgba(245,158,11,0.15); border-color: #f59e0b; color: #fcd34d; }
          .essay-score.wrong   { background: rgba(239,68,68,0.15);  border-color: #ef4444; color: #f87171; }
          .question-image { max-width: 100%; height: auto; display: block; margin: 10px auto; border-radius: 8px; border: 1px solid #333; }
          /* \u2500\u2500 Question media (audio / video / YouTube) \u2500\u2500
             On screen: real <audio>/<video> controls, or a linked
             thumbnail (YouTube) with a centered play badge. The print
             fallback link is hidden on screen (interactive controls
             already cover that need) and only shown via @media print
             below, since <audio>/<video> controls don't print. */
          .question-media-container { margin: 10px 0 20px; }
          .question-audio-container .question-audio,
          .question-video-container .question-video { width: 100%; max-width: 100%; border-radius: 8px; display: block; background: #000; }
          .question-video-thumb-link { position: relative; display: block; max-width: 100%; width: fit-content; margin: 0 auto; border-radius: 8px; overflow: hidden; line-height: 0; }
          .question-video-thumb { display: block; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #333; }
          .question-video-play-badge { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 56px; height: 56px; border-radius: 50%; background: rgba(0,0,0,0.65); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; line-height: 1; pointer-events: none; }
          .question-media-print-link { display: none; }
          .footer { text-align: center; margin-top: 50px; color: #888; font-size: 0.8rem; border-top: 1px solid #333; padding-top: 20px; }
          .code-block { background: #0d0d0d; border: 1px solid #444; border-radius: 8px; padding: 12px 16px; margin: 10px 0; overflow-x: auto; font-family: "SF Mono", "Fira Code", Consolas, monospace; font-size: 0.88rem; line-height: 1.6; white-space: pre; text-align: left; direction: ltr; }
          .code-block code { background: none; padding: 0; color: #e2e8f0; font-size: inherit; }
          .inline-code { font-family: "SF Mono", "Fira Code", Consolas, monospace; font-size: 0.88em; background: rgba(99,102,241,0.15); border: 1px solid #555; border-radius: 4px; padding: 1px 6px; color: #a5b4fc; white-space: nowrap; }
          .score-block { text-align: center; margin: 0 0 40px; padding: 36px 28px 32px; background: #1e1e1e; border-radius: 16px; border: 1px solid #333; }
          .score-circle { width: 130px; height: 130px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 800; color: #fff; position: relative; letter-spacing: -1px; }
          .score-circle::after { content: ''; position: absolute; inset: -7px; border-radius: 50%; border: 3px solid currentColor; opacity: 0.28; }
          .score-circle.pass { background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 8px 32px rgba(16,185,129,0.4); color: #fff; }
          .score-circle.fail { background: linear-gradient(135deg, #f87171, #dc2626); box-shadow: 0 8px 32px rgba(239,68,68,0.4); color: #fff; }
          .score-label { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 22px; }
          /* \u2500\u2500 Results Detail Table (mirrors export-to-quiz results-detail) \u2500\u2500 */
          .results-detail { max-width: 380px; margin: 0 auto; background: rgba(255,255,255,0.04); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); text-align: left; overflow: hidden; }
          .rd-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 18px; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
          .rd-last { border-bottom: none; }
          .rd-label { color: #94a3b8; font-weight: 500; white-space: nowrap; }
          .rd-value { color: #e2e8f0; font-weight: 600; text-align: right; }
          .rd-highlight { background: rgba(102,126,234,0.12); }
          .rd-highlight .rd-label { color: #a5b4fc; }
          .rd-highlight .rd-value { color: #c4b5fd; font-size: 15px; }
          .rd-pass { color: #34d399 !important; }
          .rd-fail { color: #f87171 !important; }
          .stars { color: #f59e0b; font-size: 1.05em; letter-spacing: 1px; }
          /* \u2500\u2500 Option Buttons \u2500\u2500 */
          .options-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
          .option { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1.5px solid rgba(255,255,255,0.08); font-size: 0.95rem; color: #c8d3e0; transition: background 0.15s, border-color 0.15s; }
          .option-letter { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; min-width: 28px; border-radius: 50%; background: rgba(255,255,255,0.1); color: #94a3b8; font-weight: 700; font-size: 12px; flex-shrink: 0; }
          .ltr { direction: ltr; }
          /* \u2500\u2500 Markdown CSS Variables Mapping \u2500\u2500 */
          :root {
            --color-primary: #3b82f6;
            --color-primary-light: rgba(59, 130, 246, 0.1);
            --color-border: #333;
            --color-border-light: #444;
            --color-text-primary: #fff;
            --color-text-secondary: #aaa;
            --color-background: #121212;
            --color-background-secondary: #1e1e1e;
            --color-success: #22c55e;
            --color-error: #ef4444;
            --color-code: #e2e8f0;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
            --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
          }
          ${I}
          /* \u2500\u2500 Print rules for question media \u2500\u2500
             <audio>/<video> controls render as an empty gray box on
             paper, so hide them in print and show the plain-text
             fallback link instead. The YouTube thumbnail is a real
             <img> either way, so it stays visible on screen AND print. */
          @media print {
            .question-audio-container .question-audio,
            .question-video-container .question-video { display: none !important; }
            .question-media-print-link { display: block !important; }
          }
          </style>
  </head>
  <body>
      <h1>${l.title||"Quiz Examination"}</h1>
      <div class="meta">Total Questions: ${p.length} \u2022 Type: ${n} \u2022 Date: ${$}</div>
  `,v=c&&m&&(Array.isArray(m)?m.length>0:Object.keys(m).length>0),k=[];if(v&&t){let{mcqCorrect:e,mcqWrong:w,mcqSkipped:f,mcqTotal:d,essayCount:F,essayScoreTotal:a,essayMaxTotal:o,isEssayOnly:E,percentage:M,actualPercentage:s}=Q(p,m),B=e+a,z=d+o,C=s!==void 0?s:M,u=C>=70,P=u?"pass":"fail",R=u?"\u{1F389} Great Job!":"\u{1F4DA} Keep Practicing!",H=d>0,L=F>0,T="";if(H&&L){let q="\u2605".repeat(Math.round(a/o*5))+"\u2606".repeat(5-Math.round(a/o*5));T+=`
        <div class="rd-row"><span class="rd-label">Total Score</span><span class="rd-value">${B} / ${z} pts</span></div>
        <div class="rd-row"><span class="rd-label">MCQ</span><span class="rd-value">${e} / ${d} correct</span></div>
        <div class="rd-row"><span class="rd-label">Essays</span><span class="rd-value">${a} / ${o} pts &nbsp;<span class="stars">${q}</span></span></div>
        <div class="rd-row"><span class="rd-label">MCQ Score</span><span class="rd-value">${d>0?Math.round(e/d*100):0}%</span></div>`}else if(L){let q="\u2605".repeat(Math.round(a/o*5))+"\u2606".repeat(5-Math.round(a/o*5));T+=`
        <div class="rd-row"><span class="rd-label">Essay Score</span><span class="rd-value">${a} / ${o} pts</span></div>
        <div class="rd-row"><span class="rd-label">Rating</span><span class="rd-value stars">${q}</span></div>`}else T+=`
        <div class="rd-row"><span class="rd-label">Score</span><span class="rd-value">${e} / ${d} correct</span></div>
        <div class="rd-row"><span class="rd-label">Wrong</span><span class="rd-value">${w}</span></div>
        <div class="rd-row"><span class="rd-label">Skipped</span><span class="rd-value">${f}</span></div>`;T+=`
      <div class="rd-row rd-highlight"><span class="rd-label">Overall Score</span><span class="rd-value">${C}%</span></div>
      <div class="rd-row"><span class="rd-label">Status</span><span class="rd-value ${u?"rd-pass":"rd-fail"}">${u?"\u2713 Passed":"\u2717 Not Passed"}</span></div>
      <div class="rd-row rd-last"><span class="rd-label">Questions</span><span class="rd-value">${d+F} total</span></div>`,r+=`
    <div class="score-block">
      <div class="score-circle ${P}">${C}%</div>
      <div class="score-label">${R}</div>
      <div class="results-detail">
        ${T}
      </div>
    </div>`}return p.forEach((e,w)=>{let f=m[w],d=f==null,F=!d&&!S(e)&&(Array.isArray(e.correct)?e.correct.includes(f):f===e.correct);if(r+=`
      <div class="question-card">
          <div class="q-header">
              <span>Question ${w+1}</span>
              <span>${S(e)?"Essay":"MCQ"}</span>
          </div>
          <div class="q-text">${b(e.q)}</div>`,S(e)){let a=f||"";if(v){let o=j(a,e.answer),E="\u2605".repeat(o)+"\u2606".repeat(5-o),M=o>=3?"correct":o>=1?"partial":"wrong";r+=`
          <div class="essay-box" style="border-left: 3px solid #3b82f6;">
              <strong style="color: #60a5fa; display:block; margin-bottom:5px;">Your Answer:</strong>
              ${b(a||"\u0644\u0645 \u062A\u064F\u062C\u0650\u0628")}
          </div>
          <div class="essay-score ${M}">
            Score: ${o}/5 &nbsp;<span style="font-size:1.1em;color:#f59e0b">${E}</span>
          </div>`}if(t){let o=`<div class="essay-box">
              <strong style="color: #f59e0b; display:block; margin-bottom:5px;">Formal Answer / Key Points:</strong>
              ${b(e.answer)}
          </div>`;i==="final-page"?k.push({index:w,html:o}):r+=o}}else if(!Array.isArray(e.options)||e.options.length===0)if(t&&e.answer){let a=`<div class="essay-box">
              <strong style="color: #f59e0b; display:block; margin-bottom:5px;">Answer:</strong>
              ${b(e.answer)}
          </div>`;i==="final-page"?k.push({index:w,html:a}):r+=a}else r+=`<div class="essay-box" style="opacity:0.7;">
              <em>No answer options available for this question.</em>
          </div>`;else{r+='<div class="options-list">',e.options.forEach((s,B)=>{let z=String.fromCharCode(65+B);r+=`<div class="option"><span class="option-letter">${z}</span><span>${b(s)}</span></div>`}),r+="</div>";let a=d?"skipped":F?"":"wrong",o=d?[]:Array.isArray(f)?f:[f],E=d?"Skipped":o.filter(s=>Number.isInteger(s)&&e.options[s]!==void 0).map(s=>`${String.fromCharCode(65+s)}. ${b(e.options[s])}`).join("; ");if(v&&(r+=`<div class="user-answer ${a}">${d?"\u26AA":F?"\u2705":"\u274C"} Your Answer: ${E}</div>`),t){let s=e.correct??e.answer,C=`<div class="correct-answer">\u2713 Correct Answer: ${(Array.isArray(s)?s:[s]).filter(u=>Number.isInteger(u)&&e.options[u]!==void 0).map(u=>`${String.fromCharCode(65+u)}. ${b(e.options[u])}`).join("; ")}</div>`;i==="final-page"?k.push({index:w,html:C}):r+=C}}if(y&&e.explanation){let a=`<div class="explanation"><strong>\u{1F4A1} Explanation:</strong> ${b(e.explanation)}</div>`,o=k.find(E=>E.index===w);i==="final-page"&&o?o.html+=a:r+=a}r+="</div>"}),t&&i==="final-page"&&k.length&&(r+="<h1>\u{1F511} Answer Key</h1>",k.forEach(e=>{r+=`<div class="question-card"><div class="q-header"><span>Question ${e.index+1}</span></div>${e.html}</div>`})),r+='<div class="footer">Generated by Quiz App</div></body></html>',r}var K=(l="light")=>`
@media print {
  @page { size: A4; margin: 14mm 12mm; }

  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  html, body {
    background: ${l==="dark"?"#0a0a0a":"#ffffff"} !important;
    ${l==="dark"?"":"color: #1a1a1a !important;"}
    width: auto;
    max-width: none;    
    margin: 0 !important;
    padding: 0 !important;
  }
  ${l==="dark"?"":`
  :root {
    --color-primary: #3b82f6 !important;
    --color-primary-light: rgba(59, 130, 246, 0.12) !important;
    --color-border: #ddd !important;
    --color-border-light: #ccc !important;
    --color-text-primary: #1a1a1a !important;
    --color-text-secondary: #555 !important;
    --color-background: #ffffff !important;
    --color-background-secondary: #f4f4f5 !important;
    --color-success: #16a34a !important;
    --color-error: #dc2626 !important;
    --color-code: #1a1a1a !important;
  }

  html { color-scheme: light; }

  .question-card { background: #f8f9fa !important; border-color: #ddd !important; }
  .q-header, .rd-label { color: #555 !important; }
  .q-text, h1, .score-label, .rd-value { color: #1a1a1a !important; }
  .option { background: #f0f1f3 !important; color: #1a1a1a !important; border-color: #ddd !important; }
  .option-letter { background: #e2e4e8 !important; color: #444 !important; }
  .code-block { background: #f4f4f5 !important; border-color: #ccc !important; }
  .code-block code { color: #1a1a1a !important; }
  .code-block-wrapper { background: #f4f4f5 !important; border-color: #ccc !important; box-shadow: none !important; }
  .inline-code { background: #eef0f4 !important; border-color: #ccc !important; color: #b91c1c !important; }
  .math-raw { background: #f4f4f5 !important; border-color: #ccc !important; color: #1a1a1a !important; }
  .md-blockquote { background: #f4f4f5 !important; color: #333 !important; }
  .user-answer, .user-answer.wrong, .user-answer.skipped { color: #1a1a1a !important; }
  .correct-answer { color: #1a1a1a !important; }
  .explanation { color: #1a1a1a !important; }
  .essay-box { background: #f0f1f3 !important; }
  .essay-score.correct { background: rgba(16,185,129,0.12) !important; color: #047857 !important; }
  .essay-score.partial { background: rgba(245,158,11,0.12) !important; color: #b45309 !important; }
  .essay-score.wrong   { background: rgba(239,68,68,0.12) !important;  color: #b91c1c !important; }
  .score-block { background: #f8f9fa !important; border-color: #ddd !important; }
  .results-detail { background: #f4f4f5 !important; border-color: #ddd !important; }
  .rd-row { border-bottom-color: #e2e4e8 !important; }
  .rd-value { color: #1a1a1a !important; }
  .rd-highlight { background: rgba(59,130,246,0.08) !important; }
  .rd-highlight .rd-label, .rd-highlight .rd-value { color: #1d4ed8 !important; }
  .meta, .footer { color: #666 !important; }
  .footer { border-top-color: #ddd !important; }
  `}

  /* \u2500\u2500 Code blocks: never clip, never force a horizontal scrollbar \u2500\u2500
     On screen these rely on overflow/scroll \u2014 the printed page has no
     scroll surface, so we let them grow to full height and wrap long
     lines instead of cutting them off or relying on a scrollbar. */
  .code-block-wrapper {
    max-height: none !important;
    overflow: visible !important;
    break-inside: avoid;
  }
  .code-block {
    overflow: visible !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
  }
  .code-block code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
  }
  .inline-code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
  }

  /* GFM tables: same story \u2014 let them wrap/shrink instead of scrolling */
  .md-table-wrapper { overflow-x: visible !important; }
  table { table-layout: fixed; width: 100%; }
  table td, table th {
    white-space: normal !important;
    word-break: break-word !important;
  }

  /* KaTeX: allow display-mode equations to wrap rather than overflow
     the page width if a single expression is wider than the margin. */
  .katex-display { overflow-x: visible !important; white-space: normal !important; }
  .katex-display > .katex { white-space: normal !important; }

  /* Never split a question card across a page boundary if it can
     reasonably fit on one page; if it can't, allow the break rather
     than shrinking/clipping content. Spacing is tightened vs. the
     on-screen version (which uses generous padding/margins meant for
     mouse/touch interaction) specifically so two short questions
     (True/False, short MCQ) can share a page instead of each one
     nearly filling a page on its own. */
  .question-card {
    break-inside: avoid-page;
    page-break-inside: avoid;
    padding: 12px 14px !important;
    margin-bottom: 10px !important;
  }
  .q-header { margin-bottom: 8px !important; }
  .q-text { margin-bottom: 10px !important; }
  .options-list { gap: 5px !important; margin-bottom: 10px !important; }
  .option { padding: 6px 10px !important; margin-bottom: 0 !important; }
  .user-answer, .correct-answer { margin-top: 8px !important; padding: 8px 10px !important; }
  .explanation { margin-top: 8px !important; padding: 8px 10px !important; }
  .score-block { break-inside: avoid-page; }

  /* Copy-code buttons and other purely-interactive chrome are
     meaningless on paper. */
  .copy-code-btn { display: none !important; }

  /* Avoid an empty trailing page/hairline caused by margin collapse
     on the last element. */
  .footer { break-inside: avoid; }
}
`;function G(l,p){return new Promise((m,A)=>{let t=document.createElement("iframe");t.setAttribute("aria-hidden","true"),t.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;",document.body.appendChild(t);let c=!1,y=!1,i=()=>{setTimeout(()=>{t.parentNode&&t.parentNode.removeChild(t)},1e3)},g=n=>{c||(c=!0,i(),A(n))},h=()=>{c||(c=!0,m())},x=()=>{if(!y){y=!0;try{let n=t.contentWindow;n.document.title!==p&&(n.document.title=p),n.addEventListener("afterprint",i,{once:!0}),n.focus(),n.print(),h(),setTimeout(i,6e4)}catch(n){g(n)}}};t.onerror=()=>g(new Error("Failed to load print document")),t.onload=()=>{let n=t.contentDocument||t.contentWindow.document;if(!/\bkatex\b/i.test(l)){requestAnimationFrame(()=>requestAnimationFrame(x));return}let r=Date.now()+3e3,v=()=>{n.querySelector(".katex")||Date.now()>r?requestAnimationFrame(()=>requestAnimationFrame(x)):setTimeout(v,100)};v()},t.srcdoc=l})}async function ee(l,p,m=[],A={},t=null,c={}){let y=c.backgroundColor==="dark"?"dark":"light";try{if(!l||!p||!Array.isArray(p))throw new Error("Invalid parameters: config and questions array required");typeof t=="function"&&t(10);let i=await N(l,p,m,{includeAnswers:c.includeAnswers,includeUserAnswers:c.includeUserAnswers,includeExplanations:c.includeExplanations,answerPlacement:c.answerPlacement});typeof t=="function"&&t(40);let g=K(y),h=i.includes("</head>")?i.replace("</head>",`<style>${g}</style></head>`):i+`<style>${g}</style>`;y==="light"&&(h=h.replace(/<html([^>]*)>/,(n,$)=>/data-theme=/.test($)?n.replace(/data-theme="[^"]*"/,'data-theme="light"'):`<html${$} data-theme="light">`));let x=(l.title||"quiz").trim()||"quiz";return typeof t=="function"&&t(60),await G(h,x),typeof t=="function"&&t(100),D("\u062C\u0627\u0647\u0632 \u0644\u0644\u062D\u0641\u0638 \u0643\u0640 PDF",'\u0627\u062E\u062A\u0631 "\u062D\u0641\u0638 \u0643\u0640 PDF" \u0645\u0646 \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629',"./assets/images/PDF_Icon.png"),{success:!0}}catch(i){return console.error("PDF Export Error:",i),D("\u0641\u0634\u0644 \u062A\u0635\u062F\u064A\u0631 PDF",`${i.message}`,"error"),{success:!1,error:i.message}}}export{ee as exportToPdf};
