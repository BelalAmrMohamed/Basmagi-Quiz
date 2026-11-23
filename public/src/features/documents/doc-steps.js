// public/src/features/documents/doc-steps.js
// Copy-to-clipboard buttons, click-to-zoom screenshots and FAQ deep links for step-by-step docs.
const done = (btn, label) => {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = label;
  btn.classList.toggle("is-done", label === "تم النسخ ✓");
  setTimeout(() => { btn.textContent = old; btn.classList.remove("is-done"); }, 1800);
};

document.addEventListener("click", async (e) => {
  const copy = e.target.closest(".doc-copy__btn");
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy || "");
      done(copy, "تم النسخ ✓");
    } catch {
      // Clipboard API unavailable (http / old browser): select the text so Ctrl+C works.
      const code = copy.closest(".doc-copy")?.querySelector("code");
      if (code) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      done(copy, "حدّده وانسخ");
    }
    return;
  }
  const zoom = e.target.closest(".doc-shot__zoom");
  const box = document.getElementById("docLightbox");
  if (zoom && box?.showModal) {
    const img = box.querySelector("img");
    img.src = zoom.dataset.full;
    img.alt = zoom.querySelector("img")?.alt || "";
    box.showModal();
    return;
  }
  // close: ✕ button or a click on the dark backdrop
  if (box?.open && (e.target.closest(".doc-lightbox__close") || e.target === box)) box.close();
});

// FAQ deep links (/how-to-connect-mcp#faq-item-missing, toasts link here on errors):
// a hash that points at a collapsed <details> opens it and scrolls it into view, so the
// reader lands on the answer, not on a closed row. Re-runs when the hash changes in place.
function openFaqFromHash() {
  let id = "";
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const el = id ? document.getElementById(id) : null;
  const faq = el && (el.matches("details") ? el : el.closest("details"));
  if (!faq) return;
  faq.open = true;
  faq.scrollIntoView({ block: "center" });
}
openFaqFromHash();
window.addEventListener("hashchange", openFaqFromHash);
