// Moved out of an inline <script type="module"> so it is part of the page bundle (see scripts/build-web.mjs).
import { syncAdminSession } from "../shared/adminBadgeSync.js";
import { refreshAdminUI } from "../components/side-menu/side-menu.js";
document.addEventListener("DOMContentLoaded", () => {
syncAdminSession({ onRecovered: refreshAdminUI, onSignedOut: refreshAdminUI });
});
