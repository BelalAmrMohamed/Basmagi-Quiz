// =============================================================================
// api/ai-agent/_botGenerators.js
// In-memory file builders for the Telegram bot. Each function takes structured
// data (title + questions or sections) and returns a Buffer ready to be sent
// via sendTelegramDocument().
//
// Exports:
//   generateStandaloneQuizHtml(title, questions)  → Buffer (.html)
//   generateQuizJson(title, questions, description) → Buffer (.json)
//   generateQuizMarkdown(title, questions)         → Buffer (.md)
//   generateLessonMarkdown(title, sections)        → Buffer (.md)
//   generateLessonJson(title, sections)            → Buffer (.json)
//   generateQuizPdf(title, questions)              → Promise<Buffer> (.pdf)
// =============================================================================

// ── 3.1: Standalone Interactive Quiz HTML ────────────────────────────────────

/**
 * Generates a single, zero-dependency HTML file containing an interactive quiz.
 * Includes dark/light mode, mobile responsive layout, option selection, instant
 * scoring, timer, and explanations. Works offline on any phone or laptop.
 *
 * @param {string} title
 * @param {Array<{q: string, options?: string[], correct?: number[], multiSelect?: boolean, answer?: string, explanation?: string}>} questions
 * @returns {Buffer}
 */
