import { getToken, isAdminAuthenticated } from "../../shared/adminAuth.js";
import { escapeHtml } from "../home/escape-html.js";

let status = "pending";
const root = document.getElementById("lessonCommentsModeration");
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` });

async function load() {
  if (!isAdminAuthenticated()) { location.href = "/#my-quizzes"; return; }
  root.textContent = "جارٍ التحميل…";
  try {
    const res = await fetch(`/api/college-quiz?lessonComments=admin&status=${status}`, { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const comments = data.comments || [];
    root.innerHTML = comments.length ? comments.map((comment) => `<article class="lesson-comment"><strong>${escapeHtml(comment.lessons?.title || "درس")}</strong><time>${new Date(comment.created_at).toLocaleString("ar-EG")}</time><p>${escapeHtml(comment.body)}</p>${comment.status === "pending" ? `<button data-id="${comment.id}" data-action="resolved">تم الحل</button><button data-id="${comment.id}" data-action="dismissed">تجاهل</button>` : `<span>${comment.status === "resolved" ? "تم الحل" : "تم التجاهل"}</span>`}</article>`).join("") : "لا توجد أسئلة في هذه الفئة.";
  } catch (error) { root.textContent = error.message || "تعذر التحميل."; }
}
root.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]"); if (!button) return;
  button.disabled = true;
  const res = await fetch("/api/college-quiz?lessonComments=true", { method: "POST", headers: headers(), body: JSON.stringify({ action: "resolve-lesson-comment", comment_id: button.dataset.id, status: button.dataset.action }) });
  if (!res.ok) alert("تعذر تحديث السؤال.");
  load();
});
document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => { status = button.dataset.status; load(); }));
load();
