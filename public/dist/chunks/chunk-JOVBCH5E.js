function D(o,a="",n="info",i=5){let t=document.getElementById("notification-container");t||(t=document.createElement("div"),t.id="notification-container",document.body.appendChild(t));let e=n,s="info";switch(n){case"success":e="\u2705",s="success";break;case"error":e="\u274C",s="error";break;case"warning":e="\u26A0\uFE0F",s="warning";break;case"info":default:e="\u2139\uFE0F",s="info";break}["success","error","warning","info"].includes(n)||(e=n,s="default");let c=document.createElement("div");c.className=`notification glass-toast ${s}`;let d=$(e)?`<img src="${e}" alt="Icon" class="notification-image">`:`<span class="notification-icon">${e}</span>`;c.innerHTML=`
      <div class="notification-content" title="${v(o)}">
        ${d}
        <div>
          <strong dir="auto">${v(o)}</strong>
          <p dir="auto">${v(a)}</p>
        </div>
        <button class="close-btn-notification">\xD7</button>
      </div>
    `,t.prepend(c);let u=setTimeout(()=>{k(c)},i*1e3);c.querySelector(".close-btn-notification").addEventListener("click",()=>{clearTimeout(u),k(c)})}function k(o){o.style.animation="toastSlideOut 0.4s forwards cubic-bezier(0.68, -0.55, 0.27, 1.55)",o.addEventListener("animationend",()=>{o.remove()})}function v(o){if(!o)return"";let a=document.createElement("div");return a.textContent=o,a.innerHTML}function $(o){try{let a=new URL(o);return a.protocol==="http:"||a.protocol==="https:"}catch{try{let n="http://example.com",t=new URL(o,n).origin===n,e=o.includes("/")||o.startsWith(".");return t&&e}catch{return!1}}}function A(){let o=Array.from(document.querySelectorAll("dialog[open]"));return o.length?o[o.length-1]:document.body}function E(o){let a=A();if(a.appendChild(o),a!==document.body&&typeof o.showPopover=="function")try{o.setAttribute("popover","manual"),o.showPopover()}catch{}}function C(o){return new Promise(a=>{let n=document.createElement("div");n.className="confirmation-overlay";let i=document.createElement("div");i.className="confirmation-modal",i.setAttribute("role","alertdialog"),i.setAttribute("aria-modal","true");let t=`confirm-message-${Date.now()}`;i.setAttribute("aria-labelledby",t),i.innerHTML=`
        <div class="confirmation-content">
          <p class="confirmation-message" id="${t}">${v(o)}</p>
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm">\u0646\u0639\u0645</button>
            <button class="confirmation-btn cancel">\u0644\u0627</button>
          </div>
        </div>
      `,n.appendChild(i),E(n);let e=i.querySelector(".confirm"),s=i.querySelector(".cancel"),c=document.activeElement;requestAnimationFrame(()=>{n.classList.add("show"),i.classList.add("show"),e.focus()});let d=()=>{window.removeEventListener("keydown",b),n.classList.remove("show"),i.classList.remove("show"),setTimeout(()=>{n.parentNode&&n.parentNode.removeChild(n),c&&document.body.contains(c)&&c.focus()},300)},u=()=>{d(),a(!0)},r=()=>{d(),a(!1)},b=f=>{if(f.key==="Escape")f.stopPropagation(),r();else if(f.key==="Tab"){let p=i.querySelectorAll("button"),y=p[0],l=p[p.length-1];f.shiftKey?document.activeElement===y&&(f.preventDefault(),l.focus()):document.activeElement===l&&(f.preventDefault(),y.focus())}};e.addEventListener("click",u),s.addEventListener("click",r),window.addEventListener("keydown",b),n.addEventListener("click",f=>{f.target===n&&r()})})}function N(o){return new Promise(a=>{let n=document.createElement("div");n.className="confirmation-overlay";let i=document.createElement("div");i.className="confirmation-modal alert-modal",i.setAttribute("role","alertdialog"),i.setAttribute("aria-modal","true");let t=`alert-message-${Date.now()}`;i.setAttribute("aria-labelledby",t),i.innerHTML=`
        <div class="confirmation-content">
          <p class="confirmation-message" id="${t}">${v(o)}</p>
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm">\u062D\u0633\u0646\u0627\u064B</button>
          </div>
        </div>
      `,n.appendChild(i),E(n);let e=i.querySelector(".confirm"),s=document.activeElement;requestAnimationFrame(()=>{n.classList.add("show"),i.classList.add("show"),e.focus()});let c=()=>{window.removeEventListener("keydown",u),n.classList.remove("show"),i.classList.remove("show"),setTimeout(()=>{n.parentNode&&n.parentNode.removeChild(n),s&&document.body.contains(s)&&s.focus()},300)},d=()=>{c(),a()},u=r=>{r.key==="Escape"?(r.stopPropagation(),d()):r.key==="Enter"?(r.preventDefault(),d()):r.key==="Tab"&&(r.preventDefault(),e.focus())};e.addEventListener("click",d),window.addEventListener("keydown",u),n.addEventListener("click",r=>{r.target===n&&d()})})}function q(o,a="",n={}){return new Promise(i=>{let t=document.createElement("div");t.className="confirmation-overlay";let e=document.createElement("div");e.className="confirmation-modal prompt-modal",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true");let s=`prompt-message-${Date.now()}`;e.setAttribute("aria-labelledby",s),e.innerHTML=`
        <div class="confirmation-content">
          <p class="confirmation-message" id="${s}">${v(o)}</p>
          <input type="text" class="prompt-input" dir="auto" aria-labelledby="${s}" value="${v(a)}" />
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm">\u0646\u0639\u0645</button>
            <button class="confirmation-btn cancel">\u0644\u0627</button>
          </div>
        </div>
      `,t.appendChild(e),E(t);let c=e.querySelector(".prompt-input"),d=e.querySelector(".confirm"),u=e.querySelector(".cancel"),r=document.activeElement;requestAnimationFrame(()=>{t.classList.add("show"),e.classList.add("show"),c.focus(),c.select()});let b=()=>{window.removeEventListener("keydown",y),t.classList.remove("show"),e.classList.remove("show"),setTimeout(()=>{t.parentNode&&t.parentNode.removeChild(t),r&&document.body.contains(r)&&r.focus()},300)},f=()=>{let l=c.value;b(),i(l)},p=()=>{b(),i(null)},y=l=>{if(l.key==="Escape")l.stopPropagation(),p();else if(l.key==="Enter")l.preventDefault(),f();else if(l.key==="Tab"){let w=[c,d,u],m=w[0],h=w[w.length-1];l.shiftKey?document.activeElement===m&&(l.preventDefault(),h.focus()):document.activeElement===h&&(l.preventDefault(),m.focus())}};d.addEventListener("click",f),u.addEventListener("click",p),window.addEventListener("keydown",y),n.dismissOnBackdrop!==!1&&t.addEventListener("click",l=>{l.target===t&&p()})})}function S({message:o,confirmPhrase:a,inputLabel:n=null,confirmButtonLabel:i="\u062D\u0630\u0641 \u0646\u0647\u0627\u0626\u064A\u0627\u064B"}){return new Promise(t=>{C(o).then(e=>{if(!e){t(!1);return}T({confirmPhrase:a,inputLabel:n||`\u0627\u0643\u062A\u0628 "${a}" \u0644\u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0646\u0647\u0627\u0626\u064A:`,confirmButtonLabel:i}).then(t)})})}function T({confirmPhrase:o,inputLabel:a,confirmButtonLabel:n}){return new Promise(i=>{let t=document.createElement("div");t.className="confirmation-overlay";let e=document.createElement("div");e.className="confirmation-modal prompt-modal typed-confirmation-modal",e.setAttribute("role","alertdialog"),e.setAttribute("aria-modal","true");let s=`typed-confirm-message-${Date.now()}`,c=`typed-confirm-phrase-${Date.now()}`;e.setAttribute("aria-labelledby",s),e.innerHTML=`
        <div class="confirmation-content">
          <p class="confirmation-message" id="${s}">${v(a)}</p>
          <p class="typed-confirmation-phrase" id="${c}" dir="auto">${v(o)}</p>
          <input
            type="text"
            class="prompt-input typed-confirmation-input"
            dir="auto"
            aria-labelledby="${s}"
            aria-describedby="${c}"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm typed-confirmation-confirm-btn" disabled>${v(n)}</button>
            <button class="confirmation-btn cancel">\u0625\u0644\u063A\u0627\u0621</button>
          </div>
        </div>
      `,t.appendChild(e),E(t);let d=e.querySelector(".typed-confirmation-input"),u=e.querySelector(".typed-confirmation-confirm-btn"),r=e.querySelector(".cancel"),b=document.activeElement,f=()=>{let m=d.value===o;u.disabled=!m};d.addEventListener("input",f),requestAnimationFrame(()=>{t.classList.add("show"),e.classList.add("show"),d.focus()});let p=()=>{window.removeEventListener("keydown",w),t.classList.remove("show"),e.classList.remove("show"),setTimeout(()=>{t.parentNode&&t.parentNode.removeChild(t),b&&document.body.contains(b)&&b.focus()},300)},y=()=>{d.value===o&&(p(),i(!0))},l=()=>{p(),i(!1)},w=m=>{if(m.key==="Escape")m.stopPropagation(),l();else if(m.key==="Enter")m.preventDefault(),y();else if(m.key==="Tab"){let h=[d,u,r],L=h[0],g=h[h.length-1];m.shiftKey?document.activeElement===L&&(m.preventDefault(),g.focus()):document.activeElement===g&&(m.preventDefault(),L.focus())}};u.addEventListener("click",y),r.addEventListener("click",l),window.addEventListener("keydown",w),t.addEventListener("click",m=>{m.target===t&&l()})})}export{D as a,C as b,N as c,q as d,S as e};
