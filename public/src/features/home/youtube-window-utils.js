// Pure helpers for the YouTube windows (no DOM), so they can be unit-tested.

export const SPLIT_MIN_MAIN = 320;
export const SPLIT_MIN_LIST = 180;
export const SPLIT_DEFAULT_LIST = 300;
export const SPLIT_KEY = "bq-youtube-playlist-split";

/** List width clamped so the video area keeps >= 320px and the list >= 180px. */
export function clampSplit(listWidth, totalWidth, dividerWidth = 8) {
  const max = Math.max(SPLIT_MIN_LIST, totalWidth - dividerWidth - SPLIT_MIN_MAIN);
  const n = Number(listWidth);
  const w = Number.isFinite(n) ? n : SPLIT_DEFAULT_LIST;
  return Math.round(Math.min(Math.max(w, SPLIT_MIN_LIST), max));
}

/** Reads the remembered list width (per device). Never throws. */
export function readSplit(storage = globalThis.localStorage) {
  try {
    const n = Number(storage?.getItem(SPLIT_KEY));
    return Number.isFinite(n) && n > 0 ? n : SPLIT_DEFAULT_LIST;
  } catch {
    return SPLIT_DEFAULT_LIST;
  }
}

export function writeSplit(width, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SPLIT_KEY, String(Math.round(width)));
  } catch {
    /* private mode or blocked storage: the split just isn't remembered */
  }
}

export const LIST_HIDDEN_KEY = "bq-youtube-playlist-list-hidden";

/** Remembered "list hidden" choice (per device). With no saved choice, narrow screens start collapsed. */
export function readListHidden(storage = globalThis.localStorage, narrow = false) {
  try {
    const v = storage?.getItem(LIST_HIDDEN_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* blocked storage: fall through to the default */
  }
  return Boolean(narrow);
}

export function writeListHidden(hidden, storage = globalThis.localStorage) {
  try {
    storage?.setItem(LIST_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    /* not remembered */
  }
}

/** Maps a `video` API detail row to what the info panel shows. */
export function mapDetailsForInfo(d) {
  return {
    publishedAt: typeof d?.publishedAt === "string" ? d.publishedAt : "",
    description: typeof d?.description === "string" ? d.description.trim() : "",
  };
}
