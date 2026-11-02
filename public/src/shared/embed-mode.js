// Embed mode: /quiz/:id?embed=1 and /lesson/:id?embed=1 are meant to live inside
// an <iframe> (Notion, blogs…). Marks <html class="embed-mode"> so
// styles/embed-mode.css can strip the platform chrome. The flag is kept in
// sessionStorage so quiz -> result navigation inside the frame stays embedded.
(function () {
  try {
    var on = new URLSearchParams(location.search).get("embed") === "1";
    if (on) { try { sessionStorage.setItem("embed_mode", "1"); } catch (e) {} }
    else if (window.self !== window.top) { try { on = sessionStorage.getItem("embed_mode") === "1"; } catch (e) {} }
    if (on) {
      document.documentElement.classList.add("embed-mode");
      // Embedded views duplicate the canonical page — keep them out of search.
      var m = document.createElement("meta"); m.name = "robots"; m.content = "noindex";
      document.head.appendChild(m);
    }
  } catch (e) {}
})();
