import{a as c}from"./chunk-JOVBCH5E.js";function f({title:u,description:p="",source:v="",onSave:b}){let t=document.createElement("div");t.className="item-metadata-overlay",t.dir="rtl";let e=document.createElement("section");e.className="item-metadata-modal",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-labelledby","item-metadata-title"),e.innerHTML=`
    <div class="item-metadata-modal__glow" aria-hidden="true"></div>
    <header class="item-metadata-modal__header">
      <div class="item-metadata-modal__mark" aria-hidden="true">\u2726</div>
      <div class="item-metadata-modal__heading">
        <span class="item-metadata-modal__eyebrow">\u062A\u062D\u0631\u064A\u0631 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644</span>
        <h2 id="item-metadata-title">\u0627\u0644\u0648\u0635\u0641 \u0648\u0627\u0644\u0645\u0635\u062F\u0631</h2>
        <p class="item-metadata-modal__item-title"></p>
      </div>
      <button type="button" class="item-metadata-modal__close" aria-label="\u0625\u063A\u0644\u0627\u0642">\xD7</button>
    </header>
    <div class="item-metadata-modal__body">
      <label class="item-metadata-field">
        <span><strong>\u0627\u0644\u0648\u0635\u0641</strong><small>\u0642\u062F\u0651\u0645 \u0644\u0644\u0637\u0644\u0627\u0628 \u0646\u0628\u0630\u0629 \u0648\u0627\u0636\u062D\u0629 \u0639\u0645\u0651\u0627 \u0633\u064A\u062C\u062F\u0648\u0646\u0647.</small></span>
        <textarea dir="auto" class="item-metadata-description" maxlength="1200" rows="4" placeholder="\u0627\u0643\u062A\u0628 \u0648\u0635\u0641\u0627\u064B \u0645\u062E\u062A\u0635\u0631\u0627\u064B..."></textarea>
        <span class="item-metadata-counter item-metadata-description-count"></span>
      </label>
      <label class="item-metadata-field">
        <span><strong>\u0627\u0644\u0645\u0635\u062F\u0631</strong><small>\u0631\u0627\u0628\u0637 \u0623\u0648 \u0645\u0631\u062C\u0639 \u064A\u0633\u0627\u0639\u062F \u0639\u0644\u0649 \u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0645\u062D\u062A\u0648\u0649.</small></span>
        <input dir="auto" class="item-metadata-source" type="text" maxlength="500" dir="auto" placeholder="https:// \u0623\u0648 \u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u062C\u0639" />
        <span class="item-metadata-counter item-metadata-source-count"></span>
      </label>
      <p class="item-metadata-error" role="alert" hidden></p>
    </div>
    <footer class="item-metadata-modal__footer">
      <span class="item-metadata-modal__hint">\u062A\u0638\u0647\u0631 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0645\u0628\u0627\u0634\u0631\u0629 \u0628\u0639\u062F \u0627\u0644\u062D\u0641\u0638</span>
      <div class="item-metadata-modal__actions">
        <button type="button" class="item-metadata-cancel">\u0625\u0644\u063A\u0627\u0621</button>
        <button type="button" class="item-metadata-save"><span>\u062D\u0641\u0638 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A</span><b aria-hidden="true">\u2197</b></button>
      </div>
    </footer>
  `,e.querySelector(".item-metadata-modal__item-title").textContent=u||"\u0627\u0644\u0639\u0646\u0635\u0631 \u0627\u0644\u0645\u062D\u062F\u062F";let s=e.querySelector(".item-metadata-description"),i=e.querySelector(".item-metadata-source"),y=e.querySelector(".item-metadata-description-count"),_=e.querySelector(".item-metadata-source-count"),n=e.querySelector(".item-metadata-error"),a=e.querySelector(".item-metadata-save");s.value=p||"",i.value=v||"";let l=()=>{y.textContent=`${s.value.length} / 1200`,_.textContent=`${i.value.length} / 500`};l(),s.addEventListener("input",l),i.addEventListener("input",l);let r=!1,d=()=>{r||(r=!0,document.removeEventListener("keydown",m),t.classList.remove("is-visible"),window.setTimeout(()=>t.remove(),180))},m=o=>{o.key==="Escape"&&(o.preventDefault(),d())};e.querySelector(".item-metadata-modal__close").addEventListener("click",d),e.querySelector(".item-metadata-cancel").addEventListener("click",d),a.addEventListener("click",async()=>{if(!a.disabled){n.hidden=!0,a.disabled=!0,a.querySelector("span").textContent="\u062C\u0627\u0631\u064D \u0627\u0644\u062D\u0641\u0638\u2026";try{if(await b?.({description:s.value.trim(),source:i.value.trim()})===!1)throw new Error("\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.");c("\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644","\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0648\u0635\u0641 \u0648\u0627\u0644\u0645\u0635\u062F\u0631 \u0628\u0646\u062C\u0627\u062D.","success"),d()}catch(o){n.textContent=o?.message||"\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.",n.hidden=!1,a.disabled=!1,a.querySelector("span").textContent="\u062D\u0641\u0638 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A"}}}),document.addEventListener("keydown",m),t.appendChild(e),document.body.appendChild(t),requestAnimationFrame(()=>{t.classList.add("is-visible"),s.focus()})}export{f as a};
