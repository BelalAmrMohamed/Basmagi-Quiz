// Ready-to-use prompts for generating quizzes that match the current import schema.

const QUIZ_JSON_INSTRUCTIONS = `Create a quiz from the material I provide. Return one valid JSON object only.

The object must use this shape:
{
  "meta": {
    "title": "A clear, specific quiz title",
    "description": "A short description of the quiz and what it assesses",
    "source": "https://... (the source link of the quiz, like the drive link of the original quiz, or \"\" if none)"
  },
  "questions": [
    {
      "q": "Question text",
      "options": ["First option", "Second option", "Third option", "Fourth option"],
      "correct": 1,
      "explanation": "A helpful explanation of why the answer is correct"
    },
    {
      "q": "A question that can have more than one correct answer",
      "options": ["First option", "Second option", "Third option"],
      "correct": [0, 2],
      "multiSelect": true,
      "explanation": "Explain why each selected option is correct"
    },
    {
      "q": "An open-ended question",
      "answer": "A model answer or grading guidance",
      "explanation": "Additional teaching context"
    }
  ]
}

Schema and content rules:
- Always provide a meaningful meta.title and meta.description.
- meta.source: copy the real link to the source material (Google Drive/Docs/Slides link, PDF URL, YouTube/video URL, article or book page). It must be a complete URL starting with https:// or http://. If there is no link, use an empty string "".
- Include a non-empty questions array. Each question needs q and an explanation. For multiple-choice questions, provide options and set correct to the zero-based index of the right option. For a genuinely multi-answer question, set correct to an array of zero-based indexes and multiSelect to true. Do not mark a single-answer question as multiSelect.
- Use {"q":"...","answer":"...","explanation":"..."} for open-ended/essay questions. The answer is the expected model answer or grading guidance.
- A two-option question can be used for true/false. Make options clear and keep each correct index within the options array.
- Preserve the meaning and important wording of the provided material. Create fair questions and plausible distractors, verify every answer, and never claim unsupported facts. If the material is ambiguous, avoid guessing and reflect that in the question or explanation.
- You may use Markdown in q, options, answer, and explanation, including headings, lists, tables, and fenced code blocks. Use $...$ for inline LaTeX and $$...$$ for display math.
- Media is written inline with Markdown image syntax, not separate JSON fields: ![description](https://...) for an image, ![audio](https://...) for audio, and ![video](https://...) for video. YouTube links in the question text can be embedded automatically. Only include working URLs supplied by me; do not fabricate media links.
- Escape quotation marks, backslashes, and line breaks correctly so the result parses as strict JSON. Do not add trailing commas. Do not add stats or generated IDs; the platform fills those in.`;

export const General_Purpose_AI_Prompt = `${QUIZ_JSON_INSTRUCTIONS}

Adapt the question types and difficulty to the supplied subject and audience. When converting an existing quiz, preserve its questions and wording as closely as possible while fixing only clear errors. For unsolved questions, solve them carefully and explain the reasoning.

Now convert the source material I provide:`;

export const English_Specializing_Prompt = `${QUIZ_JSON_INSTRUCTIONS}

For English-language material:
- Assess the skills actually present in the material, such as grammar, vocabulary, reading comprehension, writing, or usage. Preserve exact wording where it matters.
- Use natural English, plausible distractors, and context-rich examples. Add pronunciation or phonetic guidance only when it helps the supplied topic.
- For reading questions, include the passage in the question text with Markdown formatting, then ask a focused question about it.
- Use audio/video/image Markdown only when I supply a real URL or media asset; never insert example or invented URLs.

Now convert the English source material I provide:`;

export const Math_Specializing_Prompt = `${QUIZ_JSON_INSTRUCTIONS}

For mathematics and science material:
- Preserve mathematical meaning and use correct LaTeX delimiters: $...$ inline and $$...$$ on their own lines for display equations.
- Include a mix of conceptual and computational questions when appropriate. Make numerical values, units, assumptions, and answer choices unambiguous.
- Check calculations and symbolic answers before returning them. Give step-by-step reasoning in explanations, and use Markdown tables or code blocks only when they improve clarity.
- Use open-ended questions for proofs or extended derivations when a set of options would be misleading.

Now convert the mathematics/science source material I provide:`;
