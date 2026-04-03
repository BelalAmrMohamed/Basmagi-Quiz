// src/scripts/exportToPptx.js
// Downloads the quiz as a PowerPoint file (.pptx)
// Deals with the export from both main page and results page
// `PptxGenJS` library used, included in this file.

import { showNotification } from "../components/notifications.js";

// `gradeEssay` must be used for essay grading, see export-to-markdown for example usage.
import { gradeEssay, isEssayQuestion } from "../shared/rate-answers.js";

let pptxgen;

async function loadPptxGen() {
  if (!pptxgen) {
    // This is the official "PptxGenJS" library being used, which doesn't support animtions nor transition [unfortunetally].
    // The best library to use would be Syncfusion .NET PowerPoint library, but it's .Net, not great for performance here.
    // For feuture undates with animations and transitions, use this fork, which supports them:
    // const module = await import("https://esm.sh/@bapunhansdah/pptxgenjs");
    const module =
      await import("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/+esm");
    pptxgen = module.default;
    window.pptxgen = pptxgen;
  }
  return pptxgen;
}

export async function exportToPptx(config, questions, userAnswers = []) {
  try {
    await loadPptxGen();

    // ===========================
    // VALIDATION
    // ===========================
    if (!config || !questions || !Array.isArray(questions)) {
      throw new Error(
        "Invalid parameters: config and questions array required",
      );
    }

    // ===========================
    // INITIALIZE PRESENTATION
    // ===========================
    const pptx = new pptxgen();

    // ===========================
    // CONSTANTS & CONFIGURATION
    // ===========================
    const SLIDE_WIDTH = 10;
    const SLIDE_HEIGHT = 5.625;
    const MARGIN = 0.4;
    const HEADER_HEIGHT = 0.8;
    const FOOTER_HEIGHT = 0.4;
    const USABLE_HEIGHT =
      SLIDE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - MARGIN * 2;
    const USABLE_WIDTH = SLIDE_WIDTH - MARGIN * 2;
    const MAX_IMAGE_HEIGHT = USABLE_HEIGHT * 0.35;

    // Modern Color Palette
    const COLORS = Object.freeze({
      primary: "4F46E5", // Indigo 600
      primaryLight: "818CF8", // Indigo 400
      secondary: "F59E0B", // Amber 500
      accent: "06B6D4", // Cyan 500
      success: "10B981", // Emerald 500
      error: "EF4444", // Red 500
      warning: "F97316", // Orange 500
      info: "3B82F6", // Blue 500
      background: "F8FAFC", // Slate 50
      surface: "FFFFFF", // White
      textDark: "1E293B", // Slate 800
      textMedium: "475569", // Slate 600
      textLight: "94A3B8", // Slate 400
      border: "CBD5E1", // Slate 300
      optionNeutral: "F1F5F9", // Slate 100
      userWrong: "FEE2E2", // Red 100
      correctBg: "D1FAE5", // Emerald 100
      explanationBg: "FFF7ED", // Orange 50
    });

    // ===========================
    // UTILITY FUNCTIONS
    // ===========================
    const sanitizeText = (text) => {
      if (text === null || text === undefined) return "";
      return String(text)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip real control chars only
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
    };

    function calculateScore() {
      let correct = 0,
        wrong = 0,
        skipped = 0,
        essayCount = 0,
        totalScorable = 0;
      questions.forEach((q, i) => {
        const userAns = userAnswers[i];
        if (isEssayQuestion(q)) {
          essayCount++;
        } else {
          totalScorable++;
          if (userAns === undefined || userAns === null) {
            skipped++;
          } else if (userAns === q.correct) {
            correct++;
          } else {
            wrong++;
          }
        }
      });
      const percentage =
        totalScorable > 0 ? Math.round((correct / totalScorable) * 100) : 0;
      const isPassing = percentage >= 70;
      return {
        correct,
        wrong,
        skipped,
        essayCount,
        totalScorable,
        percentage,
        isPassing,
      };
    }

    async function getImageDimensions(imageSource) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => reject(new Error("Failed to load image"));
        img.crossOrigin = "Anonymous";
        img.src = imageSource;
      });
    }

    function calculateImageSize(imgWidth, imgHeight, maxWidth, maxHeight) {
      const aspectRatio = imgWidth / imgHeight;
      let width = maxWidth;
      let height = width / aspectRatio;

      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      return { width, height, aspectRatio };
    }

    const userName = localStorage.getItem("username") || "User";
    const documentTitle = sanitizeText(config.title || "Quiz Quest");

    const isResultsMode =
      userAnswers &&
      (Array.isArray(userAnswers)
        ? userAnswers.length > 0
        : Object.keys(userAnswers).length > 0);

    const scoreData = isResultsMode ? calculateScore() : null;

    // ===========================
    // PRESENTATION PROPERTIES
    // ===========================
    pptx.author = "Belal Amr - Quiz Quest";
    pptx.title = documentTitle;
    pptx.subject = "Interactive Quiz Results";
    pptx.layout = "LAYOUT_16x9";
    pptx.theme = { bodyFont: "Segoe UI" }; // Set default font

    // ===========================
    // SLIDE HELPERS
    // ===========================
    function addBackground(slide) {
      slide.background = { color: COLORS.background };
      // Add subtle side accent
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: 0,
        y: 0,
        w: 0.15,
        h: SLIDE_HEIGHT,
        fill: { color: COLORS.primary },
      });
    }

    function addHeader(slide) {
      // Title
      slide.addText(documentTitle, {
        x: MARGIN,
        y: 0.15,
        w: USABLE_WIDTH * 0.6,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: COLORS.primary,
        align: "left",
        fontFace: "Segoe UI Semibold",
      });

      // User Name / Subtitle
      slide.addText(userName, {
        x: MARGIN + USABLE_WIDTH * 0.6,
        y: 0.15,
        w: USABLE_WIDTH * 0.4,
        h: 0.4,
        fontSize: 12,
        color: COLORS.textLight,
        align: "right",
      });

      // Divider Line
      slide.addShape(pptx.shapes.LINE, {
        x: MARGIN,
        y: 0.6,
        w: USABLE_WIDTH,
        h: 0,
        line: { color: COLORS.border, width: 1 },
      });
    }

    function addFooter(slide) {
      slide.addText("صنع بواسطة منصة إمتحانات بصمجي", {
        x: MARGIN,
        y: SLIDE_HEIGHT - FOOTER_HEIGHT,
        w: USABLE_WIDTH,
        h: FOOTER_HEIGHT,
        fontSize: 9,
        color: COLORS.textLight,
        align: "center",
      });
    }

    // ===========================
    // TITLE SLIDE
    // ===========================
    const titleSlide = pptx.addSlide();
    addBackground(titleSlide);

    // Decorative shapes for Title Slide
    titleSlide.addShape(pptx.shapes.OVAL, {
      x: SLIDE_WIDTH - 2.5,
      y: -0.5,
      w: 3,
      h: 3,
      fill: { color: COLORS.primaryLight, transparency: 80 },
    });
    titleSlide.addShape(pptx.shapes.OVAL, {
      x: -0.5,
      y: SLIDE_HEIGHT - 2,
      w: 3,
      h: 3,
      fill: { color: COLORS.secondary, transparency: 80 },
    });

    titleSlide.addText(documentTitle, {
      x: 1,
      y: 1.8,
      w: 8,
      h: 1,
      fontSize: 40,
      bold: true,
      color: COLORS.textDark,
      align: "center",
      fontFace: "Segoe UI Black",
    });

    titleSlide.addText(
      isResultsMode ? "Interactive Results Review" : "Quiz Preview",
      {
        x: 1,
        y: 2.8,
        w: 8,
        h: 0.5,
        fontSize: 20,
        color: COLORS.primary,
        align: "center",
        fontFace: "Segoe UI Semibold",
      },
    );

    titleSlide.addText(`${questions.length} Questions`, {
      x: 1,
      y: 3.4,
      w: 8,
      h: 0.4,
      fontSize: 14,
      color: COLORS.textMedium,
      align: "center",
    });

    // ===========================
    // RESULTS SUMMARY SLIDE
    // ===========================
    if (isResultsMode && scoreData) {
      const summarySlide = pptx.addSlide();
      addBackground(summarySlide);

      addHeader(summarySlide);
      addFooter(summarySlide);

      summarySlide.addText("PERFORMANCE SUMMARY", {
        x: MARGIN,
        y: 0.9,
        w: USABLE_WIDTH,
        h: 0.5,
        fontSize: 24,
        bold: true,
        color: COLORS.textDark,
        align: "center",
      });

      // Score Circle
      summarySlide.addShape(pptx.shapes.OVAL, {
        x: SLIDE_WIDTH / 2 - 1.25,
        y: 1.8,
        w: 2.5,
        h: 2.5,
        fill: { color: COLORS.surface },
        line: {
          color: scoreData.isPassing ? COLORS.success : COLORS.warning,
          width: 5,
        },
      });

      summarySlide.addText(`${scoreData.percentage}%`, {
        x: SLIDE_WIDTH / 2 - 1.25,
        y: 1.8,
        w: 2.5,
        h: 2.5,
        fontSize: 48,
        bold: true,
        color: COLORS.textDark,
        align: "center",
      });

      const message = scoreData.isPassing
        ? "Excellent Work!"
        : "Development Needed";
      summarySlide.addText(message, {
        x: MARGIN,
        y: 4.5,
        w: USABLE_WIDTH,
        h: 0.4,
        fontSize: 18,
        bold: true,
        color: scoreData.isPassing ? COLORS.success : COLORS.warning,
        align: "center",
      });

      // Stats Table
      const statsData = [
        [
          {
            text: "Metric",
            options: {
              bold: true,
              fontSize: 12,
              fill: COLORS.primary,
              color: "FFFFFF",
            },
          },
          {
            text: "Value",
            options: {
              bold: true,
              fontSize: 12,
              fill: COLORS.primary,
              color: "FFFFFF",
            },
          },
        ],
        [
          {
            text: "Correct Answers",
            options: { fontSize: 12, fill: "FFFFFF" },
          },
          {
            text: `${scoreData.correct} / ${scoreData.totalScorable}`,
            options: {
              fontSize: 12,
              color: COLORS.success,
              bold: true,
              fill: "FFFFFF",
            },
          },
        ],
        [
          {
            text: "Incorrect Answers",
            options: { fontSize: 12, fill: COLORS.background },
          },
          {
            text: String(scoreData.wrong),
            options: {
              fontSize: 12,
              color: COLORS.error,
              bold: true,
              fill: COLORS.background,
            },
          },
        ],
        [
          { text: "Skipped", options: { fontSize: 12, fill: "FFFFFF" } },
          {
            text: String(scoreData.skipped),
            options: { fontSize: 12, color: COLORS.textMedium, fill: "FFFFFF" },
          },
        ],
      ];

      summarySlide.addTable(statsData, {
        x: SLIDE_WIDTH / 2 + 1.8,
        y: 1.8,
        w: 3,
        h: 1.5,
        border: { pt: 0, color: COLORS.border },
        align: "left",
        valign: "middle",
      });
    }

    // ===========================
    // QUESTION SLIDES
    // ===========================
    for (const [index, question] of questions.entries()) {
      const slide = pptx.addSlide();
      addBackground(slide);

      addHeader(slide);
      addFooter(slide);

      const isEssay = isEssayQuestion(question);
      const userAns = userAnswers[index];
      const questionText = sanitizeText(question.q);
      const hasUserAnswer =
        isResultsMode && userAns !== undefined && userAns !== null;

      let currentY = 0.8; // Start after header

      // Status Badge
      let statusText = "";
      let statusBg = COLORS.background;
      let statusColor = COLORS.textLight;

      if (isResultsMode) {
        if (isEssay) {
          statusText = "ESSAY";
          statusBg = COLORS.warning;
          statusColor = "FFFFFF";
        } else if (!hasUserAnswer) {
          statusText = "SKIPPED";
          statusBg = COLORS.textLight;
          statusColor = "FFFFFF";
        } else if (userAns === question.correct) {
          statusText = "CORRECT";
          statusBg = COLORS.success;
          statusColor = "FFFFFF";
        } else {
          statusText = "WRONG";
          statusBg = COLORS.error;
          statusColor = "FFFFFF";
        }

        // Add Badge
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
          x: MARGIN,
          y: currentY,
          w: 1.2,
          h: 0.3,
          r: 0.15,
          fill: { color: statusBg },
        });
        slide.addText(statusText, {
          x: MARGIN,
          y: currentY,
          w: 1.2,
          h: 0.3,
          fontSize: 10,
          bold: true,
          color: statusColor,
          align: "center",
        });
      }

      // Question Number
      slide.addText(`Question ${index + 1}`, {
        x: isResultsMode ? MARGIN + 1.3 : MARGIN,
        y: currentY,
        w: 4,
        h: 0.3,
        fontSize: 14,
        bold: true,
        color: COLORS.primary,
      });

      currentY += 0.4;

      // ===========================
      // IMAGE & TEXT LAYOUT
      // ===========================
      let imageProcessed = false;

      if (question.image) {
        try {
          const imgDims = await getImageDimensions(question.image);
          const aspectRatio = imgDims.width / imgDims.height;
          const isWide = aspectRatio >= 1.2;

          let imgSize = calculateImageSize(
            imgDims.width,
            imgDims.height,
            isWide ? USABLE_WIDTH * 0.4 : USABLE_WIDTH * 0.8,
            MAX_IMAGE_HEIGHT,
          );

          if (isWide && imgSize.width < USABLE_WIDTH * 0.5) {
            // Side-by-side: Text Left, Image Right
            const textWidth = USABLE_WIDTH - imgSize.width - 0.4;

            slide.addText(questionText, {
              x: MARGIN,
              y: currentY,
              w: textWidth,
              h: 1, // Auto-expand
              fontSize: 16,
              color: COLORS.textDark,
              bold: true,
              valign: "top",
              wrap: true,
            });

            slide.addImage({
              path: question.image,
              x: MARGIN + textWidth + 0.2,
              y: currentY,
              w: imgSize.width,
              h: imgSize.height,
            });

            currentY += Math.max(imgSize.height, 0.8) + 0.2;
          } else {
            // Stacked: Image then Text
            slide.addImage({
              path: question.image,
              x: (SLIDE_WIDTH - imgSize.width) / 2, // Center
              y: currentY,
              w: imgSize.width,
              h: imgSize.height,
            });

            currentY += imgSize.height + 0.2;

            slide.addText(questionText, {
              x: MARGIN,
              y: currentY,
              w: USABLE_WIDTH,
              h: 0.5,
              fontSize: 16,
              color: COLORS.textDark,
              bold: true,
              valign: "top",
              wrap: true,
            });

            currentY += 0.6;
          }
          imageProcessed = true;
        } catch (err) {
          console.warn("Failed to load image:", err);
        }
      }

      if (!imageProcessed) {
        slide.addText(questionText, {
          x: MARGIN,
          y: currentY,
          w: USABLE_WIDTH,
          h: 0.5,
          fontSize: 18, // Slightly larger if no image
          color: COLORS.textDark,
          bold: true,
          valign: "top",
          wrap: true,
        });
        currentY += 0.6;
      }

      // ===========================
      // OPTIONS / ANSWER AREA
      // ===========================
      const remainingHeight = SLIDE_HEIGHT - FOOTER_HEIGHT - currentY - MARGIN;
      const hasExplanation =
        question.explanation && question.explanation.trim();
      const explanationHeight = hasExplanation ? 0.8 : 0;
      const availableOptionsHeight = remainingHeight - explanationHeight;

      if (isEssay) {
        // Essay Layout
        const boxHeight = Math.min(availableOptionsHeight / 2.2, 0.8);

        // Correct Answer (Hidden)
        slide.addText("CORRECT ANSWER:", {
          x: MARGIN,
          y: currentY,
          w: USABLE_WIDTH,
          h: 0.3,
          fontSize: 11,
          bold: true,
          color: COLORS.success,
        });

        slide.addText(sanitizeText(question.answer), {
          x: MARGIN,
          y: currentY + 0.3,
          w: USABLE_WIDTH,
          h: boxHeight,
          fontSize: 12,
          color: COLORS.textDark,
          fill: { color: COLORS.correctBg },
          inset: 0.1, // Fixed padding
          wrap: true,
          valign: "top",
        });

        currentY += boxHeight + 0.4;
      } else {
        // Multiple Choice Layout
        const optionCount = question.options.length;
        const useTwoCols = optionCount > 3;

        const optionH = Math.min(
          availableOptionsHeight /
            (useTwoCols ? Math.ceil(optionCount / 2) : optionCount) -
            0.1,
          0.5,
        );
        const colWidth = useTwoCols ? (USABLE_WIDTH - 0.2) / 2 : USABLE_WIDTH;

        question.options.forEach((opt, idx) => {
          const isCorrect = idx === question.correct;
          const isUserSel = hasUserAnswer && idx === userAnswers[index];
          const label = String.fromCharCode(65 + idx);

          let r = Math.floor(idx / (useTwoCols ? 2 : 1));
          let c = idx % (useTwoCols ? 2 : 1);

          let x = MARGIN + c * (colWidth + 0.2);
          let y = currentY + r * (optionH + 0.1);

          // Base Option
          slide.addText(`${label}. ${sanitizeText(opt)}`, {
            x: x,
            y: y,
            w: colWidth,
            h: optionH,
            fontSize: 12,
            color: COLORS.textDark,
            fill: { color: COLORS.surface },
            line: { color: COLORS.border, width: 1 },
            inset: 0.1, // Fixed padding
            valign: "middle",
            wrap: true,
          });

          // Highlights (Correct/Wrong) - Overlay shapes
          if (isCorrect) {
            slide.addShape(pptx.shapes.RECTANGLE, {
              x: x,
              y: y,
              w: colWidth,
              h: optionH,
              fill: { color: COLORS.success, transparency: 80 },
              line: { color: COLORS.success, width: 2 },
            });
          } else if (isUserSel && !isCorrect) {
            slide.addShape(pptx.shapes.RECTANGLE, {
              x: x,
              y: y,
              w: colWidth,
              h: optionH,
              fill: { color: COLORS.error, transparency: 80 },
              line: { color: COLORS.error, width: 2 },
            });
          }
        });

        currentY +=
          Math.ceil(optionCount / (useTwoCols ? 2 : 1)) * (optionH + 0.1) + 0.2;
      }

      // Explanation
      if (hasExplanation) {
        slide.addText("EXPLANATION:", {
          x: MARGIN,
          y: currentY,
          w: USABLE_WIDTH,
          h: 0.3,
          fontSize: 11,
          bold: true,
          color: COLORS.primary,
        });

        slide.addText(sanitizeText(question.explanation), {
          x: MARGIN,
          y: currentY + 0.3,
          w: USABLE_WIDTH,
          h: Math.min(SLIDE_HEIGHT - FOOTER_HEIGHT - currentY - 0.4, 0.8),
          fontSize: 11,
          color: COLORS.textMedium,
          fill: { color: COLORS.explanationBg },
          inset: 0.1, // Fixed padding
          valign: "top",
          wrap: true,
        });
      }
    }

    // ===========================
    // CTA SLIDE
    // ===========================
    const ctaSlide = pptx.addSlide();
    ctaSlide.background = { color: COLORS.background };

    addHeader(ctaSlide);
    addFooter(ctaSlide);

    ctaSlide.addText("🎮 End 🎮", {
      x: 1,
      y: 1.4,
      w: 8,
      h: 0.7,
      fontSize: 50,
      bold: true,
      color: COLORS.primary,
      align: "center",
    });

    ctaSlide.addText("READY FOR MORE?", {
      x: 1,
      y: 2.3,
      w: 8,
      h: 0.5,
      fontSize: 28,
      bold: true,
      color: COLORS.primary,
      align: "center",
    });

    ctaSlide.addText("https://basmagi-quiz.vercel.app/", {
      x: 1,
      y: 3.1,
      w: 8,
      h: 0.3,
      fontSize: 18,
      bold: true,
      color: COLORS.info,
      align: "center",
      hyperlink: {
        url: "https://basmagi-quiz.vercel.app/",
        tooltip: "Go to The quiz website again.",
      },
    });

    // ===========================
    // SAVE FILE
    // ===========================
    const now = new Date();
    const fileName = `${documentTitle}.pptx`;

    await pptx.writeFile({ fileName });

    showNotification(
      "PowerPoint file downloaded.",
      "You have it now",
      "./assets/images/pptx_icon.png",
    );

    return true;
  } catch (error) {
    console.error("PPTX Export Error:", error);
    throw error;
  }
}
