import{a as oe}from"../chunks/chunk-DXFN2KPZ.js";import{a as re,b as le}from"../chunks/chunk-KZ5FCJF3.js";import{b as _}from"../chunks/chunk-4PPAI2EM.js";import"../chunks/chunk-GOID3IY4.js";import{z as ee}from"../chunks/chunk-DVJ4WUR2.js";import{b as ne,h as ae}from"../chunks/chunk-7ZQ3NH37.js";import{c as ie}from"../chunks/chunk-LNWQOYBS.js";import{a as te}from"../chunks/chunk-VEBKJG2P.js";import{a as O,b as W,c as V,d as Q,e as G,f as Y}from"../chunks/chunk-J5BBYOFQ.js";import{b as K,g as Z,m as X}from"../chunks/chunk-Y4RQGV5F.js";import"../chunks/chunk-JOKKAVSN.js";import{b as se}from"../chunks/chunk-DNOIYVEK.js";import"../chunks/chunk-6TJQV4FV.js";import"../chunks/chunk-7PDTGCXS.js";import"../chunks/chunk-NICZD2J2.js";import"../chunks/chunk-CLCAKNBK.js";import{O as J,P as S}from"../chunks/chunk-HFOYQOFP.js";import"../chunks/chunk-I6GXFOIR.js";import"../chunks/chunk-L2WIPL4C.js";import"../chunks/chunk-G32INTHD.js";import"../chunks/chunk-MWWP4IBT.js";import"../chunks/chunk-TTDWA2H5.js";import"../chunks/chunk-FS3RLBBG.js";import"../chunks/chunk-PY4V6ACG.js";import{a as N}from"../chunks/chunk-JOVBCH5E.js";import"../chunks/chunk-HE6VJRPR.js";console.log("result.js loaded successfully");var j=localStorage.getItem("username")||"User",u=JSON.parse(localStorage.getItem("last_quiz_result"));u||(window.location.href="/");var R=u?.quizDbId||null,ce=t=>t.answer??"";var z=new URL("./",window.location.href).href,de=t=>t?`
    <div class="reading-passage" role="region" aria-label="Reading passage">
      ${S(t,{mediaBaseUrl:z})}
    </div>
  `:"",we=(t,c=5)=>`<span class="star-rating" aria-label="Score ${t} of ${c}">`+"\u2605".repeat(t)+`<span class="star-empty">${"\u2605".repeat(c-t)}</span></span>`;var ue=t=>{let c=t?.questionTypes;return c?Array.isArray(c)?c.length?c.join(" \xB7 "):null:String(c)||null:null};document.addEventListener("DOMContentLoaded",async()=>{let t=document.getElementById("scoreHeader"),c=document.getElementById("reviewContainer"),h=document.getElementById("openDownloadModalBtn"),a=_.getUserData().totalPoints;oe(_.calculateLevel(a));let d=document.getElementById("resultTotalPoints");d&&(d.textContent=`\u0625\u062C\u0645\u0627\u0644\u064A \u0646\u0642\u0627\u0637\u0643: ${a.toLocaleString()}`);let o={breadcrumb:document.getElementById("quizBreadcrumb"),dateBadge:document.getElementById("dateBadge"),quizInfoBtn:document.getElementById("quizInfoBtn"),quizInfoDialog:document.getElementById("quizInfoDialog"),quizInfoDialogClose:document.getElementById("quizInfoDialogClose"),quizInfoTable:document.getElementById("quizInfoTable")},e=[];try{e=(await se()).examList||[]}catch(n){console.error("Failed to load manifest",n)}let i=e.find(n=>n.id===u.examId);!R&&i?.dbId&&(R=i.dbId);let r=u.meta||{},s={id:u.examId,title:u.examTitle||r.title||i&&i.title||"User Quiz",description:u.description||r.description||i&&i.description||"Custom user-created quiz",source:u.source||r.source||i&&i.source||null,createdAt:u.createdAt||r.createdAt||i&&i.createdAt||null,dbId:R,author:u.author||r.author||i&&i.author||null,authorHandle:u.authorHandle||r.author_handle||i&&i.authorHandle||null,authorId:u.authorId||r.author_id||i&&i.authorId||null,path:r.path||i&&i.path||null,category:u.category||r.category||i&&i.category||null,view:u.view||r.view||i&&i.view||null,mode:u.mode||r.mode||i&&i.mode||null,questionTypes:u.questionTypes||r.questionTypes||i&&i.questionTypes||null};s.view||(s.view=u.view||null),s.mode||(s.mode=u.mode||null),s.questionTypes=ue({questionTypes:s.questionTypes})||ue({questionTypes:u.questionTypes})||null;let p=[];if(u.questions&&Array.isArray(u.questions)&&u.questions.length>0)p=u.questions;else if(s.dbId)try{let n=await te({dbId:s.dbId});p=n.questions||[],n.meta&&(n.meta.createdAt&&!s.createdAt&&(s.createdAt=n.meta.createdAt),n.meta.description&&!s.description&&(s.description=n.meta.description),n.meta.source&&!s.source&&(s.source=n.meta.source),n.meta.author&&!s.author&&(s.author=n.meta.author),n.meta.author_handle&&!s.authorHandle&&(s.authorHandle=n.meta.authorHandle),n.meta.author_id&&!s.authorId&&(s.authorId=n.meta.author_id))}catch(n){console.error("Failed to load questions",n)}else try{let w=JSON.parse(localStorage.getItem("user_quizzes")||"[]").find(B=>B.id===u.examId);w&&(p=w.questions||[],s.title=w.title||s.title,s.source=w.source||s.source,s.createdAt=w.createdAt||s.createdAt)}catch(n){console.error("Error loading user quiz questions",n)}document.title=`\u0646\u062A\u0627\u0626\u062C \u0627\u0645\u062A\u062D\u0627\u0646 ${s.title}`;let{mcqCorrect:l,mcqWrong:y,mcqSkipped:b,mcqTotal:k,essayCount:g,essayScoreTotal:m,essayMaxTotal:I,isEssayOnly:L,percentage:A,actualPercentage:v}=Y(p,u.userAnswers);h&&(h.onclick=()=>{ee({config:s,questions:p,userAnswers:u.userAnswers,resultMeta:u,filenameBase:s.title||"quiz"})});let C=30,M=u.examTitle,E=document.getElementById("quiz-title");if(E&&(E.textContent=M.length>C?`${M.substring(0,C)}...`:M,J(E.parentElement||E)),o.quizInfoDialog){s.category||(s.category=s.category||"");let n=s.authorId||s.authorHandle,w=null;if(n){let x=s.authorId?"id":"handle";w=await Z(n,x)}if(R){let x=await import("../chunks/info-details-2RUYTVG4.js").then($=>$.fetchQuizDetails(R)).catch(()=>null);x&&await import("../chunks/info-details-2RUYTVG4.js").then($=>$.applyQuizDetails(s,x))}o.quizInfoDialog.innerHTML=X(s,p.length,w),K(o.quizInfoDialog);let B=o.quizInfoDialog.querySelector(".quiz-info-dialog-close");B&&B.addEventListener("click",()=>o.quizInfoDialog.close())}o.quizInfoBtn&&o.quizInfoDialog&&o.quizInfoBtn.addEventListener("click",()=>{o.quizInfoDialog.showModal()}),o.quizInfoDialog?.addEventListener("click",n=>{n.target===o.quizInfoDialog&&o.quizInfoDialog.close()}),ye(t,u,A,v,L,l,y,b,k,g,m,I),fe(c,p,u.userAnswers),document.getElementById("scoreHeaderSkeleton")?.remove(),document.getElementById("reviewSkeleton")?.remove();{let n=(f,H)=>{if(f==null)return"\u2014";if(Array.isArray(f)){if(!f.length)return"\u2014";let P=f.map(T=>Array.isArray(H)?H[T]:void 0).filter(T=>T!==void 0);return P.length?P.join("\u060C "):"\u2014"}return Array.isArray(H)&&typeof f=="number"?H[f]??"\u2014":String(f)},w=p.map((f,H)=>{let P=u.userAnswers?.[H],T=O(f),U=Array.isArray(f.options)?f.options:null,me=T?P??"\u2014":n(P,U),ge=T?f.answer:n(f.correct??f.answer,U),ve=T?G(P,f.answer??"")>=4:Q(P,f.correct??f.answer);return{question:f.q||f.question,options:T?null:U,userAnswer:me,correctAnswer:ge,wasCorrect:ve,explanation:f.explanation||""}}),B=w.filter(f=>!f.wasCorrect),x=w.length-B.length,$={quizTitle:u.examTitle||"",percentage:v,passed:v>=70,mcq:{correct:l,wrong:y,skipped:b,total:k},essay:g>0?{score:m,max:I}:null,questions:B,omittedCorrectCount:x};document.body.appendChild(ne({pageKey:"result",defaultSystemPrompt:ie($),suggestedPrompts:ae($),placeholder:"\u0627\u0633\u0623\u0644 \u0639\u0646 \u0646\u062A\u064A\u062C\u062A\u0643 \u0623\u0648 \u0627\u0637\u0644\u0628 \u062A\u0648\u0635\u064A\u0627\u062A..."}))}if(p.length>10&&v===100){setTimeout(()=>{be(),pe(j,s.title,s.category)},800);let n=document.createElement("button");n.id="reopenCertBtn",n.className="nav-btn primary cert-reopen-btn",n.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/></svg><span>\u0639\u0631\u0636 \u0627\u0644\u0634\u0647\u0627\u062F\u0629 \u2014 View Certificate</span>',n.addEventListener("click",()=>{pe(j,s.title,s.category)}),t&&t.appendChild(n)}document.querySelectorAll("#reviewContainer .review-card").forEach((n,w)=>{n.style.setProperty("--stagger",Math.min(w,8))});let q=document.getElementById("filterBar");q&&q.addEventListener("click",n=>{let w=n.target.closest(".filter-btn");if(!w)return;q.querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active")),w.classList.add("active");let B=w.dataset.filter;document.querySelectorAll("#reviewContainer .review-card").forEach(x=>{let $=!0;switch(B){case"all":$=!0;break;case"correct":$=x.classList.contains("correct");break;case"wrong":$=x.classList.contains("wrong");break;case"skipped":$=x.classList.contains("skipped");break;case"essay":$=x.classList.contains("essay-card");break;case"mcq":$=!x.classList.contains("essay-card");break}x.style.display=$?"":"none"})}),(u.gamification?u.gamification.newBadges:[]).forEach((n,w)=>{setTimeout(()=>N(`Congratulations, ${j}`,`You've earned the ${n.title} badge`,`${n.icon}`),w*500)})});function ye(t,c,h,a,d,o,e,i,r,s,p,l){let y=c.quizMode??c.mode??"",b=y==="timed"||y==="timed_exam",k,g;if(b&&c.timeRemaining!==void 0&&c.timeRemaining>0){let n=c.timeRemaining;g=`${Math.floor(n/60)}m ${n%60}s`}let m=c.timeElapsed??0;k=`${Math.floor(m/60)}m ${m%60}s`;let I=c.gamification?c.gamification.pointsEarned:0,L=c.gamification?c.gamification.newBadges:[],A=a!==void 0?a:h,v=A>=70,C=r>0,M=s>0,E="";L.length>0&&(E=`
      <div class="new-badges-section">
        <h3><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-award-icon lucide-award"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg> \u0634\u0627\u0631\u0627\u062A \u062A\u0645 \u0625\u0643\u062A\u0633\u0627\u0628\u0647\u0627</h3>
        <div class="badge-grid">
          ${L.map(n=>`
            <div class="badge-item">
              <span class="badge-icon">${n.icon}</span>
              <span class="badge-name">${n.title}</span>
            </div>`).join("")}
        </div>
      </div>`);let q=`<span id="result-page-username">${j}</span>`,D="";if(C&&M){let n=r>0?Math.round(o/r*100):0,w=l>0?Math.round(p/l*100):0,B="\u2605".repeat(Math.round(p/l*5))+`<span class="sdt-star-empty">${"\u2605".repeat(5-Math.round(p/l*5))}</span>`,x=o+p,$=r+l;D=`
      <div class="sdt-row sdt-highlight">
        <span class="sdt-label">\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0643\u0644\u064A\u0629</span>
        <span class="sdt-value">${A}%</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u0627\u0644\u0645\u062C\u0645\u0648\u0639</span>
        <span class="sdt-value">${x} / ${$} \u0646\u0642\u0637\u0629</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0645\u0648\u0636\u0648\u0639\u064A\u0629</span>
        <span class="sdt-value">${o} / ${r} &nbsp;<span class="sdt-pct">${n}%</span></span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u062E\u0637\u0623</span>
        <span class="sdt-value sdt-wrong">${e}</span>
      </div>
      ${i>0?`
      <div class="sdt-row">
        <span class="sdt-label">\u0645\u062A\u062E\u0637\u0649</span>
        <span class="sdt-value sdt-skipped">${i}</span>
      </div>`:""}
      <div class="sdt-row">
        <span class="sdt-label">\u0627\u0644\u0645\u0642\u0627\u0644\u064A</span>
        <span class="sdt-value">${p} / ${l} &nbsp;<span class="sdt-stars">${B}</span></span>
      </div>
      <div class="sdt-row sdt-last">
        <span class="sdt-label">\u0627\u0644\u062D\u0627\u0644\u0629</span>
        <span class="sdt-value ${v?"sdt-pass":"sdt-fail"}">${v?"\u2713 \u0646\u0627\u062C\u062D":"\u2717 \u0631\u0627\u0633\u0628"}</span>
      </div>`}else if(M){let n="\u2605".repeat(Math.round(p/l*5))+`<span class="sdt-star-empty">${"\u2605".repeat(5-Math.round(p/l*5))}</span>`;D=`
      <div class="sdt-row sdt-highlight">
        <span class="sdt-label">\u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0643\u0644\u064A\u0629</span>
        <span class="sdt-value">${A}%</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u062F\u0631\u062C\u0629 \u0627\u0644\u0645\u0642\u0627\u0644\u064A</span>
        <span class="sdt-value">${p} / ${l} \u0646\u0642\u0637\u0629</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u0627\u0644\u062A\u0642\u064A\u064A\u0645</span>
        <span class="sdt-value sdt-stars">${n}</span>
      </div>
      <div class="sdt-row sdt-last">
        <span class="sdt-label">\u0627\u0644\u062D\u0627\u0644\u0629</span>
        <span class="sdt-value ${v?"sdt-pass":"sdt-fail"}">${v?"\u2713 \u0646\u0627\u062C\u062D":"\u2717 \u0631\u0627\u0633\u0628"}</span>
      </div>`}else D=`
      <div class="sdt-row sdt-highlight">
        <span class="sdt-label">\u0627\u0644\u0646\u062A\u064A\u062C\u0629</span>
        <span class="sdt-value">${A}%</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0627\u0644\u0635\u062D\u064A\u062D\u0629</span>
        <span class="sdt-value sdt-correct">${o} / ${r}</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">\u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0627\u0644\u062E\u0627\u0637\u0626\u0629</span>
        <span class="sdt-value sdt-wrong">${e}</span>
      </div>
      ${i>0?`
      <div class="sdt-row">
        <span class="sdt-label">\u0645\u062A\u062E\u0637\u0649</span>
        <span class="sdt-value sdt-skipped">${i}</span>
      </div>`:""}
      <div class="sdt-row sdt-last">
        <span class="sdt-label">\u0627\u0644\u062D\u0627\u0644\u0629</span>
        <span class="sdt-value ${v?"sdt-pass":"sdt-fail"}">${v?"\u2713 \u0646\u0627\u062C\u062D":"\u2717 \u0631\u0627\u0633\u0628"}</span>
      </div>`;t&&(t.innerHTML=`
    <div class="score-header-inner">
      <div class="score-circle ${v?"pass":"fail"}">
        <span>${A}%</span>
      </div>

      <div class="score-header-body">
        <h2 class="score-greeting">
          ${v?`\u{1F389} \u0623\u062D\u0633\u0646\u062A \u064A\u0627 ${q}!`:`\u{1F4DA} \u0627\u0633\u062A\u0645\u0631 \u0641\u064A \u0627\u0644\u0645\u0630\u0627\u0643\u0631\u0629 \u064A\u0627 ${q}`}
        </h2>

        <div class="points-pill">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-gem"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>
          +${I} \u0646\u0642\u0637\u0629
        </div>

        <div class="score-detail-table">
          ${D}
        </div>

        <p class="time-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          ${b?`\u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0645\u062A\u0628\u0642\u0651\u064A: ${g} | \u0627\u0644\u0648\u0642\u062A: ${k}`:`\u0627\u0644\u0648\u0642\u062A: ${k}`}
        </p>

        ${E}
      </div>
    </div>

  `)}function fe(t,c,h){if(!t)return;let a="",d=R;c.forEach((o,e)=>{let i=O(o),r=h[e],s=d?re(d,e):!1,p=d?`<button class="report-question-btn ${s?"active":""}" onclick="window.reportReviewQuestion(${e})" title="${s?"\u062A\u0645 \u0627\u0644\u0625\u0628\u0644\u0627\u063A \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0633\u0624\u0627\u0644":"\u0627\u0644\u0625\u0628\u0644\u0627\u063A \u0639\u0646 \u062E\u0637\u0623 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0633\u0624\u0627\u0644"}"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>`:"";if(i){let l=G(r,ce(o)),y=we(l),b=l>=4?"\u0645\u0645\u062A\u0627\u0632":l===3?"\u062C\u064A\u062F":l===2?"\u0645\u0642\u0628\u0648\u0644":l===1?"\u0636\u0639\u064A\u0641":r?.trim()?"\u0635\u0641\u0631":"\u0644\u0645 \u064A\u064F\u062C\u064E\u0628",k=l>=4?"essay-score-excellent":l>=3?"essay-score-good":l>=1?"essay-score-poor":"essay-score-none",g=r?S(String(r),{mediaBaseUrl:z}):"<em>\u0644\u0645 \u062A\u064F\u062C\u0650\u0628</em>",m=S(ce(o),{mediaBaseUrl:z}),I=o.explanation?S(o.explanation,{mediaBaseUrl:z}):"";a+=`
        <div class="review-card essay-card">
          <div class="review-header">
            <span class="q-num" title="This is question number ${e+1}">#${e+1}</span>
            <div class="review-header-right">
              <span class="essay-badge" title="Your score is (${l}/5)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scroll-text-icon lucide-scroll-text"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg> Essay</span>
              <span class="essay-score-badge ${k}" title="Your score is (${l}/5)">${y} ${b} (${l}/5)</span>
              ${p}
            </div>
          </div>
          ${de(o.passage)}
          <div class="q-text">${S(o.q,{mediaBaseUrl:z})}</div>
          <div class="essay-comparison">
            <div class="essay-answer-box user-essay">
              <div class="centered-label small-text"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil-line-icon lucide-pencil-line"><path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg> \u0625\u062C\u0627\u0628\u062A\u0643</div>
              <div class="essay-text">${g}</div>
            </div>
            <div class="essay-answer-box formal-essay">
              <div class="centered-label small-text"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open-icon lucide-book-open"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg> \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062C\u064A\u0629</div>
              <div class="essay-text">${m}</div>
            </div>
          </div>
          ${I?`
          <div class="explanation">
            <div class="centered-label"><strong><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb-icon lucide-lightbulb"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> \u0627\u0644\u0634\u0631\u062D</strong></div>
            <div class="explanation-body">${I}</div>
          </div>`:""}
        </div>`}else{let l=o.correct??o.answer,y=W(o),b=r==null||y&&Array.isArray(r)&&r.length===0,k;b?k=!1:y?k=Array.isArray(r)&&Array.isArray(l)&&r.length===l.length&&l.every(A=>r.includes(A)):k=Q(r,l);let g=k?"correct":b?"skipped":"wrong",m=k?'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check-icon lucide-circle-check"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>':b?'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-minus-icon lucide-circle-minus"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>':'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x-icon lucide-circle-x"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',I=o.options.map((A,v)=>{let C=!1;y?C=Array.isArray(r)&&r.includes(v):C=r===v;let M="option-row locked";C&&(M+=" selected");let E=y?Array.isArray(l)&&l.includes(v):v===V(o);E&&(M+=" correct"),C&&!E&&(M+=" wrong");let q=y?"checkbox":"radio",D=y?`answer-${e}-${v}`:`answer-${e}`;return`
          <div class="${M}">
            <input type="${q}" name="${D}" ${C?"checked":""} disabled aria-label="Option ${v+1}">
            <span class="option-label">${S(A,{mediaBaseUrl:z})}</span>
          </div>`}).join(""),L=o.explanation?S(o.explanation,{mediaBaseUrl:z}):"";a+=`
        <div class="review-card ${g}">
          <div class="review-header">
            <span class="q-num">#${e+1}</span>
            <div class="review-header-right">
              <span class="status-icon status-${g}" title="This question is ${g}">${m}</span>
              ${p}
            </div>
          </div>
          ${de(o.passage)}
          <div class="q-text">${S(o.q,{mediaBaseUrl:z})}</div>
          <div class="options-grid">
            ${I}
          </div>
          ${L?`
          <div class="explanation">
            <div class="centered-label"><strong><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb-icon lucide-lightbulb"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> \u0627\u0644\u0634\u0631\u062D</strong></div>
            <div class="explanation-body">${L}</div>
          </div>`:""}
        </div>`}}),t.innerHTML=a}window.reportReviewQuestion=t=>{let c=R;if(!c)return;let h=u?.questions||[],a=h[t];le({quizId:c,questionIndex:t,questionText:a?.q||a?.question||a?.text||`\u0633\u0624\u0627\u0644 \u0631\u0642\u0645 ${t+1}`,onSuccess:()=>{let d=document.getElementById("reviewContainer");d&&fe(d,h,u.userAnswers)}})};function be(){let t=document.createElement("canvas");Object.assign(t.style,{position:"fixed",top:"0",left:"0",width:"100%",height:"100%",pointerEvents:"none",zIndex:"9998"}),t.width=window.innerWidth,t.height=window.innerHeight,document.body.appendChild(t);let c=t.getContext("2d"),h=80,a=["#6366f1","#8b5cf6","#f59e0b","#10b981","#ef4444","#3b82f6","#fbbf24","#a78bfa"],d=Array.from({length:h},()=>({x:Math.random()*t.width,y:-20-Math.random()*60,vx:(Math.random()-.5)*6,vy:2+Math.random()*5,rot:Math.random()*360,vrot:(Math.random()-.5)*8,w:6+Math.random()*8,h:3+Math.random()*5,color:a[Math.floor(Math.random()*a.length)],opacity:1})),o=null,e=3500;function i(r){o||(o=r);let s=r-o;c.clearRect(0,0,t.width,t.height);let p=!0;for(let l of d)l.x+=l.vx,l.y+=l.vy,l.vy+=.12,l.rot+=l.vrot,l.opacity=Math.max(0,1-s/e),l.y<t.height+20&&(p=!1),c.save(),c.translate(l.x,l.y),c.rotate(l.rot*Math.PI/180),c.globalAlpha=l.opacity,c.fillStyle=l.color,c.fillRect(-l.w/2,-l.h/2,l.w,l.h),c.restore();s<e&&!p?requestAnimationFrame(i):t.remove()}requestAnimationFrame(i)}async function pe(t,c,h){let a=document.getElementById("certificateOverlay");if(!a)return;let d=await xe(t,c,h),o=document.getElementById("certPreviewWrap");if(o){o.innerHTML="";let e=document.createElement("img");e.src=d.toDataURL("image/png"),e.alt="Certificate preview",e.style.cssText="width:100%;height:auto;display:block;border-radius:8px;",o.appendChild(e)}a.style.display="flex",document.getElementById("certDownloadBtn")?.addEventListener("click",()=>{let e=document.createElement("a");e.href=d.toDataURL("image/png"),e.download=`certificate-${(t||"student").replace(/\s+/g,"_")}.png`,e.click()},{once:!0}),document.getElementById("certCloseBtn")?.addEventListener("click",he),a.addEventListener("click",e=>{e.target===a&&he()})}function he(){let t=document.getElementById("certificateOverlay");t&&(t.classList.add("closing"),t.addEventListener("animationend",()=>{t.style.display="none",t.classList.remove("closing")},{once:!0}))}async function xe(t,c,h){await document.fonts.ready;let a=1200,d=820,o=document.createElement("canvas");o.width=a,o.height=d;let e=o.getContext("2d");e.fillStyle="#fffdf5",e.fillRect(0,0,a,d),e.strokeStyle="#b8860b",e.lineWidth=7,e.strokeRect(6,6,a-12,d-12),e.strokeStyle="#d4a017",e.lineWidth=1.5,e.strokeRect(22,22,a-44,d-44),e.strokeRect(28,28,a-56,d-56);let i=[[40,40],[a-40,40],[40,d-40],[a-40,d-40]];e.fillStyle="#b8860b";for(let[g,m]of i)e.save(),e.translate(g,m),e.rotate(Math.PI/4),e.fillRect(-5,-5,10,10),e.restore();await new Promise(g=>{let m=new Image;m.onload=()=>{e.save(),e.globalAlpha=.07;let I=260;e.drawImage(m,(a-I)/2,(d-I)/2,I,I),e.restore(),g()},m.onerror=g,m.crossOrigin="anonymous",m.src="favicon.png"});let r=a/2,s=118,p=52;e.strokeStyle="#b8860b",e.lineWidth=1.5;for(let g=0;g<8;g++){let m=g*Math.PI/4;e.beginPath(),e.moveTo(r+Math.cos(m)*(p+3),s+Math.sin(m)*(p+3)),e.lineTo(r+Math.cos(m)*(p+12),s+Math.sin(m)*(p+12)),e.stroke()}e.fillStyle="#fdf6e3",e.beginPath(),e.arc(r,s,p,0,Math.PI*2),e.fill(),e.strokeStyle="#b8860b",e.lineWidth=2,e.stroke(),ke(e,r,s-8,5,30,13,"#d4a017"),e.fillStyle="#7c3f00",e.font='bold 14px "Amiri", serif',e.textAlign="center",e.direction="ltr",e.fillText("\u0634\u0647\u0627\u062F\u0629 \u062A\u0642\u062F\u064A\u0631",r,s+36),F(e,a,195,2),e.fillStyle="#7c3f00",e.font='bold 58px "Playfair Display", "Amiri", Georgia, serif',e.textAlign="center",e.fillText("Certificate of Excellence",a/2,270),F(e,a,295,1.5),e.fillStyle="#8a5a30",e.font='22px "Amiri", Georgia, serif',e.fillText("This certifies that",a/2,348),e.fillStyle="#1a0a00",e.font='bold italic 52px "Amiri", Georgia, serif',e.fillText(t,a/2,420);let l=e.measureText(t),y=Math.min(l.width+60,a-200);e.strokeStyle="rgba(184,134,11,0.45)",e.lineWidth=1,e.beginPath(),e.moveTo(a/2-y/2,432),e.lineTo(a/2+y/2,432),e.stroke(),e.fillStyle="#8a5a30",e.font='22px "Amiri", Georgia, serif',e.fillText("has successfully completed",a/2,476),e.fillStyle="#1a0a00",e.font='bold 34px "Amiri", Georgia, serif';let b=$e(e,c,a/2,530,a-220,44);h&&(e.fillStyle="#8a5a30",e.font='18px "Amiri", Georgia, serif',b=Math.max(b,540),e.fillText(`Subject: ${h}`,a/2,b+38),b+=38),e.fillStyle="#7c3f00",e.font='20px "Amiri", Georgia, serif',e.fillText("with a perfect score of 100%",a/2,b+54),F(e,a,d-115,1);let k=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});return e.textAlign="left",e.fillStyle="#4a2810",e.font='bold 17px "Amiri", Georgia, serif',e.fillText(k,90,d-80),e.fillStyle="#b8860b",e.font='13px "Amiri", Georgia, serif',e.fillText("Issue Date",90,d-60),e.textAlign="right",e.direction="ltr",e.fillStyle="#4a2810",e.font='bold 22px "Amiri", serif',e.fillText("\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A \u0628\u0635\u0645\u062C\u064A",a-90,d-77),e.fillStyle="#8a5a30",e.font='14px "Amiri", Georgia, serif',o}function ke(t,c,h,a,d,o,e){let i=Math.PI/2*3,r=Math.PI/a;t.beginPath(),t.moveTo(c,h-d);for(let s=0;s<a;s++)t.lineTo(c+Math.cos(i)*d,h+Math.sin(i)*d),i+=r,t.lineTo(c+Math.cos(i)*o,h+Math.sin(i)*o),i+=r;t.closePath(),t.fillStyle=e,t.fill()}function F(t,c,h,a){let d=t.createLinearGradient(0,0,c,0);d.addColorStop(0,"transparent"),d.addColorStop(.2,"#b8860b"),d.addColorStop(.8,"#b8860b"),d.addColorStop(1,"transparent"),t.strokeStyle=d,t.lineWidth=a,t.beginPath(),t.moveTo(80,h),t.lineTo(c-80,h),t.stroke()}function $e(t,c,h,a,d,o){let e=c.split(" "),i="",r=a;for(let s of e){let p=i+(i?" ":"")+s;t.measureText(p).width>d&&i?(t.fillText(i,h,r),i=s,r+=o):i=p}return i&&t.fillText(i,h,r),r}
