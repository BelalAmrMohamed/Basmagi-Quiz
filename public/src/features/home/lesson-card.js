// ============================================================================
// PLATFORM LESSON CARD — catalog leaf for the course/folder grid.
// ============================================================================

export function createLessonCard(lesson) {
  const card = document.createElement("div");
  card.className = "card exam-card lesson-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `درس: ${lesson.title || lesson.id}`);

  const icon = document.createElement("span");
  icon.className = "phone-only-emoji";
  icon.textContent = "📘";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "card-text";
  const heading = document.createElement("h3");
  heading.textContent = lesson.title || "درس بدون عنوان";
  const description = String(lesson.description || "").trim();
  const meta = document.createElement("p");
  meta.className = "exam-question-count";
  const sectionCount = Number(lesson.sectionIds?.length ?? lesson.sectionCount ?? 0);
  meta.textContent = [sectionCount === 1 ? "قسم واحد" : `${sectionCount} أقسام`, lesson.passwordProtected ? "محمي" : ""].filter(Boolean).join(" · ");
  text.append(heading);
  if (description) {
    const desc = document.createElement("p");
    desc.className = "lesson-card-description";
    desc.textContent = description;
    text.append(desc);
  }
  text.append(meta);

  const actions = document.createElement("div");
  actions.className = "exam-card-actions-wrap";
  const start = document.createElement("button");
  start.type = "button";
  start.className = "start-btn";
  start.style.flex = "1";
  start.style.minWidth = "0";
  start.textContent = "ابدأ القراءة";
  start.onclick = (event) => {
    event.stopPropagation();
    window.location.href = `/lesson/${encodeURIComponent(lesson.id)}`;
  };
  actions.appendChild(start);
  card.append(icon, text, actions);
  card.onclick = () => { window.location.href = `/lesson/${encodeURIComponent(lesson.id)}`; };
  return card;
}