export function generateStandaloneQuizHtml(title, questions) {
  const safeTitle = escapeHtml(title);
  const questionsJson = JSON.stringify(questions);

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f172a;--surface:#1e293b;--surface2:#334155;--text:#f1f5f9;--text2:#94a3b8;--accent:#6366f1;--accent2:#818cf8;--correct:#22c55e;--wrong:#ef4444;--border:#475569;--radius:12px;--font:'Segoe UI',Tahoma,Arial,sans-serif}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;padding:16px;transition:background .3s,color .3s}
body.light{--bg:#f8fafc;--surface:#ffffff;--surface2:#e2e8f0;--text:#0f172a;--text2:#475569;--border:#cbd5e1}
.container{max-width:680px;margin:0 auto}
header{text-align:center;padding:24px 16px;margin-bottom:24px}
header h1{font-size:1.5rem;margin-bottom:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.meta{display:flex;justify-content:center;gap:16px;font-size:.875rem;color:var(--text2)}
.meta span{display:flex;align-items:center;gap:4px}
.controls{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.theme-toggle{background:var(--surface2);border:none;color:var(--text);padding:8px 12px;border-radius:8px;cursor:pointer;font-size:.8rem}
.timer{font-size:.9rem;color:var(--accent2);font-weight:600}
.question-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px;transition:border-color .3s}
.question-card.answered-correct{border-color:var(--correct)}
.question-card.answered-wrong{border-color:var(--wrong)}
.q-number{font-size:.75rem;color:var(--text2);margin-bottom:8px}
.q-text{font-size:1rem;line-height:1.6;margin-bottom:16px;white-space:pre-wrap}
.options{display:flex;flex-direction:column;gap:8px}
.option{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--surface2);border:2px solid transparent;border-radius:10px;cursor:pointer;transition:all .2s;font-size:.95rem;line-height:1.5}
.option:hover{border-color:var(--accent);transform:translateX(-2px)}
.option.selected{border-color:var(--accent);background:rgba(99,102,241,.15)}
.option.correct-reveal{border-color:var(--correct);background:rgba(34,197,94,.12)}
.option.wrong-reveal{border-color:var(--wrong);background:rgba(239,68,68,.12)}
.option .indicator{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;margin-top:2px}
.option.selected .indicator{border-color:var(--accent);background:var(--accent);color:#fff}
.option.correct-reveal .indicator{border-color:var(--correct);background:var(--correct);color:#fff}
.option.wrong-reveal .indicator{border-color:var(--wrong);background:var(--wrong);color:#fff}
.option.checkbox .indicator{border-radius:4px}
.essay-answer{margin-top:8px;padding:12px;background:var(--surface2);border-radius:8px;color:var(--text2);font-size:.9rem;line-height:1.5;display:none}
.essay-answer.visible{display:block}
.explanation{margin-top:12px;padding:12px;background:rgba(99,102,241,.08);border-right:3px solid var(--accent);border-radius:0 8px 8px 0;font-size:.875rem;color:var(--text2);line-height:1.5;display:none;white-space:pre-wrap}
.explanation.visible{display:block}
.btn-show{margin-top:8px;background:none;border:1px solid var(--border);color:var(--text2);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:.8rem}
.btn-show:hover{border-color:var(--accent);color:var(--accent)}
.results{text-align:center;padding:32px 20px;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border);margin-top:24px;display:none}
.results.visible{display:block}
.results .score{font-size:2.5rem;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.results .label{color:var(--text2);font-size:1rem;margin-top:8px}
.results .bar{width:100%;height:10px;background:var(--surface2);border-radius:5px;margin:16px 0;overflow:hidden}
.results .bar .fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--correct));border-radius:5px;transition:width 1s ease}
.submit-btn{display:block;width:100%;padding:14px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;border-radius:var(--radius);font-size:1.05rem;font-weight:600;cursor:pointer;margin-top:20px;transition:opacity .2s}
.submit-btn:hover{opacity:.9}
.submit-btn:disabled{opacity:.5;cursor:not-allowed}
.footer{text-align:center;margin-top:24px;padding:16px;font-size:.75rem;color:var(--text2)}
.footer a{color:var(--accent2);text-decoration:none}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${safeTitle}</h1>
    <div class="meta">
      <span>📝 <span id="qCount"></span> سؤال</span>
      <span>⏱️ <span class="timer" id="timer">00:00</span></span>
    </div>
  </header>
  <div class="controls">
    <button class="theme-toggle" onclick="toggleTheme()">🌓 تغيير السمة</button>
  </div>
  <div id="questions"></div>
  <button class="submit-btn" id="submitBtn" onclick="submitQuiz()">📊 عرض النتيجة</button>
  <div class="results" id="results">
    <div class="score" id="scoreText"></div>
    <div class="label" id="scoreLabel"></div>
    <div class="bar"><div class="fill" id="scoreFill"></div></div>
  </div>
  <div class="footer">
    تم إنشاؤه بواسطة <a href="https://basmagi-quiz.vercel.app" target="_blank">منصة امتحانات بصمجي</a>
  </div>
</div>

<script>
const questions=${questionsJson};
let timerSeconds=0,timerInterval=null,submitted=false;
const selections={};

document.getElementById('qCount').textContent=questions.length;

// Timer
timerInterval=setInterval(()=>{
  timerSeconds++;
  const m=String(Math.floor(timerSeconds/60)).padStart(2,'0');
  const s=String(timerSeconds%60).padStart(2,'0');
  document.getElementById('timer').textContent=m+':'+s;
},1000);

// Render questions
const container=document.getElementById('questions');
questions.forEach((q,qi)=>{
  const card=document.createElement('div');
  card.className='question-card';
  card.id='q'+qi;

  let html='<div class="q-number">سؤال '+(qi+1)+'</div>';
  html+='<div class="q-text">'+esc(q.q)+'</div>';

  if(Array.isArray(q.options)&&q.options.length){
    const isMulti=q.multiSelect===true;
    html+='<div class="options">';
    q.options.forEach((opt,oi)=>{
      html+='<div class="option'+(isMulti?' checkbox':'')+'" data-qi="'+qi+'" data-oi="'+oi+'" onclick="selectOption('+qi+','+oi+','+isMulti+')">';
      html+='<div class="indicator"></div>';
      html+='<div>'+esc(opt)+'</div>';
      html+='</div>';
    });
    html+='</div>';
  } else if(q.answer){
    html+='<button class="btn-show" onclick="this.nextElementSibling.classList.toggle(\\'visible\\');this.textContent=this.nextElementSibling.classList.contains(\\'visible\\')?\\'\u{1F648} إخفاء الإجابة\\':\\'\u{1F4A1} عرض الإجابة\\'">💡 عرض الإجابة</button>';
    html+='<div class="essay-answer">'+esc(q.answer)+'</div>';
  }

  if(q.explanation){
    html+='<button class="btn-show" onclick="this.nextElementSibling.classList.toggle(\\'visible\\');this.textContent=this.nextElementSibling.classList.contains(\\'visible\\')?\\'\u{1F648} إخفاء الشرح\\':\\'\u{1F4D6} عرض الشرح\\'">📖 عرض الشرح</button>';
    html+='<div class="explanation">'+esc(q.explanation)+'</div>';
  }

  card.innerHTML=html;
  container.appendChild(card);
});

function selectOption(qi,oi,isMulti){
  if(submitted)return;
  if(!selections[qi])selections[qi]=new Set();
  if(isMulti){
    if(selections[qi].has(oi))selections[qi].delete(oi);
    else selections[qi].add(oi);
  } else {
    selections[qi]=new Set([oi]);
  }
  // Update UI
  document.querySelectorAll('[data-qi="'+qi+'"]').forEach(el=>{
    const idx=parseInt(el.dataset.oi);
    el.classList.toggle('selected',selections[qi].has(idx));
    el.querySelector('.indicator').textContent=selections[qi].has(idx)?'✓':'';
  });
}

function submitQuiz(){
  if(submitted)return;
  submitted=true;
  clearInterval(timerInterval);

  let correct=0;
  questions.forEach((q,qi)=>{
    if(!Array.isArray(q.options)||!q.options.length||!Array.isArray(q.correct))return;
    const userSet=selections[qi]||new Set();
    const correctSet=new Set(q.correct);
    const isCorrect=userSet.size===correctSet.size&&[...userSet].every(v=>correctSet.has(v));
    if(isCorrect)correct++;

    const card=document.getElementById('q'+qi);
    card.classList.add(isCorrect?'answered-correct':'answered-wrong');
    document.querySelectorAll('[data-qi="'+qi+'"]').forEach(el=>{
      const idx=parseInt(el.dataset.oi);
      if(correctSet.has(idx))el.classList.add('correct-reveal');
      else if(userSet.has(idx))el.classList.add('wrong-reveal');
      el.style.cursor='default';
    });
    // Show explanations
    card.querySelectorAll('.explanation').forEach(e=>e.classList.add('visible'));
  });

  const scorable=questions.filter(q=>Array.isArray(q.options)&&q.options.length&&Array.isArray(q.correct)).length;
  const pct=scorable?Math.round((correct/scorable)*100):0;
  document.getElementById('scoreText').textContent=pct+'%';
  document.getElementById('scoreLabel').textContent=correct+' من '+scorable+' إجابة صحيحة';
  document.getElementById('scoreFill').style.width=pct+'%';
  document.getElementById('results').classList.add('visible');
  document.getElementById('submitBtn').disabled=true;
  document.getElementById('results').scrollIntoView({behavior:'smooth'});
}

function toggleTheme(){document.body.classList.toggle('light')}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
</script>
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}

// ── 3.2: Platform-compatible Quiz JSON ───────────────────────────────────────

/**
 * Generates a JSON file matching the platform's quiz schema.
 * Can be imported directly via the "استيراد ملف JSON" button.
 *
 * @param {string} title
 * @param {Array} questions
 * @param {string} [description]
 * @returns {Buffer}
 */
export function generateQuizJson(title, questions, description = "") {
  const data = {
    title,
    description,
    questions: questions.map((q) => {
      const entry = { q: q.q };
      if (Array.isArray(q.options)) entry.options = q.options;
      if (Array.isArray(q.correct)) {
        // Platform schema: single-answer stores integer, multi stores array
        entry.correct = q.correct.length === 1 ? q.correct[0] : q.correct;
      }
      if (q.multiSelect !== undefined) entry.multiSelect = q.multiSelect;
      if (q.answer) entry.answer = q.answer;
      if (q.explanation) entry.explanation = q.explanation;
      return entry;
    }),
  };
  return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
}

// ── 3.3: Quiz Markdown ──────────────────────────────────────────────────────

/**
 * Formats questions in readable GitHub-flavored Markdown.
 *
 * @param {string} title
 * @param {Array} questions
 * @returns {Buffer}
 */
export function generateQuizMarkdown(title, questions) {
  let md = `# ${title}\n\n`;
  md += `> ${questions.length} سؤال\n\n---\n\n`;

  questions.forEach((q, i) => {
    md += `### سؤال ${i + 1}\n\n`;
    md += `${q.q}\n\n`;

    if (Array.isArray(q.options) && q.options.length) {
      const correctSet = new Set(q.correct || []);
      q.options.forEach((opt, oi) => {
        const marker = correctSet.has(oi) ? "✅" : "⬜";
        const letter = String.fromCharCode(65 + oi); // A, B, C, D...
        md += `${marker} **${letter}.** ${opt}\n`;
      });
      md += "\n";

      if (q.correct && q.correct.length) {
        const correctLetters = q.correct
          .map((ci) => String.fromCharCode(65 + ci))
          .join(", ");
        md += `**الإجابة الصحيحة:** ${correctLetters}\n\n`;
      }
    }

    if (q.answer) {
      md += `**الإجابة:** ${q.answer}\n\n`;
    }

    if (q.explanation) {
      md += `> **الشرح:** ${q.explanation}\n\n`;
    }

    md += `---\n\n`;
  });

  md += `\n*تم إنشاؤه بواسطة [منصة امتحانات بصمجي](https://basmagi-quiz.vercel.app)*\n`;
  return Buffer.from(md, "utf-8");
}

// ── 3.4: Lesson Markdown & JSON ─────────────────────────────────────────────

/**
 * @param {string} title
 * @param {Array<{title: string, content: string, questions?: Array}>} sections
 * @returns {Buffer}
 */
export function generateLessonMarkdown(title, sections) {
  let md = `# ${title}\n\n`;

  sections.forEach((sec) => {
    md += `## ${sec.title}\n\n`;
    md += `${sec.content}\n\n`;

    if (Array.isArray(sec.questions) && sec.questions.length) {
      md += `### أسئلة على هذا القسم\n\n`;
      sec.questions.forEach((q, qi) => {
        md += `${qi + 1}. ${q.q || q.prompt || ""}\n`;
        if (Array.isArray(q.options)) {
          q.options.forEach((opt, oi) => {
            md += `   ${String.fromCharCode(65 + oi)}. ${opt}\n`;
          });
        }
        if (q.answer || q.modelAnswer) {
          md += `   **الإجابة:** ${q.answer || q.modelAnswer}\n`;
        }
        md += "\n";
      });
    }

    md += `---\n\n`;
  });

  return Buffer.from(md, "utf-8");
}

/**
 * @param {string} title
 * @param {Array<{title: string, content: string, questions?: Array}>} sections
 * @returns {Buffer}
 */
export function generateLessonJson(title, sections) {
  return Buffer.from(JSON.stringify({ title, sections }, null, 2), "utf-8");
}

// ── 3.5: Quiz PDF (pdfkit) ─────────────────────────────────────────────────

/**
 * Generates a cleanly paginated PDF with header, questions, options, and answers.
 *
 * @param {string} title
 * @param {Array} questions
 * @returns {Promise<Buffer>}
 */
export async function generateQuizPdf(title, questions) {
  // Dynamic import — pdfkit is a production dependency
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: title,
        Author: "Basmagi Quiz Platform",
        Creator: "El-Bashmebasamag Bot",
      },
    });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title page header
    doc.fontSize(22).text(title, { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .fillColor("#666")
      .text(`${questions.length} questions`, { align: "center" });
    doc.moveDown(1.5);
    doc.fillColor("#000");

    questions.forEach((q, i) => {
      // Check if we need a new page (leave room for at least the question + 2 options)
      if (doc.y > 680) doc.addPage();

      // Question number + text
      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .text(`Q${i + 1}. `, { continued: true })
        .font("Helvetica")
        .text(q.q || "");
      doc.moveDown(0.3);

      // Options
      if (Array.isArray(q.options) && q.options.length) {
        const correctSet = new Set(q.correct || []);
        q.options.forEach((opt, oi) => {
          const letter = String.fromCharCode(65 + oi);
          const mark = correctSet.has(oi) ? " ✓" : "";
          doc.fontSize(11).text(`    ${letter}. ${opt}${mark}`);
        });
        doc.moveDown(0.3);
      }

      // Essay answer
      if (q.answer) {
        doc
          .fontSize(10)
          .fillColor("#2563eb")
          .text(`Answer: ${q.answer}`)
          .fillColor("#000");
        doc.moveDown(0.2);
      }

      // Explanation
      if (q.explanation) {
        doc
          .fontSize(10)
          .fillColor("#7c3aed")
          .text(`Explanation: ${q.explanation}`)
          .fillColor("#000");
        doc.moveDown(0.2);
      }

      doc.moveDown(0.5);
    });

    // Footer
    doc
      .fontSize(8)
      .fillColor("#999")
      .text("Generated by Basmagi Quiz Platform — basmagi-quiz.vercel.app", {
        align: "center",
      });

    doc.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
