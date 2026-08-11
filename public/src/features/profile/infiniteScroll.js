// public/src/features/profile/infiniteScroll.js - Reusable Infinite Scroll / Show More Helper
// Renders items in batches, instead of dumping a potentially huge
// History/Bookmarks/Flagged/Uploaded-Quizzes list into the DOM at once
// (the original overflow problem) or re-rendering the whole list on every
// load. Two batching UIs share the same item-slicing logic below:
//
//   mode: "scroll" (default) — auto-loads more as an IntersectionObserver
//         sentinel comes into view. Original behavior, unchanged.
//   mode: "button"  — shows the first PAGE_SIZE items, then a "Show more"
//         pill (see .show-more-row in profile.css) the user taps to reveal
//         the next page. Matches the reference "Show more ⌄" UI used across
//         all four profile lists.

const BATCH_SIZE = 15; // scroll mode: items loaded per IntersectionObserver trigger
const PAGE_SIZE = 5; // button mode: items shown per "Show more" tap

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

export class InfiniteList {
  // containerEl: element the rendered item HTML is appended into
  // items: full array of data items
  // renderItem: (item, index) => htmlString
  // emptyHtml: markup shown when items.length === 0
  // mode: "scroll" | "button" (default "scroll")
  // showMoreLabel / showLessLabel: button mode copy (defaults below)
  constructor({
    containerEl,
    items,
    renderItem,
    emptyHtml,
    mode = "scroll",
    showMoreLabel = "عرض المزيد",
    showLessLabel = "عرض أقل",
  }) {
    this.containerEl = containerEl;
    this.items = items || [];
    this.renderItem = renderItem;
    this.emptyHtml = emptyHtml || "";
    this.mode = mode === "button" ? "button" : "scroll";
    this.showMoreLabel = showMoreLabel;
    this.showLessLabel = showLessLabel;
    this.cursor = 0;
    this.sentinel = null;
    this.observer = null;
    this.showMoreRow = null;
    this.showMoreBtn = null;
  }

  mount() {
    if (!this.containerEl) return;
    this._teardown();
    this.containerEl.innerHTML = "";
    this.cursor = 0;

    if (this.items.length === 0) {
      this.containerEl.innerHTML = this.emptyHtml;
      return;
    }

    if (this.mode === "button") {
      this._mountButtonMode();
    } else {
      this._mountScrollMode();
    }
  }

  _mountScrollMode() {
    this.sentinel = document.createElement("div");
    this.sentinel.className = "infinite-scroll-sentinel";
    this.sentinel.setAttribute("aria-hidden", "true");

    this._loadNextBatch(BATCH_SIZE);
    this.containerEl.after(this.sentinel);

    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          this._loadNextBatch(BATCH_SIZE);
        }
      },
      { rootMargin: "200px" },
    );
    this.observer.observe(this.sentinel);
  }

  _mountButtonMode() {
    this._loadNextBatch(PAGE_SIZE);

    // No "Show more" row at all if everything already fits on one page.
    if (this.cursor >= this.items.length) return;

    this.showMoreRow = document.createElement("div");
    this.showMoreRow.className = "show-more-row";

    this.showMoreBtn = document.createElement("button");
    this.showMoreBtn.type = "button";
    this.showMoreBtn.className = "show-more-btn";
    this._renderShowMoreLabel();
    // onclick (not addEventListener) so _onShowMoreClick can freely
    // reassign it below without accumulating duplicate listeners.
    this.showMoreBtn.onclick = () => this._onShowMoreClick();

    this.showMoreRow.appendChild(this.showMoreBtn);
    this.containerEl.after(this.showMoreRow);
  }

  // Single click handler for the button-mode pill, covering both
  // directions: load-the-next-page while pages remain, then flip to
  // collapse-back-to-page-one once fully expanded — so the action stays
  // reversible instead of the button just disappearing.
  _onShowMoreClick() {
    if (this.cursor < this.items.length) {
      this._loadNextBatch(PAGE_SIZE);
      if (this.cursor >= this.items.length) {
        this.showMoreRow.classList.add("is-expanded");
        this._renderShowMoreLabel(true);
      }
      return;
    }

    // Fully expanded — collapse back to the first page.
    this.containerEl.innerHTML = "";
    this.cursor = 0;
    this._loadNextBatch(PAGE_SIZE);
    this.showMoreRow.classList.remove("is-expanded");
    this._renderShowMoreLabel(false);
  }

  _renderShowMoreLabel(expanded = false) {
    if (!this.showMoreBtn) return;
    this.showMoreBtn.innerHTML = `<span>${expanded ? this.showLessLabel : this.showMoreLabel}</span>${CHEVRON_SVG}`;
  }

  _loadNextBatch(size) {
    if (this.cursor >= this.items.length) {
      if (this.observer && this.sentinel)
        this.observer.unobserve(this.sentinel);
      return;
    }

    const nextItems = this.items.slice(this.cursor, this.cursor + size);
    const html = nextItems
      .map((item, i) => this.renderItem(item, this.cursor + i))
      .join("");
    this.containerEl.insertAdjacentHTML("beforeend", html);
    this.cursor += nextItems.length;

    if (this.cursor >= this.items.length && this.observer && this.sentinel) {
      this.observer.unobserve(this.sentinel);
    }
  }

  _teardown() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.sentinel && this.sentinel.parentNode) {
      this.sentinel.parentNode.removeChild(this.sentinel);
    }
    this.sentinel = null;

    if (this.showMoreRow && this.showMoreRow.parentNode) {
      this.showMoreRow.parentNode.removeChild(this.showMoreRow);
    }
    this.showMoreRow = null;
    this.showMoreBtn = null;
  }

  destroy() {
    this._teardown();
  }
}
