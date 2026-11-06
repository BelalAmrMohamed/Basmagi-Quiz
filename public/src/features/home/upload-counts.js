// Pure text helper for the admin upload modal: «3 امتحان و2 درس و1 دفتر».
// Only non-zero parts are listed, so a notebook-only upload no longer reads
// "0 امتحان و0 درس" (notebooks used to be missing from these messages).
export function formatItemCounts({ quizzes = 0, lessons = 0, notebooks = 0 } = {}) {
  const parts = [];
  if (quizzes) parts.push(`${quizzes} امتحان`);
  if (lessons) parts.push(`${lessons} درس`);
  if (notebooks) parts.push(`${notebooks} دفتر`);
  return parts.length ? parts.join(" و") : "0 عنصر";
}
