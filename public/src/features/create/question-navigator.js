// public/src/features/create/question-navigator.js
// Lightweight question navigator for the quiz editor.

let observer = null;
let isOpen = true;
let currentQuestionId = null;

function getPanel() {
  return document.getElementById("createQuestionNavigatorPanel");
}

function setCurrent(id) {
  currentQuestionId = id;
  getPanel()?.querySelectorAll(".create-question-nav-item").forEach((item) => {
    const active = String(item.dataset.questionId) === String(id);
    item.classList.toggle("current", active);
    item.setAttribute("aria-current", active ? "true" : "false");
  });
}

function observeQuestions() {
  observer?.disconnect();
  const cards = [...document.querySelectorAll("#questionsContainer .question-card")];
  if (!cards.length) return;

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setCurrent(visible[0].target.dataset.questionId);
    },
    { root: null, rootMargin: "-18% 0px -55% 0px", threshold: [0.1, 0.35, 0.7] },
  );

  cards.forEach((card) => observer.observe(card));
}

function updateToggleState() {
  const root = document.getElementById("createQuestionNavigator");
  const panel = getPanel();
  const toggle = document.getElementById("createQuestionNavigatorToggle");
  if (!root || !panel || !toggle) return;

  root.classList.toggle("is-open", isOpen);
  panel.hidden = !isOpen;
  toggle.setAttribute("aria-expanded", String(isOpen));
}

export function renderCreateQuestionNavigator(questions = []) {
  const panel = getPanel();
  const count = document.getElementById("createQuestionNavigatorCount");
  if (!panel) return;

  if (count) count.textContent = String(questions.length);

  panel.innerHTML = questions.map((question, index) => {
    const incomplete =
      !question.q?.trim() ||
      !Array.isArray(question.options) ||
      question.options.some((option) => !option?.trim()) ||
      (!question.answer &&
        (!Array.isArray(question.correct) || question.correct.length === 0));

    return `
      <button type="button"
        class="create-question-nav-item${incomplete ? " incomplete" : ""}"
        data-question-id="${question.id}"
        title="الانتقال إلى السؤال ${index + 1}"
        aria-label="الانتقال إلى السؤال ${index + 1}"
        aria-current="false">${index + 1}</button>`;
  }).join("");

  panel.querySelectorAll(".create-question-nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const card = document.getElementById(`question-${button.dataset.questionId}`);
      if (!card) return;
      setCurrent(button.dataset.questionId);
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  updateToggleState();
  observeQuestions();

  if (currentQuestionId && questions.some((q) => String(q.id) === String(currentQuestionId))) {
    setCurrent(currentQuestionId);
  } else if (questions[0]) {
    setCurrent(questions[0].id);
  } else {
    currentQuestionId = null;
  }
}

export function initCreateQuestionNavigator() {
  const toggle = document.getElementById("createQuestionNavigatorToggle");
  if (!toggle || toggle.dataset.bound === "true") return;

  toggle.dataset.bound = "true";
  toggle.addEventListener("click", () => {
    isOpen = !isOpen;
    updateToggleState();
  });
  updateToggleState();
}
