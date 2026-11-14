// Moved out of an inline <script type="module"> so it is part of the page bundle (see scripts/build-web.mjs).
import { getShortcutModalHTML, toggleShortcutModal } from '../features/quiz/keyboard-nav.js';
document.body.insertAdjacentHTML('beforeend', getShortcutModalHTML());
window.toggleShortcutModal = toggleShortcutModal;
