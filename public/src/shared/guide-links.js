// public/src/shared/guide-links.js
// Contextual deep links: a toast links to the exact guide section that explains
// the failure it reports. Nothing is shown unless something went wrong.
//
//   draftExpired → «الرابط يقول انتهت الصلاحية» (FAQ, section #s8 of the MCP guide)
//   itemMissing  → «فتحت الرابط ولا أجد العنصر» (FAQ entry, opened by its id)
//   uploadVerify → step 4 of the upload guide (verifying the upload)
//
// The hrefs must match ids in docs-src/pages/*.html (tests/guide-links.test.js checks it).

export const GUIDE_LINKS = {
  draftExpired: {
    href: "/how-to-connect-mcp#s8",
    label: { ar: "الرابط منتهي؟ راجع الأسئلة الشائعة", en: "Link expired? See the FAQ" },
  },
  itemMissing: {
    href: "/how-to-connect-mcp#faq-item-missing",
    label: { ar: "فتحت الرابط ولا أجد العنصر؟", en: "Opened the link but can't find the item?" },
  },
  uploadVerify: {
    href: "/how-to-upload-content#s4",
    label: { ar: "كيف أتحقق من نجاح الرفع؟", en: "How to verify an upload" },
  },
};

/** `{ label, href }` for showNotification's `options.action`, or undefined for an unknown key. */
export function guideAction(key, lang = "ar") {
  const g = GUIDE_LINKS[key];
  return g ? { href: g.href, label: g.label[lang] || g.label.ar } : undefined;
}

/** Tags an Error with the guide section that explains it; returns the same error. */
export function withGuide(err, key) {
  if (err && typeof err === "object") err.guide = key;
  return err;
}

/** showNotification options for a caught error: `{ action }` when it carries a guide key, else `{}`. */
export function guideOptions(err, lang = "ar") {
  const action = err && err.guide ? guideAction(err.guide, lang) : undefined;
  return action ? { action } : {};
}
