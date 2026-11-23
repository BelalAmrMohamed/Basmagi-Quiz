// public/src/features/documents/doc-hub.js
// Client-side search and audience filter for the /docs hub page.

function initDocHub() {
  const searchInput = document.getElementById("hubSearchInput");
  const filterPills = document.querySelectorAll(".hub-filter-pill");
  const sections = document.querySelectorAll("section[data-audience]");
  const cards = document.querySelectorAll(".doc-hub__card");
  const emptyState = document.getElementById("hubSearchEmpty");

  let activeFilter = "all";

  function normalize(str) {
    return (str || "")
      .toLowerCase()
      .replace(/[إأآا]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/[\u064B-\u065F\u0640]/g, "")
      .trim();
  }

  function applyFilter() {
    const query = normalize(searchInput ? searchInput.value : "");
    let visibleCardCount = 0;

    sections.forEach((section) => {
      const audience = section.getAttribute("data-audience");
      const audienceMatches = activeFilter === "all" || activeFilter === audience;
      const sectionCards = section.querySelectorAll(".doc-hub__card");
      let visibleInSection = 0;

      sectionCards.forEach((card) => {
        const title = normalize(card.querySelector(".doc-hub__title")?.textContent || "");
        const desc = normalize(card.querySelector(".doc-hub__desc")?.textContent || "");
        const tag = normalize(card.querySelector(".doc-hub__tag, .doc-hub__note")?.textContent || "");
        const textMatches = !query || title.includes(query) || desc.includes(query) || tag.includes(query);

        if (audienceMatches && textMatches) {
          card.style.display = "";
          visibleInSection++;
          visibleCardCount++;
        } else {
          card.style.display = "none";
        }
      });

      section.style.display = visibleInSection > 0 ? "" : "none";
    });

    if (emptyState) {
      emptyState.hidden = visibleCardCount > 0;
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", applyFilter);
  }

  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.getAttribute("data-filter") || "all";
      applyFilter();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDocHub);
} else {
  initDocHub();
}
