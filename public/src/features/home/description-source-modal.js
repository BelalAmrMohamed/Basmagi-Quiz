import { showNotification } from "../../components/notifications/notifications.js";

/** Shared editor for quiz/lesson description and source metadata. */
export function openDescriptionSourceModal({ title, description = "", source = "", onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "item-metadata-overlay";
  overlay.dir = "rtl";

  const modal = document.createElement("section");
  modal.className = "item-metadata-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "item-metadata-title");
  modal.innerHTML = `
    <div class="item-metadata-modal__glow" aria-hidden="true"></div>
    <header class="item-metadata-modal__header">
      <div class="item-metadata-modal__mark" aria-hidden="true">✦</div>
      <div class="item-metadata-modal__heading">
        <span class="item-metadata-modal__eyebrow">تحرير التفاصيل</span>
        <h2 id="item-metadata-title">الوصف والمصدر</h2>
        <p class="item-metadata-modal__item-title"></p>
      </div>
      <button type="button" class="item-metadata-modal__close" aria-label="إغلاق">×</button>
    </header>
    <div class="item-metadata-modal__body">
      <label class="item-metadata-field">
        <span><strong>الوصف</strong><small>قدّم للطلاب نبذة واضحة عمّا سيجدونه.</small></span>
        <textarea dir="auto" class="item-metadata-description" maxlength="1200" rows="4" placeholder="اكتب وصفاً مختصراً..."></textarea>
        <span class="item-metadata-counter item-metadata-description-count"></span>
      </label>
      <label class="item-metadata-field">
        <span><strong>المصدر</strong><small>رابط أو مرجع يساعد على توثيق المحتوى.</small></span>
        <input dir="auto" class="item-metadata-source" type="text" maxlength="500" dir="auto" placeholder="https:// أو اسم المرجع" />
        <span class="item-metadata-counter item-metadata-source-count"></span>
      </label>
      <p class="item-metadata-error" role="alert" hidden></p>
    </div>
    <footer class="item-metadata-modal__footer">
      <span class="item-metadata-modal__hint">تظهر التغييرات مباشرة بعد الحفظ</span>
      <div class="item-metadata-modal__actions">
        <button type="button" class="item-metadata-cancel">إلغاء</button>
        <button type="button" class="item-metadata-save"><span>حفظ التغييرات</span><b aria-hidden="true">↗</b></button>
      </div>
    </footer>
  `;
  modal.querySelector(".item-metadata-modal__item-title").textContent = title || "العنصر المحدد";
  const descriptionField = modal.querySelector(".item-metadata-description");
  const sourceField = modal.querySelector(".item-metadata-source");
  const descriptionCount = modal.querySelector(".item-metadata-description-count");
  const sourceCount = modal.querySelector(".item-metadata-source-count");
  const errorBox = modal.querySelector(".item-metadata-error");
  const saveButton = modal.querySelector(".item-metadata-save");
  descriptionField.value = description || "";
  sourceField.value = source || "";
  const updateCount = () => {
    descriptionCount.textContent = `${descriptionField.value.length} / 1200`;
    sourceCount.textContent = `${sourceField.value.length} / 500`;
  };
  updateCount();
  descriptionField.addEventListener("input", updateCount);
  sourceField.addEventListener("input", updateCount);

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    document.removeEventListener("keydown", onKeydown);
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 180);
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  modal.querySelector(".item-metadata-modal__close").addEventListener("click", close);
  modal.querySelector(".item-metadata-cancel").addEventListener("click", close);
  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled) return;
    errorBox.hidden = true;
    saveButton.disabled = true;
    saveButton.querySelector("span").textContent = "جارٍ الحفظ…";
    try {
      const saved = await onSave?.({
        description: descriptionField.value.trim(),
        source: sourceField.value.trim(),
      });
      if (saved === false) throw new Error("تعذّر حفظ التغييرات. حاول مرة أخرى.");
      showNotification("تم حفظ التفاصيل", "تم تحديث الوصف والمصدر بنجاح.", "success");
      close();
    } catch (error) {
      errorBox.textContent = error?.message || "تعذّر حفظ التغييرات. حاول مرة أخرى.";
      errorBox.hidden = false;
      saveButton.disabled = false;
      saveButton.querySelector("span").textContent = "حفظ التغييرات";
    }
  });
  document.addEventListener("keydown", onKeydown);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add("is-visible");
    descriptionField.focus();
  });
}
