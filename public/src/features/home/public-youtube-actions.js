// =============================================================================
// public/src/features/home/public-youtube-actions.js
// The ⋮ menu of a PUBLISHED YouTube video / playlist card:
//   نسخ إلى محتواي · اسأل الباشــمبصمج · إدارة (admins: نقل / حذف)
// Link / share / embed actions are intentionally absent for now.
// =============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { buildLocalYoutubeVideoEntry, findSameLevelVideoDuplicate } from "./local-youtube-video.js";
import { buildLocalYoutubePlaylistEntry, findSameLevelPlaylistDuplicate } from "./local-youtube-playlist.js";
import { openItemDropdownMenu, createActionGroupSubmenu } from "./item-dropdown-menu.js";
import { canManageItem, openSharedMoveToDialog, deleteSharedItem } from "./admin-item-actions.js";
import { DUPLICATE_ICON_SVG, SPARKLE_ICON_SVG, TRASH_ICON_SVG, MOVE_TO_ICON_SVG } from "./icons.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { youtubeLinkActions } from "./youtube-link-actions.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { openAIAgentWithAttachment, buildPlatformYoutubeAttachment } from "../../components/ai-agent/ai-agent-attach-launcher.js";

const isPlaylist = (item) => item.kind === "playlist";
const copying = new Set();

/** Copies the published item to the visitor's own «محتواي» (top level). */
export async function copyYoutubeToUserContent(item) {
  if (copying.has(item.id)) return false;
  copying.add(item.id);
  try {
    const list = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const duplicate = isPlaylist(item)
      ? findSameLevelPlaylistDuplicate(list, item.playlistId, null)
      : findSameLevelVideoDuplicate(list, item.youtubeId, null);
    if (duplicate) {
      showNotification("موجود بالفعل", "هذا المحتوى موجود في محتواي بالفعل.", "warning");
      return false;
    }
    let entry;
    if (isPlaylist(item)) {
      const supabase = await ensureSharedSupabaseClient();
      const { data, error } = await supabase.from("youtube_public").select("items").eq("id", item.id).maybeSingle();
      if (error) throw error;
      entry = buildLocalYoutubePlaylistEntry({
        playlist: { id: item.playlistId, title: item.title, channelTitle: item.channelTitle, channelThumbnailUrl: item.channelThumbnailUrl, itemCount: item.totalCount || item.itemCount },
        items: Array.isArray(data?.items) ? data.items : [],
      });
    } else {
      entry = buildLocalYoutubeVideoEntry({
        videoId: item.youtubeId,
        meta: {
          title: item.title,
          description: item.description,
          channelTitle: item.channelTitle,
          channelThumbnailUrl: item.channelThumbnailUrl,
          publishedAt: item.publishedAt,
          thumbnailUrl: item.thumbnailUrl,
          durationSeconds: item.durationSeconds,
        },
      });
    }
    list.push(entry);
    setInStorage("user_quizzes", JSON.stringify(list));
    const { refreshUserContentCard } = await import("./course-count.js");
    refreshUserContentCard();
    showNotification("تم النسخ", `تم نسخ «${item.title}» إلى محتواي.`, "success");
    return true;
  } catch (err) {
    console.error("[youtube] copy to my content failed", err);
    showNotification("تعذّر النسخ", "تعذّر نسخ المحتوى. حاول مرة أخرى.", "error");
    return false;
  } finally {
    copying.delete(item.id);
  }
}

function addAction(menu, closeMenu, { label, icon, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "exam-action-btn";
  button.innerHTML = `${icon}<span>${label}</span>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMenu();
    onClick();
  });
  menu.appendChild(button);
}

export function openPublishedYoutubeMenu(item, trigger) {
  const playlist = isPlaylist(item);
  const noun = playlist ? "القائمة" : "الفيديو";
  openItemDropdownMenu(trigger, (menu, closeMenu, reposition) => {
    addAction(menu, closeMenu, {
      label: "نسخ إلى محتواي", icon: DUPLICATE_ICON_SVG,
      onClick: () => { void copyYoutubeToUserContent(item); },
    });
    addAction(menu, closeMenu, {
      label: "اسأل الباشــمبصمج", icon: SPARKLE_ICON_SVG,
      onClick: () => { void openAIAgentWithAttachment(buildPlatformYoutubeAttachment(item), { defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT }); },
    });
    for (const action of youtubeLinkActions(item)) addAction(menu, closeMenu, action);
    if (canManageItem(item)) {
      menu.appendChild(createActionGroupSubmenu([
        { label: `نقل ${noun}`, icon: MOVE_TO_ICON_SVG, onClick: () => openSharedMoveToDialog(item) },
        { label: `حذف ${noun}`, icon: TRASH_ICON_SVG, danger: true, onClick: () => deleteSharedItem(item) },
      ], closeMenu, reposition));
    }
  });
}
