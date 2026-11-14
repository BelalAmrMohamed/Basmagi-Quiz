import{e as h,eb as b,fb as y,ib as f,kb as w,lb as g}from"./chunk-RKFUX3HF.js";import"./chunk-YTMW4EYE.js";import"./chunk-TY4IRM2T.js";import"./chunk-ITLITX43.js";import"./chunk-TPTFNNOW.js";import"./chunk-HN6VQYXH.js";import"./chunk-EAL4DV4Y.js";import"./chunk-UKZDYRC2.js";import"./chunk-462JEEEU.js";import"./chunk-TCOY2X2A.js";import"./chunk-DYUFL6VY.js";import"./chunk-NWYXRHMS.js";import"./chunk-Y3KV3XY7.js";import"./chunk-V6OF7QVK.js";import"./chunk-U6VANYCL.js";import"./chunk-DVJ4WUR2.js";import"./chunk-7ZQ3NH37.js";import"./chunk-LNWQOYBS.js";import"./chunk-EA4QC63W.js";import"./chunk-SE5UACGI.js";import"./chunk-PXIY52WZ.js";import"./chunk-VEBKJG2P.js";import"./chunk-J5BBYOFQ.js";import"./chunk-Y4RQGV5F.js";import"./chunk-JOKKAVSN.js";import"./chunk-CI6AM5G6.js";import"./chunk-DNOIYVEK.js";import"./chunk-7PDTGCXS.js";import{a as p,b as m}from"./chunk-NICZD2J2.js";import"./chunk-CLCAKNBK.js";import"./chunk-HFOYQOFP.js";import"./chunk-G32INTHD.js";import"./chunk-MWWP4IBT.js";import"./chunk-UN5AHGNC.js";import"./chunk-FS3RLBBG.js";import"./chunk-PY4V6ACG.js";import{a as n}from"./chunk-JOVBCH5E.js";var L=`Create a complete lesson as valid JSON. Write the lesson in the language requested by the user or the language of the requested lesson; if no language is specified, use the language of the request.

Use this exact structure:
\`\`\`json
{
  "title": "Lesson title",
  "description": "Short optional description",
  "source": "https://... (Direct URL or link to the source lecture/drive/book; must be a link whenever available)",
  "sections": [
    {
      "title": "Section title",
      "blocks": [
        { "type": "markdown", "body": "Lesson content in Markdown..." },
        {
          "type": "question",
          "questionKind": "mcq",
          "prompt": "Question text",
          "options": ["Option A", "Option B", "Option C"],
          "correctIndex": 1,
          "multiSelect": false,
          "explanation": "Why the answer is correct"
        },
        {
          "type": "question",
          "questionKind": "essay",
          "prompt": "Essay question",
          "modelAnswer": "A complete model answer",
          "explanation": "Optional guidance"
        }
      ]
    }
  ]
}
\`\`\`
Create multiple logically ordered sections as needed. Each section may contain multiple Markdown blocks and embedded interactive questions. For single-answer MCQs use one zero-based correctIndex; for multiple-answer MCQs use "multiSelect": true and a zero-based "correctIndexes" array instead. Every MCQ must have 2-8 options, a correct answer, and a useful explanation. Every essay question must include a complete modelAnswer (Students Answers will be rated based on it using keyword matching). The "source" MUST be a direct link/URL (e.g. Google Drive link to lecture slides or PDF). Math: Every formula, variable, exponent, fraction, root, Greek letter or math symbol anywhere in the lesson (Markdown bodies, prompts, options, modelAnswer, explanation) must be LaTeX: $...$ inline, $$...$$ display. Never plain text (x^2, sqrt(x), 1/2, x\xB2, \u221A, \u2264). Escape backslashes in JSON (\\\\frac). Never put a sentence or note in "source" (only a link, or an empty string). A section may contain at most 40 blocks; split longer sections. lesson-reference blocks need the UUID of a published lesson. Keep the lesson accurate, clear, appropriately detailed, and useful for studying. Return valid JSON.`;function M(){if(!document.getElementById("modal-pop-in-style")){let s=document.createElement("style");s.id="modal-pop-in-style",s.textContent=`
      @keyframes modalPopIn {
        to { transform: translateY(0); opacity: 1; }
      }
    `,document.head.appendChild(s)}let e=document.createElement("div");e.className="modal-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-labelledby","inlineCreateLessonTitle"),e.style.cssText=`
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(0, 0, 0, 0.6);
  `;let o=document.createElement("div");o.className="modal-card create-quiz-inline-modal",o.innerHTML=`
    <div class="create-quiz-modal__header">
      <h2 id="inlineCreateLessonTitle" class="create-quiz-modal__title">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>
        \u0625\u0646\u0634\u0627\u0621 \u062F\u0631\u0633 \u062C\u062F\u064A\u062F
      </h2>
      <button type="button" id="inlineLessonPrompt" class="create-quiz-modal__copy-prompt-btn" aria-label="\u0646\u0633\u062E \u0628\u0631\u0648\u0645\u0628\u062A \u0625\u0646\u0634\u0627\u0621 \u062F\u0631\u0633">Prompt</button>
      <button type="button" id="inlineLessonClose" class="create-quiz-modal__close-btn" aria-label="\u0625\u063A\u0644\u0627\u0642">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <p class="create-quiz-modal__subtitle">\u0627\u0644\u0635\u0642 JSON \u0644\u0644\u062F\u0631\u0633 \u0643\u0627\u0645\u0644\u0627\u064B\u060C \u0628\u0645\u0627 \u064A\u0634\u0645\u0644 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0648\u0627\u0644\u0623\u0642\u0633\u0627\u0645 \u0648\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0645\u062F\u0645\u062C\u0629.</p>
    <div class="create-quiz-modal__form-group create-quiz-modal__form-group--content">
      <label for="inlineLessonJson" class="create-quiz-modal__label">JSON \u0627\u0644\u062F\u0631\u0633</label>
      <textarea id="inlineLessonJson" class="create-quiz-modal__textarea" rows="11" spellcheck="false" dir="ltr" placeholder='{"title":"...","description":"...","source":"https://...","sections":[{"title":"...","blocks":[{"type":"markdown","body":"..."}]}]}'></textarea>
    </div>
    <div class="create-quiz-modal__actions">
      <div class="create-quiz-modal__main-actions">
        <button type="button" id="inlineLessonCreate" class="inline-quiz-btn create-quiz-modal__btn create-quiz-modal__btn--create">\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062F\u0631\u0633 \u2728</button>
      </div>
    </div>
  `,e.appendChild(o),document.body.appendChild(e);let i=o.querySelector("#inlineLessonJson"),c=b(e,()=>y(e,o),{dismissOnBackdrop:!1});o.querySelector("#inlineLessonClose").addEventListener("click",c),o.querySelector("#inlineLessonPrompt").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(L),n("\u062A\u0645 \u0646\u0633\u062E \u0627\u0644\u0628\u0631\u0648\u0645\u0628\u062A","\u0627\u0644\u0635\u0642\u0647 \u0641\u064A \u0623\u062F\u0627\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0644\u0643\u062A\u0627\u0628\u0629 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u062F\u0631\u0633.","success")}catch(s){console.error("[create-lesson-modal] clipboard copy failed:",s),n("\u062A\u0639\u0630\u0651\u0631 \u0646\u0633\u062E \u0627\u0644\u0628\u0631\u0648\u0645\u0628\u062A","\u0627\u0646\u0633\u062E \u0627\u0644\u0628\u0631\u0648\u0645\u0628\u062A \u064A\u062F\u0648\u064A\u0627\u064B \u0623\u0648 \u0627\u0633\u0645\u062D \u0644\u0644\u0645\u062A\u0635\u0641\u062D \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u062D\u0627\u0641\u0638\u0629.","error")}});let v=()=>{let s;try{s=h(JSON.parse(i.value))}catch(t){let l=t instanceof SyntaxError;l||console.error("[create-lesson-modal] invalid lesson JSON:",t),n(l?"JSON \u063A\u064A\u0631 \u0635\u0627\u0644\u062D":"\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062F\u0631\u0633 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629",l?"\u062A\u062D\u0642\u0642 \u0645\u0646 \u0635\u064A\u0627\u063A\u0629 JSON \u062B\u0645 \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.":t.userMessage||t.message,"warning"),i.focus();return}let{title:d,description:k,source:q,sections:u,questionCount:_}=s,r;try{let t=JSON.parse(p("user_quizzes","[]"));if(!Array.isArray(t))throw new Error("\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u062D\u062A\u0648\u0627\u064A \u0644\u064A\u0633\u062A \u0642\u0627\u0626\u0645\u0629 \u0635\u0627\u0644\u062D\u0629.");r=t}catch(t){console.error("[create-lesson-modal] workspace read failed:",t),n("\u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0645\u062D\u062A\u0648\u0627\u064A","\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629. \u0623\u0635\u0644\u062D \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u062B\u0645 \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B.","error");return}let a=w||null;if(g(r,{type:"lesson",title:d,parentId:a})){n("\u062A\u0639\u0630\u0651\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062F\u0631\u0633",a?"\u064A\u0648\u062C\u062F \u062F\u0631\u0633 \u0628\u0646\u0641\u0633 \u0627\u0644\u0627\u0633\u0645 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u062C\u0644\u062F \u0628\u0627\u0644\u0641\u0639\u0644. \u0627\u062E\u062A\u0631 \u0627\u0633\u0645\u0627\u064B \u0645\u062E\u062A\u0644\u0641\u0627\u064B.":"\u064A\u0648\u062C\u062F \u062F\u0631\u0633 \u0628\u0627\u0644\u0627\u0633\u0645 \u0646\u0641\u0633\u0647 \u0641\u064A \u0627\u0644\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0631\u0626\u064A\u0633\u064A \u0645\u0646 \u0645\u062D\u062A\u0648\u0627\u064A.","warning");return}let S=`user_lesson_${crypto.randomUUID()}`,x=new Date().toISOString();if(r.push({id:S,meta:{type:"lesson",title:d,parentId:a,createdAt:new Date().toLocaleString("en-US"),updatedAt:x,readerPrefs:{fontId:"default"},description:k,source:q,passwordProtected:!1},stats:{questionCount:_,sectionCount:u.length},lesson:{sections:u},passwordHash:null,questions:[]}),!m("user_quizzes",JSON.stringify(r))){n("\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0627\u0644\u062F\u0631\u0633","\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0627\u0644\u062F\u0631\u0633 \u0645\u062D\u0644\u064A\u0627\u064B. \u0642\u062F \u062A\u0643\u0648\u0646 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0645\u0645\u062A\u0644\u0626\u0629.","error");return}c(),f(),n("\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062F\u0631\u0633",a?"\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062F\u0631\u0633 \u0648\u0625\u0636\u0627\u0641\u062A\u0647 \u0625\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0645\u062C\u0644\u062F \u0628\u0646\u062C\u0627\u062D.":'\u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u064A\u0647 \u0641\u064A "\u0645\u062D\u062A\u0648\u0627\u064A".',"success")};o.querySelector("#inlineLessonCreate").addEventListener("click",v),setTimeout(()=>i.focus(),50)}export{M as openInlineCreateLessonModal};
