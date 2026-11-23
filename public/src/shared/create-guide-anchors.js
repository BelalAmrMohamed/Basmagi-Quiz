// public/src/shared/create-guide-anchors.js
// One stable anchor per content type in the creation guide (docs-src/pages/how-to-create-content.html), so a
// creation form can deep-link to the section that explains it. The keys are the content types; the anchor of
// `key` is always `create-${key}`. NOT WIRED to any form yet: the new creation video is not recorded.
// tests/create-guide-anchors.test.js checks that every anchor exists in the generated guide.

export const CREATE_GUIDE_PAGE = "/how-to-create-content";

export const CREATE_GUIDE_ANCHORS = {
  course: { id: "create-course", label: { ar: "كيف أنشئ مادة؟", en: "How to create a course" } },
  folder: { id: "create-folder", label: { ar: "كيف أنشئ مجلداً؟", en: "How to create a folder" } },
  quiz: { id: "create-quiz", label: { ar: "كيف أنشئ امتحاناً؟", en: "How to create a quiz" } },
  lesson: { id: "create-lesson", label: { ar: "كيف أنشئ درساً؟", en: "How to create a lesson" } },
  notebook: { id: "create-notebook", label: { ar: "كيف أنشئ دفتراً؟", en: "How to create a notebook" } },
  youtube: { id: "create-youtube", label: { ar: "كيف أنشر فيديو YouTube؟", en: "How to publish a YouTube video" } },
};

/** `/how-to-create-content#create-quiz` for a content type, or undefined for an unknown type. */
export function createGuideHref(type) {
  const entry = Object.hasOwn(CREATE_GUIDE_ANCHORS, type) ? CREATE_GUIDE_ANCHORS[type] : undefined;
  return entry ? `${CREATE_GUIDE_PAGE}#${entry.id}` : undefined;
}

/** `{ label, href }` (the shape guideAction() returns), or undefined for an unknown type. */
export function createGuideAction(type, lang = "ar") {
  const href = createGuideHref(type);
  return href ? { href, label: CREATE_GUIDE_ANCHORS[type].label[lang] || CREATE_GUIDE_ANCHORS[type].label.ar } : undefined;
}
