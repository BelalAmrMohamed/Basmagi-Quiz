import{a as S}from"./chunk-CLCAKNBK.js";import{a as f}from"./chunk-JOVBCH5E.js";var B=new Set;function O(r,e){return B.has(`${r}-${e}`)}var R=!1;function _(){if(R)return;document.body.insertAdjacentHTML("beforeend",`
    <div id="reportQuestionOverlay" class="report-modal-overlay">
      <div class="report-modal-card">
        <div class="report-modal-header">
          <h3>\u0627\u0644\u0625\u0628\u0644\u0627\u063A \u0639\u0646 \u0633\u0624\u0627\u0644</h3>
          <button type="button" class="report-close-btn" id="reportCloseBtn" aria-label="\u0625\u063A\u0644\u0627\u0642">&times;</button>
        </div>
        <div class="report-question-preview" id="reportQuestionText"></div>
        <form id="reportQuestionForm" class="report-reasons-form">
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="\u0625\u062C\u0627\u0628\u0629 \u062E\u0627\u0637\u0626\u0629" required>
            <span>\u0625\u062C\u0627\u0628\u0629 \u062E\u0627\u0637\u0626\u0629</span>
          </label>
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="\u0627\u0644\u0633\u0624\u0627\u0644 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D">
            <span>\u0627\u0644\u0633\u0624\u0627\u0644 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D</span>
          </label>
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="\u062E\u0637\u0623 \u0625\u0645\u0644\u0627\u0626\u064A/\u0644\u063A\u0648\u064A">
            <span>\u062E\u0637\u0623 \u0625\u0645\u0644\u0627\u0626\u064A/\u0644\u063A\u0648\u064A</span>
          </label>
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="\u0623\u062E\u0631\u0649">
            <span>\u0623\u062E\u0631\u0649</span>
          </label>
          <textarea 
            id="reportReasonOther" 
            class="report-reason-other-input" 
            placeholder="\u064A\u0631\u062C\u0649 \u062A\u0648\u0636\u064A\u062D \u0627\u0644\u0633\u0628\u0628..."
          ></textarea>
          
          <div class="report-modal-actions">
            <button type="submit" class="report-btn-submit" id="reportSubmitBtn">\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A</button>
          </div>
        </form>
      </div>
    </div>
  `);let e=document.createElement("link");e.rel="stylesheet",e.href="/src/components/report-question/report-question.css",document.head.appendChild(e),R=!0;let s=document.getElementById("reportQuestionOverlay"),i=document.getElementById("reportQuestionForm"),l=i.querySelectorAll('input[name="reportReason"]'),t=document.getElementById("reportReasonOther");l.forEach(o=>{o.addEventListener("change",b=>{b.target.value==="\u0623\u062E\u0631\u0649"?(t.classList.add("show"),t.required=!0):(t.classList.remove("show"),t.required=!1,t.value="")})});let c=()=>{s.classList.remove("show"),i.reset(),t.classList.remove("show"),t.required=!1};document.getElementById("reportCloseBtn").addEventListener("click",c),s.addEventListener("click",o=>{o.target===s&&c()})}function C({quizId:r,questionIndex:e,questionText:s,quizTitle:i,onSuccess:l}){if(_(),O(r,e)){f("\u0644\u0642\u062F \u0642\u0645\u062A \u0628\u0627\u0644\u0625\u0628\u0644\u0627\u063A \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0633\u0624\u0627\u0644 \u0645\u0633\u0628\u0642\u0627\u064B.",!0);return}let t=document.getElementById("reportQuestionOverlay"),c=document.getElementById("reportQuestionText"),o=document.getElementById("reportQuestionForm"),b=document.getElementById("reportSubmitBtn");c.textContent=s||"\u0633\u0624\u0627\u0644 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631";let n=o.cloneNode(!0);o.parentNode.replaceChild(n,o);let L=n.querySelectorAll('input[name="reportReason"]'),a=n.querySelector("#reportReasonOther");L.forEach(h=>{h.addEventListener("change",d=>{d.target.value==="\u0623\u062E\u0631\u0649"?(a.classList.add("show"),a.required=!0):(a.classList.remove("show"),a.required=!1,a.value="")})}),n.addEventListener("submit",async h=>{h.preventDefault();let d=n.querySelector('input[name="reportReason"]:checked')?.value,p=d;if(d==="\u0623\u062E\u0631\u0649"&&(p=a.value.trim()),!p)return;let u=n.querySelector("#reportSubmitBtn");u.disabled=!0,u.textContent="\u062C\u0627\u0631\u064A \u0627\u0644\u0625\u0631\u0633\u0627\u0644...";try{let m=await fetch(S("/api/reports"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"submit",quiz_id:r,question_index:e,reason:p})}),v=await m.json();if(!m.ok)throw new Error(v.error||"\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A");B.add(`${r}-${e}`);try{let y="user_reported_questions",g=JSON.parse(localStorage.getItem(y)||"[]"),w={id:v.report?.id||crypto.randomUUID?.()||Date.now().toString(),quiz_id:r,quiz_title:i||document.title.replace(" | \u0645\u0646\u0635\u0629 \u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A \u0628\u0635\u0645\u062C\u064A","").trim()||"\u0627\u0645\u062A\u062D\u0627\u0646",question_index:e,question_text:s||`\u0633\u0624\u0627\u0644 \u0631\u0642\u0645 ${e+1}`,reason:p,status:"pending",created_at:v.report?.created_at||new Date().toISOString()},E=Array.isArray(g)?g.filter(q=>q.id!==w.id):[];E.unshift(w),localStorage.setItem(y,JSON.stringify(E.slice(0,100)))}catch(y){console.error("Failed to save report in local storage:",y)}f("\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A \u0628\u0646\u062C\u0627\u062D. \u0634\u0643\u0631\u0627\u064B \u0644\u0643!"),t.classList.remove("show"),typeof l=="function"&&l(v.report)}catch(m){f(m.message,!0)}finally{u.disabled=!1,u.textContent="\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A"}}),t.classList.add("show")}export{O as a,C as b};
