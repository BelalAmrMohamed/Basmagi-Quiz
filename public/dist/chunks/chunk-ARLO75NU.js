var p=Object.freeze({ArrowRight:"next",ArrowLeft:"prev",ArrowDown:"option-next",ArrowUp:"option-prev",1:"select-0",2:"select-1",3:"select-2",4:"select-3",5:"select-4",6:"select-5",7:"select-6",8:"select-7",9:"select-8",Enter:"check",b:"bookmark",f:"flag","?":"help"});function u(){let e=document.activeElement,r=e?.tagName;if(r==="TEXTAREA")return!0;if(r==="INPUT"){let t=(e.type||"text").toLowerCase();if(t!=="radio"&&t!=="checkbox")return!0}return!!document.querySelector(".confirmation-overlay.show")}function d(){let e=document.querySelectorAll(".question-card");if(e.length===0)return null;if(e.length===1)return e[0];let r=document.activeElement?.closest(".question-card");if(r)return r;let t=window.innerHeight/2,a=null,o=1/0;return e.forEach(i=>{let s=i.getBoundingClientRect();if(s.bottom<0||s.top>window.innerHeight)return;let n=s.top+s.height/2,l=Math.abs(n-t);l<o&&(o=l,a=i)}),a||e[0]}function b(e){let r=d();if(!r)return-1;let t=Array.from(r.querySelectorAll(".option-row:not(.locked) input"));if(t.length===0)return-1;let a=t.indexOf(document.activeElement),o;if(a===-1){let i=t.findIndex(s=>s.checked);i>=0?o=(i+e+t.length)%t.length:o=e===1?0:t.length-1}else o=(a+e+t.length)%t.length;return t[o].focus(),o}function m(){let e=document.getElementById("shortcutModal");if(!e)return;e.hasAttribute("hidden")?(e.removeAttribute("hidden"),e.style.display="flex"):(e.setAttribute("hidden",""),e.style.display="none")}function f({onSelect:e,onCheck:r,onNext:t,onPrev:a,onBookmark:o,onFlag:i}={}){document.addEventListener("keydown",s=>{if(u())return;let n=p[s.key];if(n){if(n==="option-next"||n==="option-prev"){let l=b(n==="option-next"?1:-1);if(l>=0){s.preventDefault();let c=d()?.querySelectorAll(".option-row:not(.locked) input")?.[l];c&&c.type!=="checkbox"&&e?.(l)}return}switch(s.preventDefault(),n){case"next":t?.();break;case"prev":a?.();break;case"select-0":case"select-1":case"select-2":case"select-3":case"select-4":case"select-5":case"select-6":case"select-7":case"select-8":e?.(Number(n.split("-")[1]));break;case"check":r?.();break;case"bookmark":o?.();break;case"flag":i?.();break;case"help":m();break}}})}function g(e=[["\u2192","Next question"],["\u2190","Previous question"],["\u2191 / \u2193","Select neighbouring option"],["1 \u2013 9","Select option by index"],["Enter","Check / submit answer"],["B","Bookmark question"],["F","Flag question"],["?","Toggle this help"]]){return`
<div
  id="shortcutModal"
  hidden
  role="dialog"
  aria-modal="true"
  aria-labelledby="shortcutModalTitle"
  style="
    position: fixed;
    inset: 0;
    z-index: var(--z-modal-top, 11000);
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: var(--glass-blur, blur(12px));
    -webkit-backdrop-filter: var(--glass-blur, blur(12px));
    padding: var(--space-md, 1rem);
    display: none;
  "
>
  <!-- Scrim: close on outside click -->
  <div
    onclick="
      this.parentElement.setAttribute('hidden', '');
      this.parentElement.style.display = 'none';
    "
    style="position: absolute; inset: 0; cursor: default;"
    aria-hidden="true"
  ></div>

  <!-- Panel -->
  <div
    class="shortcut-modal"
    role="document"
    style="
      position: relative;
      background: var(--glass-bg-light, rgba(255, 255, 255, 0.65));
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      backdrop-filter: var(--glass-blur, blur(12px));
      -webkit-backdrop-filter: var(--glass-blur, blur(12px));
      box-shadow:
        var(--glass-inset, inset 0 1px 0 rgba(255, 255, 255, 0.1)),
        var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.1));
      border-radius: var(--radius-xl, 16px);
      padding: var(--space-xl, 2rem);
      min-width: 300px;
      max-width: 460px;
      width: 100%;
    "
  >
    <!-- Header -->
    <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-lg, 1.5rem);
        gap: var(--space-md, 1rem);
    ">
      <h2
        id="shortcutModalTitle"
        style="
          margin: 0;
          font-size: var(--font-size-xl, 1.25rem);
          font-weight: 700;
          color: var(--color-text-primary, #111827);
          display: flex;
          align-items: center;
          gap: var(--space-sm, 0.5rem);
        "
      >
        <span aria-hidden="true">\u2328\uFE0F</span> Keyboard Shortcuts
      </h2>
      <button
        type="button"
        aria-label="Close keyboard shortcuts help"
        onclick="
          this.closest('#shortcutModal').setAttribute('hidden', '');
          this.closest('#shortcutModal').style.display = 'none';
        "
        style="
          flex-shrink: 0;
          background: none;
          border: 1px solid var(--color-border, #e5e7eb);
          cursor: pointer;
          color: var(--color-text-secondary, #6b7280);
          font-size: var(--font-size-base, 1rem);
          line-height: 1;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-md, 8px);
          transition: background var(--transition-fast, 0.15s ease),
                      color var(--transition-fast, 0.15s ease);
        "
        onmouseover="this.style.background='var(--color-hover-overlay, rgba(99,102,241,0.06))'; this.style.color='var(--color-text-primary, #111827)';"
        onmouseout="this.style.background='none'; this.style.color='var(--color-text-secondary, #6b7280)';"
      >\u2715</button>
    </div>

    <!-- Shortcut table -->
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="
              text-align: left;
              padding: var(--space-xs, 0.25rem) var(--space-sm, 0.5rem)
                       var(--space-xs, 0.25rem) 0;
              color: var(--color-text-secondary, #6b7280);
              font-size: var(--font-size-xs, 0.75rem);
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              border-bottom: 1px solid var(--color-border, #e5e7eb);
          ">Key</th>
          <th style="
              text-align: left;
              padding: var(--space-xs, 0.25rem) var(--space-sm, 0.5rem);
              color: var(--color-text-secondary, #6b7280);
              font-size: var(--font-size-xs, 0.75rem);
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              border-bottom: 1px solid var(--color-border, #e5e7eb);
          ">Action</th>
        </tr>
      </thead>
      <tbody>${e.map(([t,a])=>`
      <tr>
        <td style="
            padding: var(--space-sm, 0.5rem) var(--space-sm, 0.5rem)
                     var(--space-sm, 0.5rem) 0;
            vertical-align: middle;
            white-space: nowrap;
        ">
          <kbd style="
              display: inline-block;
              background: var(--color-background-secondary, #f3f4f6);
              border: 1px solid var(--color-border, #e5e7eb);
              border-radius: var(--radius-sm, 4px);
              padding: 2px 8px;
              font-family: ui-monospace, 'Cascadia Code', monospace;
              font-size: var(--font-size-xs, 0.75rem);
              color: var(--color-text-primary, #111827);
              box-shadow: var(--shadow-sm);
              white-space: nowrap;
          ">${t}</kbd>
        </td>
        <td style="
            padding: var(--space-sm, 0.5rem);
            color: var(--color-text-primary, #111827);
            font-size: var(--font-size-sm, 0.875rem);
            vertical-align: middle;
        ">${a}</td>
      </tr>`).join("")}</tbody>
    </table>

    <!-- Footer note -->
    <p style="
        margin: var(--space-lg, 1.5rem) 0 0;
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--color-text-tertiary, #9ca3af);
        text-align: center;
        line-height: var(--line-height-base, 1.6);
    ">
      Shortcuts are disabled while typing in text fields or during confirmation dialogs.
    </p>
  </div>
</div>`.trim()}export{m as a,f as b,g as c};
