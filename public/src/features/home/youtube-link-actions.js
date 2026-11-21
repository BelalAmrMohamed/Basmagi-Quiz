// «نسخ الرابط» / «مشاركة الرابط» / «نسخ كود التضمين» for YouTube cards (published + «محتواي»).
// The link is the YouTube link; the embed snippet points at YouTube's privacy-enhanced player.
import { showNotification } from "../../components/notifications/notifications.js";
import { COPY_ICON_SVG, SHARE_ICON_SVG } from "./icons.js";
import { EMBED_ICON_SVG } from "./embed-code.js";
import { buildYoutubeEmbedCode, describeYoutubeItem, youtubeLinkFor } from "./youtube-embed.js";

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showNotification("تم النسخ", okMessage, "success");
  } catch {
    showNotification("تعذر النسخ", text, "warning");
  }
}

/** Menu actions ({label, icon, onClick}) for a published manifest item or a local row. */
export function youtubeLinkActions(item) {
  const d = describeYoutubeItem(item);
  const url = youtubeLinkFor(d);
  if (!url) return [];
  return [
    { label: "نسخ الرابط", icon: COPY_ICON_SVG, onClick: () => copyText(url, "تم نسخ رابط يوتيوب.") },
    {
      label: "مشاركة الرابط",
      icon: SHARE_ICON_SVG,
      onClick: async () => {
        if (navigator.share) {
          try {
            await navigator.share({ title: d.title || undefined, url });
            return;
          } catch (error) {
            if (error?.name === "AbortError") return;
          }
        }
        await copyText(url, "تم نسخ الرابط للمشاركة.");
      },
    },
    {
      label: "نسخ كود التضمين",
      icon: EMBED_ICON_SVG,
      onClick: () => copyText(buildYoutubeEmbedCode(d), "تم نسخ كود التضمين. الصقه في Notion (/embed) أو في صفحة HTML."),
    },
  ];
}
