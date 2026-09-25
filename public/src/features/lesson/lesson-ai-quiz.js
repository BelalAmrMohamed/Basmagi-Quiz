import { escapeHtml } from "../home/escape-html.js";

let activeQuiz = null;
const norm = (v) => String(v ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function createLessonQuiz(input = {}) {
  const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 50).map((q, i) => {
    const type = ({ mcq: "multiple-choice", multiple_choice: "multiple-choice", tf: "true-false", boolean: "true-false", fill: "fill-blank", short: "short-answer" })[q.type] || q.type || "multiple-choice";
    if (!q || !String(q.question || q.prompt || "").trim()) return null;
    if (!["multiple-choice", "true-false", "fill-blank", "short-answer"].includes(type)) return null;
    return { id: `q${i}`, type, question: String(q.question || q.prompt).slice(0, 2000), options: type === "true-false" ? ["صح", "خطأ"] : (Array.isArray(q.options) ? q.options.slice(0, 10).map(String) : []), answer: q.correct ?? q.answer ?? q.correctAnswer ?? "", accepted: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : [], explanation: String(q.explanation || q.feedback || "").slice(0, 2000) };
  }).filter(Boolean);
  if (!questions.length) throw new Error("لا توجد أسئلة صالحة لإنشاء تدريب.");
  activeQuiz = { title: String(input.title || "تدريب سريع من الدرس").slice(0, 160), questions, answers: {}, graded: false };
  return activeQuiz;
}
export function renderLessonQuiz() {
  if (!activeQuiz) return "";
  const qhtml = activeQuiz.questions.map((q, i) => {
    const choices = q.type === "multiple-choice" || q.type === "true-false";
    const control = choices ? `<div class="lesson-ai-quiz__options">${q.options.map((o,j)=>`<label><input type="${q.type === "multiple-choice" ? "radio" : "radio"}" name="${q.id}" value="${j}" ${activeQuiz.answers[q.id] === String(j) ? "checked" : ""} ${activeQuiz.graded ? "disabled" : ""}> ${escapeHtml(o)}</label>`).join("")}</div>` : `<input class="lesson-ai-quiz__text" data-answer="${q.id}" value="${escapeHtml(activeQuiz.answers[q.id] || "")}" ${activeQuiz.graded ? "disabled" : ""} aria-label="الإجابة">`;
    const correct = q.type === "multiple-choice" || q.type === "true-false" ? String(activeQuiz.answers[q.id]) === String(q.answer) : [q.answer, ...q.accepted].some(a => norm(a) && norm(a) === norm(activeQuiz.answers[q.id]));
    return `<fieldset class="lesson-ai-quiz__question"><legend>${i+1}. ${escapeHtml(q.question)}</legend>${control}${activeQuiz.graded ? `<p class="${correct ? "is-correct" : "is-incorrect"}">${correct ? "إجابة صحيحة" : `الإجابة: ${escapeHtml(Array.isArray(q.answer) ? q.answer.join("، ") : q.answer)}`}${q.explanation ? ` — ${escapeHtml(q.explanation)}` : ""}</p>` : ""}</fieldset>`;
  }).join("");
  const score = activeQuiz.questions.filter(q => { const a=activeQuiz.answers[q.id]; return (q.type === "multiple-choice" || q.type === "true-false") ? String(a) === String(q.answer) : [q.answer,...q.accepted].some(x=>norm(x)&&norm(x)===norm(a)); }).length;
  return `<section class="lesson-ai-quiz" aria-label="تدريب من الدرس"><header><div><h2>${escapeHtml(activeQuiz.title)}</h2><p>تدريب مؤقت — لا يُضاف إلى امتحاناتك</p></div><button type="button" data-quiz-close aria-label="إغلاق التدريب">×</button></header>${qhtml}<footer>${activeQuiz.graded ? `<strong>النتيجة: ${score} / ${activeQuiz.questions.length}</strong><button type="button" data-quiz-reset>إعادة المحاولة</button>` : `<button type="button" data-quiz-grade>تحقق من الإجابات</button>`}</footer></section>`;
}
export function equipLessonQuiz(root, rerender) {
  root.querySelector("[data-quiz-close]")?.addEventListener("click", () => { activeQuiz = null; rerender(); });
  root.querySelectorAll('input[name^="q"]').forEach(el => el.addEventListener("change", () => { if (activeQuiz) activeQuiz.answers[el.name] = el.value; }));
  root.querySelectorAll("[data-answer]").forEach(el => el.addEventListener("input", () => { if (activeQuiz) activeQuiz.answers[el.dataset.answer] = el.value; }));
  root.querySelector("[data-quiz-grade]")?.addEventListener("click", () => { if (activeQuiz) activeQuiz.graded = true; rerender(); });
  root.querySelector("[data-quiz-reset]")?.addEventListener("click", () => { if (activeQuiz) { activeQuiz.answers = {}; activeQuiz.graded = false; } rerender(); });
}
