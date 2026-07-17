// src/shared/infiniteScroll.js - Reusable Infinite Scroll Helper
// Renders items in batches as the user scrolls, instead of dumping a
// potentially huge History/Bookmarks list into the DOM at once (the
// original overflow problem) or re-rendering the whole list on every load.

const BATCH_SIZE = 15;

export class InfiniteList {
  // containerEl: element the rendered item HTML is appended into
  // items: full array of data items
  // renderItem: (item, index) => htmlString
  // emptyHtml: markup shown when items.length === 0
  constructor({ containerEl, items, renderItem, emptyHtml }) {
    this.containerEl = containerEl;
    this.items = items || [];
    this.renderItem = renderItem;
    this.emptyHtml = emptyHtml || "";
    this.cursor = 0;
    this.sentinel = null;
    this.observer = null;
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

    this.sentinel = document.createElement("div");
    this.sentinel.className = "infinite-scroll-sentinel";
    this.sentinel.setAttribute("aria-hidden", "true");

    this._loadNextBatch();
    this.containerEl.after(this.sentinel);

    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          this._loadNextBatch();
        }
      },
      { rootMargin: "200px" },
    );
    this.observer.observe(this.sentinel);
  }

  _loadNextBatch() {
    if (this.cursor >= this.items.length) {
      if (this.observer && this.sentinel) this.observer.unobserve(this.sentinel);
      return;
    }

    const nextItems = this.items.slice(this.cursor, this.cursor + BATCH_SIZE);
    const html = nextItems.map((item, i) => this.renderItem(item, this.cursor + i)).join("");
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
  }

  destroy() {
    this._teardown();
  }
}