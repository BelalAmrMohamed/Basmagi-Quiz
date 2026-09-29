// Standalone /lesson/:id bootstrap. It intentionally does not initialize the
// global shell here because lesson.html already owns the shared navigation.
// The #contentArea element exists before this module script tag, so starting
// immediately avoids an unnecessary DOMContentLoaded delay after the module
// graph has finished loading. The HTML page also contains an inline skeleton
// so the reader never has to wait for this module before seeing loading UI.
import { renderLessonView } from "./lesson-view.js";

void renderLessonView();
