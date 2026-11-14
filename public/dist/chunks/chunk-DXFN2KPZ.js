var r=2*Math.PI*61,E={Beginner:{key:"beginner",label:"\u0645\u0628\u062A\u062F\u0626",from:"#60a5fa",to:"#3b82f6"},Intermediate:{key:"intermediate",label:"\u0645\u062A\u0648\u0633\u0637",from:"#34d399",to:"#059669"},Advanced:{key:"advanced",label:"\u0645\u062A\u0642\u062F\u0651\u0645",from:"#a78bfa",to:"#7c3aed"},Expert:{key:"expert",label:"\u062E\u0628\u064A\u0631",from:"#fb923c",to:"#ea580c"},Master:{key:"master",label:"\u0645\u062D\u062A\u0631\u0641",from:"#f472b6",to:"#db2777"},Grandmaster:{key:"grandmaster",label:"\u0623\u0633\u0637\u0648\u0631\u0629",from:"#fbbf24",to:"#b45309"},\u0645\u0628\u062A\u062F\u0626:{key:"beginner",label:"\u0645\u0628\u062A\u062F\u0626",from:"#60a5fa",to:"#3b82f6"},\u0645\u062A\u0648\u0633\u0637:{key:"intermediate",label:"\u0645\u062A\u0648\u0633\u0637",from:"#34d399",to:"#059669"},\u0645\u062A\u0642\u062F\u0645:{key:"advanced",label:"\u0645\u062A\u0642\u062F\u0651\u0645",from:"#a78bfa",to:"#7c3aed"},\u062E\u0628\u064A\u0631:{key:"expert",label:"\u062E\u0628\u064A\u0631",from:"#fb923c",to:"#ea580c"},\u0623\u0633\u0637\u0648\u0631\u0629:{key:"master",label:"\u0623\u0633\u0637\u0648\u0631\u0629",from:"#f472b6",to:"#db2777"},\u0645\u0639\u0644\u0645:{key:"grandmaster",label:"\u0645\u0639\u0644\u0645",from:"#fbbf24",to:"#b45309"}},S={key:"beginner",label:"\u0645\u0628\u062A\u062F\u0626",from:"#60a5fa",to:"#3b82f6"};function k(e){return E[e]||S}function I(e){e.innerHTML=`
    <div class="level-gauge" role="img">
      <svg viewBox="0 0 132 132" class="level-gauge-svg">
        <defs>
          <linearGradient id="levelGaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop class="level-gauge-stop-start" offset="0%" />
            <stop class="level-gauge-stop-end" offset="100%" />
          </linearGradient>
        </defs>
        <circle
          class="level-gauge-track"
          cx="${132/2}" cy="${132/2}" r="61"
          fill="none" stroke-width="10"
        />
        <circle
          class="level-gauge-fill"
          cx="${132/2}" cy="${132/2}" r="61"
          fill="none" stroke-width="10" stroke-linecap="round"
          stroke="url(#levelGaugeGradient)"
          stroke-dasharray="${r}"
          stroke-dashoffset="${r}"
          transform="rotate(-90 ${132/2} ${132/2})"
        />
      </svg>
      <div class="level-gauge-center">
        <span class="level-gauge-number" id="levelGaugeNumber">1</span>
        <span class="level-gauge-tier" id="levelGaugeTier">\u0645\u0628\u062A\u062F\u0626</span>
      </div>
    </div>
    <div class="level-gauge-info">
      <div class="level-gauge-heading">
        <h3 id="levelGaugeTitle">\u0627\u0644\u0645\u0633\u062A\u0648\u0649 1</h3>
        <span class="level-gauge-pct" id="levelGaugePct">0%</span>
      </div>
      <p class="level-gauge-xp" id="levelGaugeXp">0 / 100 \u0646\u0642\u0637\u0629 \u062E\u0628\u0631\u0629</p>
      <p class="level-gauge-remaining" id="levelGaugeRemaining">100 \u0646\u0642\u0637\u0629 \u0644\u0644\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u062A\u0627\u0644\u064A</p>
    </div>
  `}function $(e){let t=document.getElementById("identityLevel");if(!t)return;t.querySelector(".level-gauge")||I(t);let l=e.level|0,o=Math.min(100,Math.max(0,e.progressPercent||0)),n=k(e.title),b=t.querySelector(".level-gauge-fill"),a=t.querySelector(".level-gauge"),s=t.querySelector(".level-gauge-stop-start"),i=t.querySelector(".level-gauge-stop-end"),g=Number(a.dataset.level||0);a.dataset.level=String(l),a.dataset.tier=n.key,s&&(s.style.stopColor=n.from),i&&(i.style.stopColor=n.to);let p=r*(1-o/100);requestAnimationFrame(()=>{b.style.strokeDashoffset=String(p)}),g>0&&l>g&&(a.classList.remove("level-gauge-leveled-up"),a.offsetWidth,a.classList.add("level-gauge-leveled-up"));let c=document.getElementById("levelGaugeNumber"),d=document.getElementById("levelGaugeTier"),u=document.getElementById("levelGaugeTitle"),f=document.getElementById("levelGaugePct"),v=document.getElementById("levelGaugeXp"),m=document.getElementById("levelGaugeRemaining");if(c&&(c.textContent=l),d&&(d.textContent=n.label),u&&(u.textContent=`\u0627\u0644\u0645\u0633\u062A\u0648\u0649 ${l}`),f&&(f.textContent=`${Math.round(o)}%`),v&&(v.textContent=`${Math.round(e.pointsInCurrentLevel||0).toLocaleString()} / ${Math.round(e.pointsNeededForNext||0).toLocaleString()} \u0646\u0642\u0637\u0629 \u062E\u0628\u0631\u0629`),m){let y=Math.max(0,Math.round((e.pointsNeededForNext||0)-(e.pointsInCurrentLevel||0)));m.textContent=l>=30?"\u0628\u0644\u063A\u062A \u0623\u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649\u060C \u0627\u0633\u062A\u0645\u0631 \u0644\u0644\u062D\u0641\u0627\u0638 \u0639\u0644\u0649 \u0645\u0643\u0627\u0646\u062A\u0643!":`${y.toLocaleString()} \u0646\u0642\u0637\u0629 \u0644\u0644\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u062A\u0627\u0644\u064A`}t.setAttribute("aria-label",`\u0627\u0644\u0645\u0633\u062A\u0648\u0649 ${l}\u060C ${n.label}\u060C ${Math.round(o)}% \u0646\u062D\u0648 \u0627\u0644\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u062A\u0627\u0644\u064A`)}export{$ as a};
