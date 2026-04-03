// src/scripts/export-to-word.js
// Downloads the quiz as a Word file (.docx)
// Deals with the export from both main page and results page
// `docx` library used, included in this file.

import { showNotification } from "../components/notifications.js";

// `gradeEssay` must be used for essay grading, see export-to-markdown for example usage.
import { gradeEssay, isEssayQuestion } from "../shared/rate-answers.js";

const userName = localStorage.getItem("username") || "User";
let docx;

async function loadDocx() {
  if (!docx) {
    docx = await import("https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm");
    window.docx = docx; // Make it globally available
  }
  return docx;
}

export async function exportToWord(config, questions, userAnswers = []) {
  try {
    await loadDocx();

    // ===========================
    // VALIDATION
    // ===========================
    if (!config || !questions || !Array.isArray(questions)) {
      throw new Error(
        "Invalid parameters: config and questions array required",
      );
    }

    if (!window.docx) {
      throw new Error("docx library not loaded");
    }

    const {
      Document,
      Packer,
      Paragraph,
      Table,
      TableRow,
      TableCell,
      TextRun,
      ImageRun,
      BorderStyle,
      AlignmentType,
      WidthType,
      ShadingType,
      PageBreak,
      HeadingLevel,
      UnderlineType,
      Header,
      Footer,
      PageNumber,
      ExternalHyperlink,
      convertInchesToTwip,
    } = window.docx;

    // ===========================
    // GAMIFICATION COLORS (RGB to HEX)
    // ===========================
    const COLORS = Object.freeze({
      primary: "6A5ACD", // Slate Blue
      secondary: "FFD700", // Gold
      accent: "FF69B4", // Hot Pink

      success: "2ED573", // Bright Green
      error: "FF4757", // Bright Red
      warning: "FFA801", // Amber
      info: "34ACE0", // Sky Blue

      cardBg: "F8FAFC", // Light Gray
      cardBorder: "6A5ACD", // Matches primary

      textDark: "1E293B", // Dark Slate
      textLight: "64748B", // Light Slate
      textWhite: "FFFFFF", // White

      buttonCorrect: "10B981", // Emerald
      buttonWrong: "EF4444", // Red
      buttonNeutral: "CBD5E1", // Slate 300

      progressBarBg: "E2E8F0", // Light gray
      progressBarFill: "FFD700", // Gold
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

    // ===========================
    // Document Title
    // ===========================

    const documentTitle = config.title || "Quiz Quest";

    // ===========================
    // IMAGE PROCESSING
    // ===========================

    const processImageForWord = async (imageSource) => {
      try {
        let imageData = imageSource;

        // Convert SVG to PNG if needed
        if (
          imageSource.includes("<svg") ||
          imageSource.includes("data:image/svg+xml")
        ) {
          imageData = await svgToDataUrl(imageSource);
        } else if (!imageSource.startsWith("data:")) {
          imageData = await getDataUrl(imageSource);
        }

        // Fetch the image as blob
        const response = await fetch(imageData);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        // Get dimensions
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imageData;
        });

        // Calculate constrained dimensions (max width: 6 inches for Word)
        const maxWidthInches = 6;
        const maxHeightInches = 4;
        const { width, height } = getConstrainedDimensionsWord(
          img.width,
          img.height,
          maxWidthInches * 96, // Convert to pixels
          maxHeightInches * 96,
        );

        return {
          data: arrayBuffer,
          width: width,
          height: height,
          success: true,
        };
      } catch (err) {
        console.warn("Failed to process image for Word:", err);
        return { success: false };
      }
    };

    const getDataUrl = async (url) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = url;
      });
    };

    const svgToDataUrl = async (svgString) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const blob = new Blob([svgString], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width || 800;
          canvas.height = img.height || 600;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/png"));
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Failed to convert SVG"));
        };

        img.src = url;
      });
    };

    const getConstrainedDimensionsWord = (
      imgWidth,
      imgHeight,
      maxWidth,
      maxHeight,
    ) => {
      const aspectRatio = imgWidth / imgHeight;
      let width = maxWidth;
      let height = width / aspectRatio;

      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      return { width, height };
    };

    // ===========================
    // SCORE CALCULATION
    // ===========================

    const calculateScore = () => {
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
    };

    const scoreData = calculateScore();
    const isResultsMode =
      userAnswers &&
      (Array.isArray(userAnswers)
        ? userAnswers.length > 0
        : Object.keys(userAnswers).length > 0);

    // ===========================
    // CREATE HEADER (Appears on every page)
    // ===========================

    const header = new Header({
      children: [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0 },
            bottom: {
              style: BorderStyle.SINGLE,
              size: 12,
              color: COLORS.secondary,
            },
            left: { style: BorderStyle.NONE, size: 0 },
            right: { style: BorderStyle.NONE, size: 0 },
            insideHorizontal: { style: BorderStyle.NONE, size: 0 },
            insideVertical: { style: BorderStyle.NONE, size: 0 },
          },
          rows: [
            new TableRow({
              children: [
                // LEFT: Title
                new TableCell({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.LEFT,
                      children: [
                        new TextRun({
                          text: documentTitle,
                          bold: true,
                          size: 28,
                          color: COLORS.primary,
                        }),
                      ],
                    }),
                  ],
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0 },
                    bottom: { style: BorderStyle.NONE, size: 0 },
                    left: { style: BorderStyle.NONE, size: 0 },
                    right: { style: BorderStyle.NONE, size: 0 },
                  },
                  width: { size: 50, type: WidthType.PERCENTAGE },
                }),
                // RIGHT: Username
                new TableCell({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: `🏆 ${userName}`,
                          bold: true,
                          size: 24,
                          color: COLORS.secondary,
                        }),
                      ],
                    }),
                  ],
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0 },
                    bottom: { style: BorderStyle.NONE, size: 0 },
                    left: { style: BorderStyle.NONE, size: 0 },
                    right: { style: BorderStyle.NONE, size: 0 },
                  },
                  width: { size: 50, type: WidthType.PERCENTAGE },
                }),
              ],
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [],
        }),
      ],
    });

    // ===========================
    // DOCUMENT SECTIONS
    // ===========================

    const children = [];

    // ===========================
    // SCORE PAGE (if summary mode)
    // ===========================

    if (isResultsMode) {
      // "QUIZ COMPLETE!" Banner
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 200 },
          children: [
            new TextRun({
              text: "🎯 QUIZ COMPLETE! 🎯",
              bold: true,
              size: 40,
              color: COLORS.primary,
            }),
          ],
        }),
      );

      // Score Circle (simulated with text)
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({
              text: `${scoreData.percentage}%`,
              bold: true,
              size: 72,
              color: scoreData.isPassing ? COLORS.success : COLORS.warning,
            }),
          ],
        }),
      );

      // Motivational Message
      const message = scoreData.isPassing
        ? "🏆 LEGENDARY! 🏆"
        : "💪 KEEP GRINDING! 💪";
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: message,
              bold: true,
              size: 36,
              color: COLORS.primary,
            }),
          ],
        }),
      );

      // Stats Table
      const statsTable = new Table({
        width: { size: 80, type: WidthType.PERCENTAGE },
        alignment: AlignmentType.CENTER,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 3, color: COLORS.primary },
          bottom: { style: BorderStyle.SINGLE, size: 3, color: COLORS.primary },
          left: { style: BorderStyle.SINGLE, size: 3, color: COLORS.primary },
          right: { style: BorderStyle.SINGLE, size: 3, color: COLORS.primary },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: `Score: ${scoreData.correct} / ${scoreData.totalScorable}`,
                        bold: true,
                        size: 24,
                        color: COLORS.textDark,
                      }),
                    ],
                  }),
                ],
                shading: { fill: COLORS.cardBg, type: ShadingType.CLEAR },
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: `✓ Correct: ${scoreData.correct}  ✗ Wrong: ${scoreData.wrong}  ⊝ Skipped: ${scoreData.skipped}`,
                        size: 20,
                        color: COLORS.textLight,
                      }),
                    ],
                  }),
                ],
                shading: { fill: COLORS.cardBg, type: ShadingType.CLEAR },
              }),
            ],
          }),
        ],
      });

      children.push(
        new Paragraph({
          spacing: { before: 200, after: 400 },
          children: [],
        }),
      );
      children.push(statsTable);

      // Section Divider
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 400, after: 400 },
          border: {
            bottom: {
              color: COLORS.primary,
              space: 1,
              style: BorderStyle.DOUBLE,
              size: 12,
            },
          },
        }),
      );
    }

    // ===========================
    // RENDER QUESTIONS
    // ===========================

    for (const [index, question] of questions.entries()) {
      const isEssay = isEssayQuestion(question);
      const userAns = userAnswers[index];
      const questionText = sanitizeText(question.q);

      // Question Header Paragraph
      const questionHeaderChildren = [
        new TextRun({
          text: `Question #${index + 1}`,
          bold: true,
          size: 24,
          color: COLORS.primary,
        }),
      ];

      // Add status badge if in summary mode
      if (isResultsMode) {
        const { statusText, statusColor } = getQuestionStatus(
          question,
          userAns,
          isEssay,
        );
        questionHeaderChildren.push(
          new TextRun({
            text: `       [${statusText}]`,
            bold: true,
            size: 20,
            color: statusColor,
          }),
        );
      }

      const questionHeader = new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 100, after: 100 },
        children: questionHeaderChildren,
      });

      // Question Text
      const questionParagraph = new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 100, after: 200 },
        children: [
          new TextRun({
            text: questionText,
            size: 24,
            color: COLORS.textDark,
          }),
        ],
      });

      // Card Children (goes inside the table cell)
      const cardChildren = [questionHeader, questionParagraph];

      // Process and add image if exists
      if (question.image) {
        const imageInfo = await processImageForWord(question.image);
        if (imageInfo.success) {
          cardChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 200, after: 200 },
              children: [
                new ImageRun({
                  data: imageInfo.data,
                  transformation: {
                    width: imageInfo.width,
                    height: imageInfo.height,
                  },
                }),
              ],
            }),
          );
        }
      }

      // Render options
      if (isEssay) {
        // Essay Answer
        const userText = sanitizeText(userAns || "Not answered");
        const formalAnswer = sanitizeText(question.answer);

        // User Answer Box
        if (isResultsMode) {
          cardChildren.push(
            new Paragraph({
              spacing: { before: 200, after: 100 },
              children: [
                new TextRun({
                  text: "YOUR ANSWER:",
                  bold: true,
                  size: 20,
                  color: COLORS.primary,
                }),
              ],
            }),
          );

          cardChildren.push(
            new Paragraph({
              spacing: { after: 200 },
              children: [
                new TextRun({
                  text: userText,
                  size: 20,
                  color: COLORS.textDark,
                }),
              ],
              shading: { fill: "F5F7FA", type: ShadingType.CLEAR },
              border: {
                top: {
                  style: BorderStyle.SINGLE,
                  size: 3,
                  color: COLORS.textLight,
                },
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 3,
                  color: COLORS.textLight,
                },
                left: {
                  style: BorderStyle.SINGLE,
                  size: 3,
                  color: COLORS.textLight,
                },
                right: {
                  style: BorderStyle.SINGLE,
                  size: 3,
                  color: COLORS.textLight,
                },
              },
            }),
          );
        }

        // Formal Answer Box
        cardChildren.push(
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: "CORRECT ANSWER:",
                bold: true,
                size: 20,
                color: COLORS.success,
              }),
            ],
          }),
        );

        cardChildren.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: formalAnswer,
                size: 20,
                color: COLORS.textDark,
              }),
            ],
            shading: { fill: "F0FDF4", type: ShadingType.CLEAR },
            border: {
              top: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.success,
              },
              bottom: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.success,
              },
              left: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.success,
              },
              right: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.success,
              },
            },
          }),
        );
      } else {
        // Multiple Choice Options
        question.options.forEach((opt, optIndex) => {
          const isUserAns = optIndex === userAns;
          const isCorrectAns = optIndex === question.correct;
          const sanitizedOption = sanitizeText(opt);

          const prefix = String.fromCharCode(65 + optIndex);
          let marker = "";
          let bgColor = COLORS.buttonNeutral;
          let textColor = COLORS.textDark;

          if (isCorrectAns) {
            marker = "✓ ";
            bgColor = COLORS.buttonCorrect;
            textColor = COLORS.textWhite;
          } else if (isUserAns) {
            marker = "✗ ";
            bgColor = COLORS.buttonWrong;
            textColor = COLORS.textWhite;
          }

          const displayText = `${marker}${prefix}. ${sanitizedOption}`;

          cardChildren.push(
            new Paragraph({
              spacing: { before: 100, after: 100 },
              children: [
                new TextRun({
                  text: displayText,
                  bold: isCorrectAns,
                  size: 22,
                  color: textColor,
                }),
              ],
              shading: { fill: bgColor, type: ShadingType.CLEAR },
              border: {
                top: { style: BorderStyle.SINGLE, size: 6, color: bgColor },
                bottom: { style: BorderStyle.SINGLE, size: 6, color: bgColor },
                left: { style: BorderStyle.SINGLE, size: 6, color: bgColor },
                right: { style: BorderStyle.SINGLE, size: 6, color: bgColor },
              },
            }),
          );
        });
      }

      // Add explanation if exists
      if (question.explanation) {
        const expText = sanitizeText(question.explanation);
        cardChildren.push(
          new Paragraph({
            spacing: { before: 300, after: 100 },
            children: [
              new TextRun({
                text: "💡 EXPLANATION:",
                bold: true,
                size: 20,
                color: COLORS.warning,
              }),
            ],
          }),
        );

        cardChildren.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: expText,
                size: 20,
                color: COLORS.textDark,
              }),
            ],
            shading: { fill: "FFFBEB", type: ShadingType.CLEAR },
            border: {
              top: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.warning,
              },
              bottom: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.warning,
              },
              left: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.warning,
              },
              right: {
                style: BorderStyle.SINGLE,
                size: 3,
                color: COLORS.warning,
              },
            },
          }),
        );
      }

      // Create Question Card (Table)
      const questionCard = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: {
            style: BorderStyle.DOUBLE,
            size: 24,
            color: COLORS.cardBorder,
          },
          bottom: {
            style: BorderStyle.DOUBLE,
            size: 24,
            color: COLORS.cardBorder,
          },
          left: {
            style: BorderStyle.DOUBLE,
            size: 24,
            color: COLORS.cardBorder,
          },
          right: {
            style: BorderStyle.DOUBLE,
            size: 24,
            color: COLORS.cardBorder,
          },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                children: cardChildren,
                shading: { fill: COLORS.cardBg, type: ShadingType.CLEAR },
                margins: {
                  top: convertInchesToTwip(0.2),
                  bottom: convertInchesToTwip(0.2),
                  left: convertInchesToTwip(0.2),
                  right: convertInchesToTwip(0.2),
                },
              }),
            ],
            cantSplit: true, // Prevent splitting across pages
          }),
        ],
      });

      children.push(
        new Paragraph({
          spacing: { before: 400, after: 400 },
          children: [],
        }),
      );
      children.push(questionCard);
    }

    // ===========================
    // HELPER: Get Question Status
    // ===========================

    function getQuestionStatus(question, userAns, isEssay) {
      if (isEssay) {
        return { statusText: "ESSAY", statusColor: COLORS.warning };
      }

      const isSkipped = userAns === undefined || userAns === null;
      if (isSkipped) {
        return { statusText: "SKIPPED", statusColor: COLORS.textLight };
      }

      const isCorrect = userAns === question.correct;
      return isCorrect
        ? { statusText: "CORRECT", statusColor: COLORS.success }
        : { statusText: "WRONG", statusColor: COLORS.error };
    }

    // ===========================
    // CTA PAGE
    // ===========================

    children.push(new Paragraph({ children: [new PageBreak()] }));

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600, after: 200 },
        children: [
          new TextRun({
            text: "🎮 End 🎮",
            bold: true,
            size: 64,
            color: COLORS.primary,
          }),
        ],
      }),
    );

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: "READY FOR MORE?",
            bold: true,
            size: 40,
            color: COLORS.primary,
          }),
        ],
      }),
    );

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: "Continue your journey with more challenges!",
            size: 24,
            color: COLORS.textLight,
          }),
        ],
      }),
    );

    // CTA Button (simulated)
    const ctaTable = new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary },
        left: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary },
        right: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: "PLAY MORE QUIZZES",
                      bold: true,
                      size: 28,
                      color: COLORS.textWhite,
                    }),
                  ],
                }),
              ],
              shading: { fill: COLORS.primary, type: ShadingType.CLEAR },
            }),
          ],
        }),
      ],
    });

    children.push(ctaTable);

    // ===========================
    // CLICKABLE HYPERLINK
    // ===========================

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 300 },
        children: [
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: "https://basmagi-quiz.vercel.app/",
                bold: true,
                size: 24,
                color: "0563C1", // Standard blue link color
                underline: {
                  type: UnderlineType.SINGLE,
                },
              }),
            ],
            link: "https://basmagi-quiz.vercel.app/",
          }),
        ],
      }),
    );

    // ===========================
    // FOOTER
    // ===========================

    const footer = new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "منصة إمتحانات بصمجي | Page ",
              size: 18,
              color: COLORS.textLight,
            }),
            new TextRun({
              children: [PageNumber.CURRENT],
              size: 18,
              color: COLORS.textLight,
            }),
          ],
        }),
      ],
    });

    // ===========================
    // CREATE DOCUMENT
    // ===========================

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1.0),
                right: convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(0.75),
                left: convertInchesToTwip(0.75),
              },
            },
          },
          headers: {
            default: header,
          },
          footers: {
            default: footer,
          },
          children: children,
        },
      ],
    });

    // ===========================
    // SAVE DOCUMENT
    // ===========================

    const blob = await Packer.toBlob(doc);
    const filename = `${config.title}.docx`;

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`Gamified Word document exported: ${filename}`);

    showNotification(
      "Word document downloaded.",
      "You have it now",
      "./assets/images/word_icon.png",
    );

    return { success: true, filename };
  } catch (error) {
    console.error("Word Export Error:", error);
    alert(`Failed to export Word document: ${error.message}`);
    return { success: false, error: error.message };
  }
}
