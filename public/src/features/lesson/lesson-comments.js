import { escapeHtml } from "../home/escape-html.js";

export function renderLessonComments() {
  return `<section class="lesson-comments" aria-labelledby="lessonCommentsTitle">
    <h2 id="lessonCommentsTitle">أسئلة الطلاب</h2>
    <p class="lesson-comments__hint">تظهر الأسئلة بعد مراجعتها. سيظهر اسمك للآخرين باسم Student فقط.</p>
    <div class="lesson-comments__list">جارٍ تحميل الأسئلة…</div>
    <form class="lesson-comments__form">
      <label>اسأل عن هذا الدرس<textarea maxlength="2000" required placeholder="اكتب سؤالك هنا…"></textarea></label>
      <button type="submit">إرسال السؤال</button>
    </form>
  </section>`;
}

export function equipLessonComments(root, lessonId) {
  const section = root.querySelector(".lesson-comments");
  if (!section || !lessonId) return;
  const list = section.querySelector(".lesson-comments__list");
  const load = async () => {
    try {
      const res = await fetch(`/api/college-quiz?lessonComments=true&lessonId=${encodeURIComponent(lessonId)}`);
      const data = await res.json();
      const comments = data.comments || [];
      list.innerHTML = comments.length ? comments.map((comment) => `<article class="lesson-comment"><strong>Student</strong><time>${new Date(comment.created_at).toLocaleDateString("ar-EG")}</time><p>${escapeHtml(comment.body)}</p></article>`).join("") : "لا توجد أسئلة تمت مراجعتها بعد.";
    } catch (_) { list.textContent = "تعذر تحميل الأسئلة حالياً."; }
  };
  load();
  section.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const textarea = section.querySelector("textarea");
    const button = section.querySelector("button");
    button.disabled = true;
    try {
      const res = await fetch("/api/college-quiz?lessonComments=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit-lesson-comment", lesson_id: lessonId, body: textarea.value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      textarea.value = "";
      list.textContent = "تم إرسال سؤالك للمراجعة. سيظهر للعامة باسم Student عند نشره.";
    } catch (error) { list.textContent = error.message || "تعذر إرسال السؤال."; } finally { button.disabled = false; }
  });
}
