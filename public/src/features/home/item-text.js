// Arabic count phrase for "N exams" (1 → امتحان واحد, 2 → امتحانان, 3-10 → امتحانات, else امتحان).
export function getItemText(count) {
  if (count === 0) return "لا يوجد امتحانات";
  if (count === 1) return "امتحان واحد";
  if (count === 2) return "امتحانان";
  if (count <= 10) return "امتحانات";
  return "امتحان";
}
