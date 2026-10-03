# Implementation Plan: Telegram AI Bot Showcase Component

**Prepared:** 2026-10-04
**Status:** Ready for immediate execution
**Reference:** `docs/secret/basmagi-quiz-whatsapp-chat-ai-credentials.md` (lines 47–52)

---

## 0. Instructions for the Implementing AI (read first)

**Your role:** You are a senior front-end engineer working inside the existing **Basmagi Exams** (امتحانات بصمجي) web platform. Implement the plan below exactly, phase by phase, in the existing vanilla JS / ES-module / CSS codebase.

**Hard constraints**

1. The bot URL is always `https://t.me/basmagi_quiz_bot`, and the handle is always `@basmagi_quiz_bot`.
2. No external libraries, CDNs, or network requests for the QR code. It must be generated 100% client-side as pure SVG and work offline (PWA).
3. All **user-facing strings stay in Arabic, verbatim** (shown below in Arabic with an English gloss in parentheses). The UI is **RTL**. Do not translate UI copy into English. Keep the bot name "الباشــمبصمج" (*El-Bash-Mebasmag*, the platform's AI assistant) exactly as written, including the elongation character.
4. Reuse existing design tokens and systems (`--radius-xl`, `--radius-2xl`, `--card-bg`, `--glass-blur`, `--transition-base`, `themes.css`, `showNotification(...)`). Do not invent parallel systems.
5. Support all three themes (`light`, `dark`, `dark-slate`) and respect `data-motion="reduced"`.
6. Every button and link needs an explicit `aria-label` (where its text isn't self-explanatory) and full keyboard operability.
7. Support viewports from 320px to 2560px.

**Working method:** Complete phases in order (Section 5). After each phase, verify it before moving on. If a file or function mentioned here doesn't exist at the stated path, locate the real equivalent in the repo and adapt rather than creating duplicates.

---

## 1. Design Vision and Experience Philosophy

This component bridges the rich web experience of the **Basmagi Exams** platform and fast, mobile studying through the **Telegram app**, using the AI assistant **El-Bash-Mebasmag** (`@basmagi_quiz_bot`).

### Aesthetic and functional principles

1. **Azure glassmorphism (Telegram-inspired)**
   - Use Telegram's sky-blue identity (`#24A1DE`, `#0088cc`) with soft neumorphic gradients and translucent glass (`backdrop-filter: blur(16px)`).
   - Rounded corners consistent with the platform (`--radius-xl: 16px`, `--radius-2xl: 24px`) and a soft interactive ambient glow for a premium, futuristic feel.
   - Full support for `light`, `dark`, and `dark-slate` themes, plus reduced-motion preference (`data-motion="reduced"`).

2. **Pure vector SVG QR code engine**
   - Generated entirely in code (vector SVG), with no external libraries or CDN, so it works offline.
   - The Telegram paper-plane icon is stamped precisely in the center. Use error-correction level **Q or H** so any phone camera scans it in a fraction of a second.
   - Extra interactions:
     - **Enlarge:** clicking the QR opens a magnified lightbox for scanning from a distance.
     - **Download:** a button saves the QR as SVG/PNG for study summaries or groups.

3. **Tactile copy button**
   - One-tap copy of `https://t.me/basmagi_quiz_bot`.
   - Icon transitions from the copy icon to a green check (`is-copied` class) with a subtle shake and a ripple effect.
   - Show the platform's floating notification: `showNotification("تم نسخ الرابط", "t.me/basmagi_quiz_bot", "success")` ("Link copied").

4. **Smart deep-link launch button**
   - A high-visibility hero CTA in glowing Telegram azure with the paper-plane icon.
   - Smart routing: first try opening the installed Telegram app via `tg://resolve?domain=basmagi_quiz_bot`, then safely fall back to `https://t.me/basmagi_quiz_bot` in a new window.

5. **Live status badge and feature cards**
   - Animated status badge: `🟢 متاح 24/7 عبر تيليجرام` ("Available 24/7 on Telegram").
   - Quick capability pills:
     - ⚡ إنشاء امتحانات فورية بالذكاء الاصطناعي (Instant AI-generated exams)
     - 📚 تصفح وتحميل مقررات ومجلدات المنصة (Browse and download platform courses and folders)
     - 📄 تحليل وتفريغ ملفات PDF والمستندات (Analyze and extract PDF files and documents)
     - 📥 تصدير بـ 6 صيغ تفاعلية ومطبوعة (Export in 6 interactive and printable formats)

---

## 2. Technical Architecture and New Components

Build a standalone, reusable, modular component at `public/src/components/telegram-bot-card/`:

```
public/src/components/telegram-bot-card/
├── telegram-bot-card.js      # Component logic, card generation, modal management, copy handling
├── telegram-bot-card.css     # Visual styles, glass effects, responsive behavior
└── qr-svg-engine.js          # Pure-SVG QR generator, 100% dependency-free
```

### Exported API

```javascript
// Create a card ready to inject into any DOM container
export function createTelegramBotCard(options = {});
// options: {
//   variant: 'showcase' | 'modal' | 'banner' | 'compact',
//   title?: string,
//   description?: string,
//   showFeatures?: boolean,
//   showDownload?: boolean
// }

// Open a premium modal showing the bot from anywhere
export function openTelegramBotModal();

// Mount the card directly into a given HTML element
export function mountTelegramBotCard(container, options = {});

// Helper: copy the link with compatibility fallbacks and notifications
export function copyTelegramBotLink(triggerBtn = null);
```

---

## 3. Integration Map

The component is integrated into **3 main locations** plus **1 additional high-value location**:

| # | Location | Variant | Placement and description |
| :--- | :--- | :--- | :--- |
| 1 | **AI assistant UI and modal**<br>`public/src/components/ai-agent/` | `modal` + `banner` + `sidebar-btn` | • **Dedicated sidebar button:** Telegram icon with hover tooltip.<br>• **Welcome banner in an empty chat:** a soft card above the quick suggestions inviting the user to continue studying on their phone.<br>• **"Connected platforms" section** in the assistant's settings. |
| 2 | **About page**<br>`public/about.html` | `showcase` (hero card) | • A standalone premium section placed **before** the "The person behind Basmagi" section. It ties the platform's story to the assistant being available in the phone app, and includes the interactive QR, copy button, and launch button. |
| 3 | **Assistant user guide**<br>`public/how-to-use-ai-agent.html` | `showcase` (interactive guide) | • **Section 7:** "الباشــمبصمج على تطبيق تيليجرام (مساعدك المتنقل)" ("El-Bash-Mebasmag on the Telegram app, your mobile assistant"). Explains the bot's capabilities and the three startup steps, embeds the full bot card, and is auto-linked into the table of contents (ToC). |
| 4 | **Global side menu (extra)**<br>`public/src/components/side-menu/side-menu.js` | `compact-link` | • A direct link or a button that opens the bot modal, among the platform's tools, for users on any page. |

---

## 4. Detailed Implementation Specifications

### Phase 1: QR generation engine (`qr-svg-engine.js`)

- **Goal:** Provide a pure function `generateQrSvg(text, options)` that outputs high-resolution inline SVG with no external network and no heavy libraries.
- **Requirements:**
  - Error-correction level **Q or H** (tolerates ~25–30% obscured area without hurting readability).
  - Clear a soft circular or square area in the center to inject the blue Telegram icon.
  - Color options: module color follows the site theme dynamically (white in dark mode, dark navy in light mode) or official Telegram blue.

### Phase 2: Card component and modals (`telegram-bot-card.js` and `telegram-bot-card.css`)

**Card markup (`variant: 'showcase'`):**

```html
<div class="tg-bot-card tg-bot-card--showcase">
  <!-- Glass background glow -->
  <div class="tg-bot-glow" aria-hidden="true"></div>

  <div class="tg-bot-header">
    <div class="tg-bot-avatar-wrap">
      <img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="الباشــمبصمج" class="tg-bot-avatar">
      <span class="tg-bot-badge-icon" title="بوت رسمي موثق">
        <svg ...><!-- blue verified badge --></svg>
      </span>
    </div>
    <div class="tg-bot-identity">
      <div class="tg-bot-status">
        <span class="tg-bot-pulse-dot"></span>
        <span>متاح 24/7 عبر تيليجرام</span>
      </div>
      <h3 class="tg-bot-title">الباشــمبصمج على تيليجرام</h3>
      <span class="tg-bot-handle" dir="ltr">@basmagi_quiz_bot</span>
    </div>
  </div>

  <p class="tg-bot-description">
    ذاكر، أنشئ امتحاناتك، وتصفح مقررات المنصة مباشرة من تطبيق تيليجرام في أي وقت ومن أي جهاز.
  </p>

  <!-- Featured bot capabilities -->
  <div class="tg-bot-features">
    <span class="tg-bot-feature-pill">⚡ إنشاء امتحانات فورية</span>
    <span class="tg-bot-feature-pill">📚 تصفح المقررات والملفات</span>
    <span class="tg-bot-feature-pill">📄 قراءة PDF ومستندات Word</span>
    <span class="tg-bot-feature-pill">📥 تصدير بـ 6 صيغ تفاعلية</span>
  </div>

  <!-- QR code block with controls -->
  <div class="tg-bot-qr-section">
    <div class="tg-bot-qr-box" id="tgQrContainer" title="انقر لتكبير الرمز">
      <!-- Generated SVG is injected here, with the icon embedded in the center -->
      <div class="tg-bot-qr-overlay-hint">
        <svg ...><!-- zoom icon --></svg>
        <span>انقر للتكبير</span>
      </div>
    </div>
    <div class="tg-bot-qr-meta">
      <span class="tg-bot-qr-tip">امسح الكاميرا بهاتفك لبدء المحادثة فوراً</span>
      <button type="button" class="tg-bot-btn-text tg-bot-download-qr-btn">
        <svg ...><!-- download icon --></svg>
        <span>حفظ رمز QR</span>
      </button>
    </div>
  </div>

  <!-- Primary action buttons -->
  <div class="tg-bot-actions">
    <a href="https://t.me/basmagi_quiz_bot" target="_blank" rel="noopener noreferrer" class="tg-bot-btn tg-bot-btn--primary tg-bot-redirect-btn">
      <svg class="tg-plane-icon" ...><!-- Telegram paper plane --></svg>
      <span>فتح في تيليجرام</span>
      <svg class="tg-arrow-icon" ...><!-- direction arrow --></svg>
    </a>

    <button type="button" class="tg-bot-btn tg-bot-btn--secondary tg-bot-copy-btn" aria-label="نسخ رابط البوت">
      <svg class="tg-copy-icon" ...><!-- copy icon --></svg>
      <span class="tg-copy-label">نسخ الرابط</span>
    </button>
  </div>
</div>
```

*(Arabic glosses: "Verified official bot"; "Available 24/7 on Telegram"; "El-Bash-Mebasmag on Telegram"; description = "Study, create your exams, and browse the platform's courses directly from the Telegram app, anytime and from any device"; pills = "Instant exam creation / Browse courses and files / Read PDF and Word documents / Export in 6 interactive formats"; "Click to enlarge"; "Scan with your phone camera to start chatting instantly"; "Save QR code"; "Open in Telegram"; "Copy bot link"; "Copy link".)*

**Visual system and motion (`telegram-bot-card.css`):**

- Glass gradients:
  ```css
  .tg-bot-card {
    position: relative;
    background: var(--card-bg, rgba(255, 255, 255, 0.75));
    border: 1px solid rgba(36, 161, 222, 0.25);
    border-radius: var(--radius-2xl, 24px);
    box-shadow: 0 12px 36px -8px rgba(36, 161, 222, 0.15), 0 4px 16px rgba(0, 0, 0, 0.05);
    backdrop-filter: var(--glass-blur, blur(16px));
    overflow: hidden;
    transition: transform var(--transition-base), box-shadow var(--transition-base), border-color var(--transition-base);
  }
  [data-theme="dark"] .tg-bot-card,
  [data-theme="dark-slate"] .tg-bot-card {
    background: rgba(18, 26, 38, 0.85);
    border-color: rgba(36, 161, 222, 0.35);
    box-shadow: 0 16px 40px -10px rgba(0, 0, 0, 0.5), 0 0 30px rgba(36, 161, 222, 0.12);
  }
  ```
- Live-connection pulse animation:
  ```css
  .tg-bot-pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    animation: tg-pulse 2s infinite;
  }
  @keyframes tg-pulse {
    0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
    70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
    100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
  }
  ```
- Copy button behavior:
  - The icon turns into a green check and the label changes to "تم النسخ!" ("Copied!").
  - The button returns to its normal state after 2000 ms.

---

### Phase 3: AI assistant integration (`ai-agent.js` and `ai-agent-chat.js`)

1. **Sidebar button**
   - In the sidebar-building function in `public/src/components/ai-agent/ai-agent.js`, add a button between the "Settings" button and the chat history:
     ```javascript
     const sidebarTelegramBtn = document.createElement("button");
     sidebarTelegramBtn.type = "button";
     sidebarTelegramBtn.className = "ai-agent-sidebar-btn ai-agent-sidebar-btn--telegram";
     sidebarTelegramBtn.innerHTML = `${TELEGRAM_PLANE_ICON_SVG}<span>بوت تيليجرام</span>`;
     sidebarTelegramBtn.title = "فتح ومسح رمز بوت تيليجرام";
     sidebarTelegramBtn.addEventListener("click", () => {
       openTelegramBotModal();
       closeMobileSidebarSheet();
     });
     sidebar.appendChild(sidebarTelegramBtn);
     ```
     *(Label = "Telegram bot"; tooltip = "Open and scan the Telegram bot QR code".)*

2. **Welcome banner in a new chat (`ai-agent-chat.js`)**
   - When a new chat opens with no prior messages, show a lightweight dismissible welcome pill:
     *"تفضّل المذاكرة من هاتفك المحمول؟ تواصل مع الباشــمبصمج مباشرة عبر تيليجرام [عرض رمز QR]"*
     ("Prefer studying on your phone? Talk to El-Bash-Mebasmag directly on Telegram [Show QR code]").

3. **Inside settings (`ai-agent-settings.js`)**
   - Add a section titled "الوصول من الهاتف والتطبيقات الخارجية" ("Access from phone and external apps") containing a compact bot card and a scan-QR button.

---

### Phase 4: About page integration (`public/about.html` and `about.css`)

- **Placement:** A full, self-contained section **after** the "How was the platform built?" section (`#stack-heading`) and **before** the "The person behind Basmagi" section (`#creator-heading`).
- **Markup to add in `public/about.html`:**
  ```html
  <section class="about-section telegram-showcase-section" aria-labelledby="telegram-showcase-heading">
      <div class="about-section-heading">
          <div class="hero-kicker telegram-kicker">المذاكرة المتنقلة</div>
          <h2 id="telegram-showcase-heading">الباشــمبصمج معك أينما ذهبت — متوفر الآن على تيليجرام</h2>
          <p>لا تحتاج لفتح المتصفح في كل مرة. يمكنك الآن مناقشة أسئلتك، رفع محاضراتك، وتوليد امتحانات كاملة مباشرة من تطبيق تيليجرام على هاتفك أو حاسوبك.</p>
      </div>

      <div class="about-telegram-container" id="aboutTelegramCardMount">
          <!-- The bot card is activated automatically by the component script -->
      </div>
  </section>
  ```
  *(Kicker = "Mobile studying"; heading = "El-Bash-Mebasmag goes wherever you go, now available on Telegram"; paragraph = "You don't need to open the browser every time. You can now discuss your questions, upload your lectures, and generate full exams directly from the Telegram app on your phone or computer.")*
- **Script and stylesheet in `about.html`:**
  ```html
  <link rel="stylesheet" href="src/components/telegram-bot-card/telegram-bot-card.css">
  <script type="module">
    import { mountTelegramBotCard } from "./src/components/telegram-bot-card/telegram-bot-card.js";
    mountTelegramBotCard(document.getElementById("aboutTelegramCardMount"), { variant: "showcase" });
  </script>
  ```

---

### Phase 5: Assistant guide page integration (`public/how-to-use-ai-agent.html`)

- **Placement:** Add a new numbered main section, **Section 7**, after the "Settings tab" section:
  ```html
  <section class="section" aria-labelledby="s7">
      <h2 id="s7">
          ٧. الباشــمبصمج على تطبيق تيليجرام
          <span class="section-badge">المساعد المتنقل</span>
      </h2>
      <p>بالإضافة إلى وجود المساعد داخل صفحات الموقع، يمكنك الآن التحدث معه مباشرة عبر <strong>تطبيق تيليجرام</strong> بنفس الذكاء والقدرات، مما يمنحك تجربة مذاكرة سريعة في المواصلات أو أثناء تصفح هاتفك دون الحاجة لفتح المتصفح.</p>

      <h3>ما الذي يستطيع فعله البوت على تيليجرام؟</h3>
      <ul>
          <li><strong>إنشاء الامتحانات من الملفات:</strong> أرسل له ملف المحاضرة (PDF، مستند Word، أو صورة) وسيستخرج الأسئلة ويولد امتحاناً جاهزاً.</li>
          <li><strong>تصدير بـ 6 صيغ مختلفة:</strong> اطلب منه الامتحان كملف تفاعلي HTML للحل أوفلاين، مستند PDF منسق للطباعة، ملف Word، أو ملفات Markdown و JSON.</li>
          <li><strong>البحث في المقررات:</strong> اسأله عن المواد والمجلدات والامتحانات المنشورة على المنصة، وسيجلب لك محتوياتها فوراً.</li>
          <li><strong>مساعد دراسي ذكي:</strong> اشرح له أي مسألة أو اطلب منه اختبارك في أي موضوع بصورة تفاعلية خطوة بخطوة.</li>
      </ul>

      <h3>كيف تبدأ في ٣ خطوات بسيطة:</h3>
      <ol>
          <li>امسح رمز الاستجابة السريعة (QR Code) أدناه بكاميرا هاتفك أو اضغط على زر "فتح في تيليجرام".</li>
          <li>اضغط على زر <strong>Start</strong> (ابدأ) داخل محادثة البوت.</li>
          <li>ابدأ فوراً بكتابة سؤالك، طلب امتحانك، أو إرفاق ملف محاضرتك!</li>
      </ol>

      <div class="how-to-telegram-container" id="howToTelegramMount">
          <!-- Interactive bot card -->
      </div>
  </section>
  ```
  *(English gloss of the copy: Heading = "7. El-Bash-Mebasmag on the Telegram app" with badge "Mobile assistant". Intro: besides living inside the website's pages, you can now chat with it directly in the Telegram app with the same intelligence and capabilities, for quick study on transit or while browsing your phone, without opening the browser. "What can the bot do on Telegram?": (1) Create exams from files: send a lecture file (PDF, Word, or image) and it extracts questions and generates a ready exam; (2) Export in 6 formats: ask for the exam as an offline-solvable interactive HTML, a print-formatted PDF, a Word file, or Markdown and JSON files; (3) Search courses: ask about subjects, folders, and exams published on the platform and it fetches their contents instantly; (4) Smart study assistant: have it explain any problem or quiz you on any topic interactively, step by step. "Get started in 3 simple steps": (1) scan the QR code below with your phone camera or press "Open in Telegram"; (2) press **Start** in the bot chat; (3) immediately type your question, request your exam, or attach your lecture file.)*
- **Table of contents (ToC):** `doc-toc.js` automatically detects `h2#s7` and adds it to the interactive sidebar with no further changes. Verify this.
- Import `mountTelegramBotCard` and call it on `#howToTelegramMount` with `{ variant: "showcase" }`, and include the component CSS.

---

### Phase 6 (extra): Global side menu (`public/src/components/side-menu/side-menu.js`)

- Add a `compact-link` entry (or a button that calls `openTelegramBotModal()`) among the platform tools so it is reachable from any page.

---

## 5. Sequential Execution Plan

### Stage 1: Core component and vector QR engine
- [ ] Create `public/src/components/telegram-bot-card/qr-svg-engine.js` with a pure, lightweight QR algorithm that outputs SVG with no dependencies.
- [ ] Create `public/src/components/telegram-bot-card/telegram-bot-card.css` with all glass styles, gradients, and motion transitions, using variables from `themes.css`.
- [ ] Create `public/src/components/telegram-bot-card/telegram-bot-card.js` exporting `createTelegramBotCard`, `openTelegramBotModal`, `mountTelegramBotCard`, and `copyTelegramBotLink`.

### Stage 2: AI assistant UI integration
- [ ] Edit `public/src/components/ai-agent/ai-agent.js` to add the Telegram button in the sidebar (desktop and mobile sheet) wired to `openTelegramBotModal()`.
- [ ] Edit `public/src/components/ai-agent/ai-agent.css` to style the Telegram-blue sidebar button.
- [ ] Edit `public/src/components/ai-agent/ai-agent-chat.js` to add the Telegram invitation card on the empty-chat welcome screen.
- [ ] Edit `public/src/components/ai-agent/ai-agent-settings.js` to add the "Access from phone and external apps" section.

### Stage 3: Assistant guide page
- [ ] Edit `public/how-to-use-ai-agent.html` to add Section 7 with the full explanation and wire the component script to create the card in `#howToTelegramMount`.
- [ ] Verify the automatic ToC (`doc-toc.js`) picks up the new section.

### Stage 4: About page
- [ ] Edit `public/about.html` to add the `#telegram-showcase-heading` section and the `#aboutTelegramCardMount` container.
- [ ] Edit `public/src/features/documents/about.css` to tune spacing and responsiveness of the Telegram section within the page grid.

### Stage 5: Side menu
- [ ] Edit `public/src/components/side-menu/side-menu.js` to add the compact Telegram link/button.

### Stage 6: Verification, testing, and sign-off
- [ ] Scan the QR with real smartphone cameras (iOS and Android) and confirm it opens the bot directly.
- [ ] Test the copy button across browsers (including the clipboard fallback) and confirm the success notification appears.
- [ ] Test the smart launch button (`tg://` attempt, then `https://t.me/...` fallback).
- [ ] Test switching between Light, Dark, and Dark-Slate themes for color match and contrast.
- [ ] Test responsiveness on Desktop, Tablet, and Mobile (320px to 2560px).
- [ ] Test reduced-motion mode and keyboard-only navigation.

---

## 6. Acceptance and Quality Criteria

1. **Link integrity:** The URL is always `https://t.me/basmagi_quiz_bot` and the handle is always `@basmagi_quiz_bot`.
2. **QR independence:** The code is generated entirely client-side as pure SVG, with no external requests and no CDN dependency.
3. **Responsiveness and performance:** Instant rendering with no perceptible delay, and full support for screens from 320px to 2560px.
4. **Rich aesthetics:** A premium design that merges Telegram's identity with the Basmagi design system, with a floating notification and precise tactile interactions.
5. **Accessibility:** All buttons and links carry explicit `aria-label` attributes, and everything is fully keyboard-operable.

---

**The plan is complete and ready to begin on signal.**

---

## Appendix: Notes on the Source Plan (for the implementing AI)

- The source says "3 main locations" but lists 4 (the side menu is the extra one). All four are included above.
- The source's Phase 3 mentions `ai-agent-settings.js` and the integration map mentions `side-menu.js`, but the original checklist omitted them. They have been added to the execution plan here.
- The copy says "6 export formats" but names only HTML, PDF, Word, Markdown, and JSON (5). Keep the "6" wording as written in the UI, and check the bot's real export list before finalizing the copy.
- `TELEGRAM_PLANE_ICON_SVG` and `closeMobileSidebarSheet` are referenced but not defined in the plan. Create the icon constant in the new component (and export it), and locate or reuse the existing mobile-sheet close helper.