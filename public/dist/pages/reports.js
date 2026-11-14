import"../chunks/chunk-6TJQV4FV.js";import"../chunks/chunk-7PDTGCXS.js";import"../chunks/chunk-NICZD2J2.js";import{a as h}from"../chunks/chunk-CLCAKNBK.js";import{P as q}from"../chunks/chunk-HFOYQOFP.js";import"../chunks/chunk-I6GXFOIR.js";import"../chunks/chunk-L2WIPL4C.js";import"../chunks/chunk-G32INTHD.js";import"../chunks/chunk-MWWP4IBT.js";import{a as $}from"../chunks/chunk-TTDWA2H5.js";import{b as k,c as y,d as T}from"../chunks/chunk-FS3RLBBG.js";import"../chunks/chunk-PY4V6ACG.js";import"../chunks/chunk-JOVBCH5E.js";import"../chunks/chunk-HE6VJRPR.js";var E="user_reported_questions",d=!1,I=null,w="my",c="pending",p="",v=[],L=null;function x(t,i=!1){let e=document.getElementById("reportsToast");e&&(e.textContent=t,e.className=`toast-msg show ${i?"error":"success"}`,clearTimeout(L),L=setTimeout(()=>{e.classList.remove("show")},3500))}function f(t){return t?String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"):""}function S(t){if(!t)return"";try{return new Date(t).toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return t}}function _(){let t=k(),i={"Content-Type":"application/json"};return t&&(i.Authorization=`Bearer ${t}`),i}async function C(){if(y())try{await $({onSignedOut:()=>{d=!1,R(),m()}})}catch(t){console.error("[reports] Admin session sync failed:",t)}d=y();try{I=T()}catch{}R(),m()}function R(){let t=document.getElementById("reportsApp");if(!t)return;let i=d?'<span class="hero-role-badge admin">\u0645\u0634\u0631\u0641 \u0627\u0644\u0645\u0646\u0635\u0629</span>':'<span class="hero-role-badge">\u062D\u0633\u0627\u0628 \u0645\u0633\u062A\u062E\u062F\u0645</span>',e=d?"\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0625\u062F\u0627\u0631\u0629 \u0628\u0644\u0627\u063A\u0627\u062A \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0645\u0642\u062F\u0645\u0629 \u0645\u0646 \u0627\u0644\u0637\u0644\u0627\u0628 \u0648\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0639\u0644\u0649 \u0627\u0644\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A.":"\u0633\u062C\u0644 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u062A\u064A \u0623\u0628\u0644\u063A\u062A \u0639\u0646 \u0648\u062C\u0648\u062F \u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0628\u0647\u0627 \u0645\u0639 \u0645\u062A\u0627\u0628\u0639\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u0627\u0644\u062A\u0635\u062D\u064A\u062D.";if(t.innerHTML=`
    <div class="reports-page-container">
      <!-- HERO BANNER -->
      <div class="reports-hero">
        <div class="hero-main">
          <div class="hero-icon-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div>
            <div class="hero-title">
              <span>\u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A</span>
              ${i}
            </div>
            <div class="hero-subtitle">${e}</div>
          </div>
        </div>
      </div>

      <!-- STATS SUMMARY -->
      <div class="reports-stats-grid" id="reportsStatsGrid">
        <div class="report-stat-card">
          <div class="stat-icon-wrap total">\u{1F4CB}</div>
          <div class="stat-info">
            <span class="stat-num" id="statTotal">0</span>
            <span class="stat-text">\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A</span>
          </div>
        </div>
        <div class="report-stat-card">
          <div class="stat-icon-wrap pending">\u23F3</div>
          <div class="stat-info">
            <span class="stat-num" id="statPending">0</span>
            <span class="stat-text">\u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629</span>
          </div>
        </div>
        <div class="report-stat-card">
          <div class="stat-icon-wrap resolved">\u2705</div>
          <div class="stat-info">
            <span class="stat-num" id="statResolved">0</span>
            <span class="stat-text">\u062A\u0645 \u0627\u0644\u062D\u0644</span>
          </div>
        </div>
        <div class="report-stat-card">
          <div class="stat-icon-wrap dismissed">\u2715</div>
          <div class="stat-info">
            <span class="stat-num" id="statDismissed">0</span>
            <span class="stat-text">\u062A\u0645 \u0627\u0644\u062A\u062C\u0627\u0647\u0644</span>
          </div>
        </div>
      </div>

      <!-- CONTROLS -->
      <div class="reports-controls">
        <div class="controls-row-top">
          ${d?`
            <div class="scope-tabs" id="scopeTabs">
              <button class="scope-tab-btn ${w==="my"?"active":""}" data-scope="my">
                <span>\u0628\u0644\u0627\u063A\u0627\u062A \u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A\u064A</span>
              </button>
              <button class="scope-tab-btn ${w==="all"?"active":""}" data-scope="all">
                <span>\u062C\u0645\u064A\u0639 \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A</span>
              </button>
            </div>`:'<div style="font-weight: 600; font-size: 1rem; color: var(--text-primary);">\u0633\u062C\u0644 \u0628\u0644\u0627\u063A\u0627\u062A\u064A \u0627\u0644\u0633\u0627\u0628\u0642\u0629</div>'}

          <div class="search-filter-wrap">
            <svg class="search-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text" 
              id="reportSearchInput" 
              class="search-filter-input" 
              placeholder="\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A \u0623\u0648 \u0627\u0644\u0623\u0633\u0626\u0644\u0629..."
              value="${f(p)}"
            >
          </div>
        </div>

        <div class="status-filters" id="statusFilters">
          <button class="status-pill ${c==="pending"?"active":""}" data-status="pending">
            <span class="pill-dot pending"></span>
            <span>\u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631</span>
          </button>
          <button class="status-pill ${c==="resolved"?"active":""}" data-status="resolved">
            <span class="pill-dot resolved"></span>
            <span>\u062A\u0645 \u0627\u0644\u062D\u0644</span>
          </button>
          <button class="status-pill ${c==="dismissed"?"active":""}" data-status="dismissed">
            <span class="pill-dot dismissed"></span>
            <span>\u062A\u0645 \u0627\u0644\u062A\u062C\u0627\u0647\u0644</span>
          </button>
          <button class="status-pill ${c==="all"?"active":""}" data-status="all">
            <span class="pill-dot all"></span>
            <span>\u0627\u0644\u0643\u0644</span>
          </button>
        </div>
      </div>

      <!-- LIST CONTAINER -->
      <div id="reportsListContainer" class="reports-list">
        <div class="reports-empty-state">
          <div class="empty-icon-wrap">\u23F3</div>
          <div class="empty-title">\u062C\u0627\u0631\u064A \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A...</div>
        </div>
      </div>
    </div>

    <!-- TOAST -->
    <div id="reportsToast" class="toast-msg"></div>
  `,d){let a=document.querySelectorAll(".scope-tab-btn");a.forEach(n=>{n.addEventListener("click",()=>{a.forEach(r=>r.classList.remove("active")),n.classList.add("active"),w=n.dataset.scope,m()})})}let s=document.querySelectorAll(".status-pill");s.forEach(a=>{a.addEventListener("click",()=>{s.forEach(n=>n.classList.remove("active")),a.classList.add("active"),c=a.dataset.status,u()})});let o=document.getElementById("reportSearchInput");o&&o.addEventListener("input",a=>{p=a.target.value.trim().toLowerCase(),u()})}async function m(){let t=document.getElementById("reportsListContainer");t&&(t.innerHTML=`
    <div class="reports-empty-state">
      <div class="empty-icon-wrap">\u23F3</div>
      <div class="empty-title">\u062C\u0627\u0631\u064A \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A...</div>
    </div>
  `,d?await z():await j())}async function z(){try{let t=await fetch(h(`/api/reports?scope=${w}&status=all`),{headers:_()}),i=await t.json();if(!t.ok)throw new Error(i.error||"\u0641\u0634\u0644 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A");v=i.reports||[],b(v),u()}catch(t){console.error("[reports] Error loading admin reports:",t),x(t.message,!0);let i=document.getElementById("reportsListContainer");i&&(i.innerHTML=`
        <div class="reports-empty-state">
          <div class="empty-icon-wrap" style="color:#ef4444;">\u26A0\uFE0F</div>
          <div class="empty-title">\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u062C\u0644\u0628 \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A</div>
          <div class="empty-desc">${f(t.message)}</div>
          <button class="empty-btn-action" onclick="window.reloadReports()">\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629</button>
        </div>
      `)}}async function j(){try{let t=[];try{t=JSON.parse(localStorage.getItem(E)||"[]")}catch{t=[]}if(!Array.isArray(t)||t.length===0){v=[],b([]),u();return}let i=t.map(e=>e.id).filter(e=>typeof e=="string"&&e.includes("-"));if(i.length>0)try{let e=await fetch(h(`/api/reports?ids=${i.join(",")}`));if(e.ok){let o=(await e.json()).reports||[],a=new Map(o.map(n=>[n.id,n]));t=t.map(n=>{let r=a.get(n.id);return r?{...n,status:r.status,resolved_at:r.resolved_at,quiz_title:r.quizzes?.title||n.quiz_title}:n}),localStorage.setItem(E,JSON.stringify(t))}}catch(e){console.warn("[reports] Failed to sync live status:",e)}v=t,b(v),u()}catch(t){console.error("[reports] User reports error:",t),v=[],u()}}function b(t){let i=t.length,e=t.filter(l=>l.status==="pending").length,s=t.filter(l=>l.status==="resolved").length,o=t.filter(l=>l.status==="dismissed").length,a=document.getElementById("statTotal"),n=document.getElementById("statPending"),r=document.getElementById("statResolved"),g=document.getElementById("statDismissed");a&&(a.textContent=i),n&&(n.textContent=e),r&&(r.textContent=s),g&&(g.textContent=o)}function u(){let t=document.getElementById("reportsListContainer");if(!t)return;let i=v;if(c!=="all"&&(i=i.filter(s=>s.status===c)),p&&(i=i.filter(s=>{let o=(s.quizzes?.title||s.quiz_title||"").toLowerCase(),a=(s.reason||"").toLowerCase(),n=B(s).toLowerCase();return o.includes(p)||a.includes(p)||n.includes(p)})),i.length===0){let s=p?"\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0644\u0628\u062D\u062B":c==="pending"?"\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0644\u0627\u063A\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631 \u062D\u0627\u0644\u064A\u0627\u064B \u{1F389}":"\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0644\u0627\u063A\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0641\u0626\u0629",o=d?"\u0633\u064A\u062A\u0645 \u0625\u062F\u0631\u0627\u062C \u0627\u0644\u0628\u0644\u0627\u063A\u0627\u062A \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0647\u0646\u0627 \u0641\u0648\u0631 \u062A\u0642\u062F\u064A\u0645\u0647\u0627 \u0645\u0646 \u0627\u0644\u0637\u0644\u0627\u0628 \u0648\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646.":"\u0639\u0646\u062F \u0645\u0648\u0627\u062C\u0647\u0629 \u0623\u064A \u062E\u0637\u0623 \u0623\u0648 \u0633\u0624\u0627\u0644 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D \u0641\u064A \u0627\u0644\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A\u060C \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0625\u0628\u0644\u0627\u063A \u0639\u0646\u0647 \u0645\u0646 \u062E\u0644\u0627\u0644 \u0632\u0631 \u0627\u0644\u0625\u0628\u0644\u0627\u063A \u062F\u0627\u062E\u0644 \u0627\u0644\u0627\u0645\u062A\u062D\u0627\u0646 \u0648\u0633\u062A\u062A\u0645\u0643\u0646 \u0645\u0646 \u0645\u062A\u0627\u0628\u0639\u0629 \u062D\u0644\u0647 \u0647\u0646\u0627.";t.innerHTML=`
      <div class="reports-empty-state">
        <div class="empty-icon-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
        </div>
        <div class="empty-title">${s}</div>
        <div class="empty-desc">${o}</div>
        ${d?"":`<a href="/" class="empty-btn-action">
                <span>\u062A\u0635\u0641\u062D \u0627\u0644\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
               </a>`}
      </div>
    `;return}let e="";i.forEach(s=>{let o=s.quizzes?.title||s.quiz_title||"\u0627\u0645\u062A\u062D\u0627\u0646",a=s.question_index??0,n=B(s),r=S(s.created_at),g=s.status==="pending",l="";s.status==="resolved"?l=`
        <div class="status-badge resolved">
          <span>\u2713 \u062A\u0645 \u0627\u0644\u062D\u0644 \u0648\u0627\u0644\u062A\u0635\u062D\u064A\u062D</span>
        </div>
      `:s.status==="dismissed"?l=`
        <div class="status-badge dismissed">
          <span>\u2715 \u062A\u0645 \u0627\u0644\u062A\u062C\u0627\u0647\u0644 / \u0644\u0627 \u064A\u0648\u062C\u062F \u062E\u0637\u0623</span>
        </div>
      `:l=`
        <div class="status-badge pending">
          <span>\u23F3 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629</span>
        </div>
      `;let A=s.resolved_at?`<span class="resolved-time-text">\u062A\u0645\u062A \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629: ${S(s.resolved_at)}</span>`:"";e+=`
      <div class="report-card ${s.status}" id="report-${s.id}">
        <div class="report-card-header">
          <div class="report-meta-group">
            <span class="report-quiz-title">${f(o)}</span>
            <span class="report-q-badge">\u0633\u0624\u0627\u0644 \u0631\u0642\u0645 ${a+1}</span>
          </div>
          <span class="report-date">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${r}
          </span>
        </div>

        <div class="report-reason-box">
          <span class="report-reason-label">\u0633\u0628\u0628 \u0627\u0644\u0628\u0644\u0627\u063A:</span>
          <span class="report-reason-text">${f(s.reason||"\u063A\u064A\u0631 \u0645\u062D\u062F\u062F")}</span>
        </div>

        <div class="report-question-box">
          <div class="report-question-label">\u0646\u0635 \u0627\u0644\u0633\u0624\u0627\u0644:</div>
          <div class="report-question-body">${q(n)}</div>
        </div>

        <div class="report-card-footer">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            ${l}
            ${A}
          </div>

          ${d&&g?`
            <div class="report-actions">
              <button class="btn-resolve" onclick="window.resolveReport('${s.id}', 'resolved')">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                \u062A\u0645 \u0627\u0644\u062D\u0644
              </button>
              <button class="btn-dismiss" onclick="window.resolveReport('${s.id}', 'dismissed')">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                \u062A\u062C\u0627\u0647\u0644
              </button>
            </div>`:""}
        </div>
      </div>
    `}),t.innerHTML=e}function B(t){if(t.question_text)return t.question_text;let e=(t.quizzes?.data?.questions||[])[t.question_index]||{};return e.q||e.question||e.text||`\u0633\u0624\u0627\u0644 \u0631\u0642\u0645 ${(t.question_index??0)+1}`}window.resolveReport=async(t,i)=>{try{let e=await fetch(h("/api/reports"),{method:"POST",headers:_(),body:JSON.stringify({action:"resolve",report_id:t,status:i})}),s=await e.json();if(!e.ok)throw new Error(s.error||"\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u062D\u0627\u0644\u0629 \u0627\u0644\u0628\u0644\u0627\u063A");x(i==="resolved"?"\u062A\u0645 \u062D\u0644 \u0627\u0644\u0628\u0644\u0627\u063A \u0648\u062A\u062D\u062F\u064A\u062B \u062D\u0627\u0644\u062A\u0647 \u0628\u0646\u062C\u0627\u062D":"\u062A\u0645 \u062A\u062C\u0627\u0647\u0644 \u0627\u0644\u0628\u0644\u0627\u063A"),m()}catch(e){x(e.message,!0)}};window.reloadReports=()=>{m()};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",C):C();
