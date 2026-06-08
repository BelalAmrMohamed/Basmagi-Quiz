const TOTAL_DURATION = 0.75;
const CHAR_DURATION = 0.48;
const EASING = "cubic-bezier(0.76, 0, 0.24, 1)";

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("ar", { granularity: "grapheme" })
    : null;

function getGraphemes(str) {
  if (segmenter) return [...segmenter.segment(str)].map((s) => s.segment);
  return [...str];
}

function processLink(link) {
  const fullText = link.textContent.trim();
  const words = fullText.split(" ");
  const totalG = getGraphemes(fullText).length;
  const S = totalG > 1 ? (TOTAL_DURATION - CHAR_DURATION) / (totalG - 1) : 0;
  const wordData = [];
  link.innerHTML = "";
  words.forEach((word, wi) => {
    if (!word) {
      wordData.push(null);
      return;
    }

    const measurer = document.createElement("span");
    measurer.style.cssText = "white-space:nowrap;display:inline;direction:rtl;";
    measurer.textContent = word;
    link.appendChild(measurer);

    void measurer.offsetWidth;

    const wordRect = measurer.getBoundingClientRect();
    const textNode = measurer.firstChild;
    const graphemes = getGraphemes(word);
    const slotInfos = [];

    let charOffset = 0;
    graphemes.forEach((g, gi) => {
      const range = document.createRange();
      range.setStart(textNode, charOffset);
      range.setEnd(textNode, charOffset + g.length);
      const r = range.getBoundingClientRect();
      charOffset += g.length;

      if (r.width < 0.5) {
        slotInfos.push(null);
        return;
      }
      const slotLeft = r.left - wordRect.left;
      const slotWidth = r.width;
      const wordOffsetX = -slotLeft;

      slotInfos.push({
        g,
        slotLeft,
        slotWidth,
        wordOffsetX,
        wordWidth: wordRect.width,
        wordHeight: wordRect.height,
      });
    });

    link.removeChild(measurer);
    wordData.push({ word, graphemes, slotInfos });
  });

  link.innerHTML = "";
  link.classList.add("ready");
  link.style.display = "inline-flex";
  link.style.direction = "rtl";
  link.style.alignItems = "flex-start";

  let globalGi = 0;

  wordData.forEach((wd, wi) => {
    if (wi > 0) {
      const sp = document.createElement("span");
      const lh = parseFloat(getComputedStyle(link).lineHeight);
      const spH = isFinite(lh) ? lh + "px" : "1.35em";
      sp.style.cssText = `display:inline-block;width:0.25em;flex-shrink:0;height:${spH};overflow:hidden;`;
      link.appendChild(sp);
      globalGi++;
    }

    if (!wd) return;
    const { word, slotInfos } = wd;
    const wordWrap = document.createElement("span");
    wordWrap.style.cssText =
      "display:inline-flex;direction:rtl;align-items:flex-start;flex-shrink:0;overflow:hidden;";
    link.appendChild(wordWrap);
    const computedLH = parseFloat(getComputedStyle(link).lineHeight);
    const slotH = isFinite(computedLH)
      ? computedLH
      : (slotInfos[0]?.wordHeight ?? 0);

    slotInfos.forEach((info, gi) => {
      if (!info) {
        globalGi++;
        return;
      }
      const { slotWidth, wordOffsetX } = info;
      const delay = (globalGi * S).toFixed(3);
      const slot = document.createElement("span");
      slot.className = "advanced-link-transition-animation-char-slot";
      slot.style.width = slotWidth + "px";
      slot.style.height = slotH + "px";

      const inner = document.createElement("span");
      inner.className = "advanced-link-transition-animation-char-slot-inner";

      const makeLayer = (cls) => {
        const span = document.createElement("span");
        span.className = "advanced-link-transition-animation-full-word " + cls;
        span.textContent = word;
        span.style.left = wordOffsetX + "px";
        span.style.height = slotH + "px";
        span.style.transition = `transform ${CHAR_DURATION}s ${EASING} ${delay}s`;
        return span;
      };

      const bottom = makeLayer(
        "advanced-link-transition-animation-full-word--bottom",
      );
      bottom.setAttribute("aria-hidden", "true");

      inner.appendChild(
        makeLayer("advanced-link-transition-animation-full-word--top"),
      );
      inner.appendChild(bottom);
      slot.appendChild(inner);
      wordWrap.appendChild(slot);

      globalGi++;
    });
  });
}

document.fonts.ready.then(() => {
  document
    .querySelectorAll(".advanced-link-transition-animation")
    .forEach(processLink);
});
