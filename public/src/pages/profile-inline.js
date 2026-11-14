// Moved out of an inline <script type="module"> so it is part of the page bundle (see scripts/build-web.mjs).
import { initHeatmapOverflowSync } from "../features/profile/heatmapOverflow.js";
document.addEventListener("DOMContentLoaded", () => initHeatmapOverflowSync());
