import{a as M,e as Q,f as L}from"./chunk-J5BBYOFQ.js";import{a as b}from"./chunk-JOVBCH5E.js";var o=l=>l==null?"":String(l).replace(/\n/g,`  
`);function j(l,m,c=[],x={}){let{includeAnswers:p=!0,includeUserAnswers:C=!0,includeExplanations:y=!0,answerPlacement:r="inline"}=x,A=!1,g=!1,T=!1;m.forEach(e=>{M(e)?T=!0:e.options&&e.options.length===2?g=!0:A=!0});let w="";T&&!A&&!g?w="Essay/Definitions":T?w="Mixed (MCQ, True/False, Essay)":A&&g?w="MCQ and True/False":g?w="True/False only":w="MCQ only";let S=C&&c&&(Array.isArray(c)?c.length>0:Object.keys(c).length>0),h=[],n=`# ${l.title||"Quiz"}
- **Number of questions:** ${m.length}
- **Questions' type:** ${w}

`;if(S&&p){let{mcqCorrect:e,mcqWrong:f,mcqSkipped:i,mcqTotal:s,essayCount:a,essayScoreTotal:d,essayMaxTotal:$,percentage:u,actualPercentage:t}=L(m,c),E=e+d,R=s+$,F=t>=70?"\u2705 Passed":"\u274C Not Passed";if(n+=`## \u{1F4CA} Your Results

`,n+=`| Metric | Value |
|--------|-------|
`,n+=`| **Overall Score** | ${E} / ${R} pts (${t}%) |
`,n+=`| **Status** | ${F} |
`,s>0&&(n+=`| \u2713 MCQ Correct | ${e} / ${s} (${u}%)|
`,n+=`| \u2717 MCQ Wrong | ${f} |
`,n+=`| \u26AA Skipped | ${i} |
`),a>0){let k=Math.round(d/$*5),N="\u2605".repeat(k)+"\u2606".repeat(5-k);n+=`| \u270F\uFE0F Essay Score | ${d} / ${$} pts  ${N} |
`}n+=`
---

`}else n+=`---

`;return m.forEach((e,f)=>{let i=c[f];if(n+=`## Question ${f+1}
`,n+=`${o(e.q)}

`,M(e)){if(S){let s=i||"";if(n+=`**Your Answer:**

${o(s||"\u0644\u0645 \u062A\u064F\u062C\u0650\u0628")}

`,p){let a=Q(s,e.answer),d="\u2605".repeat(a)+"\u2606".repeat(5-a),$=a>=3?"\u2705":a>=1?"\u26A0\uFE0F":"\u274C";n+=`**Score:** ${$} ${a}/5  ${d}

`}}p&&(r==="final-page"?h.push({index:f,answerText:`**Formal Answer:** ${o(e.answer)}`}):n+=`**Formal Answer:** ${o(e.answer)}

`)}else if(!Array.isArray(e.options)||e.options.length===0)p&&e.answer?r==="final-page"?h.push({index:f,answerText:`**Answer:** ${o(e.answer)}`}):n+=`**Answer:** ${o(e.answer)}

`:n+=`*No answer options available for this question.*

`;else{e.options.forEach((u,t)=>{let E=String.fromCharCode(48+t+1);n+=`${E}. ${o(u)}
`}),n+=`
`;let s=e.correct??e.answer,a=Array.isArray(s)?s:[s],d=Array.isArray(i)?i:[i],$=i==null||Array.isArray(i)&&i.length===0;if(S){let u=$?"Skipped":d.filter(t=>Number.isInteger(t)).map(t=>`${String.fromCharCode(48+t+1)}. ${o(e.options[t])}`).join("; ");n+=`**Your Answer:** ${u||"Skipped"}

`}if(p){let u=a.filter(t=>Number.isInteger(t)&&e.options[t]!==void 0).map(t=>`${String.fromCharCode(48+t+1)}. ${o(e.options[t])}`).join("; ");r==="final-page"?h.push({index:f,answerText:`**Correct Answer:** ${u}`}):n+=`**Correct Answer:** ${u}

`}}if(y&&e.explanation)if(r==="final-page"){let s=h.find(a=>a.index===f);s?s.explanationText=o(e.explanation):n+=`> **Explanation:**
${o(e.explanation)}

`}else n+=`> **Explanation:**
${o(e.explanation)}

`;n+=`---

`}),p&&r==="final-page"&&h.length&&(n+=`## \u{1F511} Answer Key

`,h.forEach(e=>{n+=`### Question ${e.index+1}

`,n+=`- ${e.answerText}
`,e.explanationText&&(n+=`- **Explanation:** ${e.explanationText}
`),n+=`
`})),n}function U(l,m,c=[],x={}){let p=j(l,m,c,x),C=new Blob([p],{type:"text/markdown;charset=utf-8"}),y=URL.createObjectURL(C),r=document.createElement("a");r.href=y,r.download=`${l.title||"quiz_export"}.md`,document.body.appendChild(r),r.click(),document.body.removeChild(r),URL.revokeObjectURL(y),b("Markdown file downloaded.","You have it now","./assets/images/mardownIcon.png")}export{j as buildQuizMarkdown,U as exportToMarkdown};
