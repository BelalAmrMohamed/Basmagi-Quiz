// Moved out of an inline <script type="module"> so it is part of the page bundle (see scripts/build-web.mjs).
import { initPWA } from "../shared/pwa-manager.js";
document.addEventListener("DOMContentLoaded", () => initPWA());
