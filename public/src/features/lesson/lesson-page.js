// Standalone /lesson/:id bootstrap. It intentionally does not initialize the
// home SPA/router: a lesson is a dedicated reader page, like /quiz/:id.
import { renderLessonView } from "./lesson-view.js";

document.addEventListener("DOMContentLoaded", () => renderLessonView());
