# منصة امتحانات بصمجي

**Interactive Mastery Quiz**

Welcome to the inaugural release of **Basmagi Quiz**, a sophisticated, beginner-friendly web application designed to elevate your understanding, interactive quiz experience. This release marks the foundation of an educational tool tailored for aspiring web developers, students, and programming enthusiasts. Built with modern web technologies, it combines intuitive design with robust functionality to foster learning in a fun, progressive manner.

- **Link:** [منصة امتحانات بصمجي](https://basmagi-quiz.vercel.app/)

---

## Key Features

- **Comprehensive Question Bank**
  40 meticulously curated multiple-choice questions covering core HTML concepts, from basic tags and structure to advanced attributes and semantics. Supports variable option counts (2 or 4 choices) for flexible quiz design.

- **State Persistence**
  Utilizes local storage to save progress, including answered questions, selections, scores, and elapsed time—ensuring seamless resumption even after browser closure or refresh.

- **Intuitive Navigation & UI**
  Single-question view with previous/next buttons, a dynamic progress bar, real-time timer, and score tracking. Beginner-oriented styling with encouraging feedback like _"Great job – you're learning fast!"_ to build confidence.

- **Result & Review Mode**
  Detailed post-quiz summary with total time, scores, and per-question breakdowns (correct/wrong/unanswered), including your answers and correct solutions for self-reflection.

- **Modular Architecture**
  Questions are isolated in the `Exams` directory for easy customization or expansion. Leveraging ES6 modules ensures maintainability and scalability.

- **Responsive & Accessible Design**
  Fully responsive layout with soft gradients, rounded aesthetics, and high-contrast elements for an inclusive experience across devices.

- **Advanced Quiz Mechanics**
  Inspired by Quizlet and Kahoot, includes retry options per question, visual feedback animations, and a "Finish Quiz" button unlocked only after full engagement.

---

## Live Link

Access the hosted version:
[https://basmagi-quiz.vercel.app/](https://basmagi-quiz.vercel.app/)

**Customization:**

- **Questions:** Edit the `Exams` directory to add or modify Quizzes.

---

## The `Exam` folder's format

```markdown
Exams / {faculty [metadata]} / {year [metadata]} / {term [metadata]} / {Courses} / {optional subfolders} / {quiz}.js
```

- The `Exam` folder is in the root folder `Quiz` next to `tools`, `Script` and the rest of the folders
- The first 3 levels are for the metadata and aren't listed as folders nor in the `categorytree`
- The actual courses and the `categorytree` begin from level 4 and forward

## How quizzes are formatted

Each quiz is smartly formatted in its own javascript file

```json
{
  "questions": [
    {
      "q": "MCQ or True and False question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D", "Option E"],
      "correct": 0,
      "explanation": "Explanation goes here. [Optional] You can remove totally"
    },
    {
      "q": "Essay type question text here?",
      "answer": "The answer to the essay question goes here as a single option.",
      "explanation": "Explanation goes here. [Optional] You can remove totally"
    }
  ]
}
```

---

## License

This project is licensed under the **MIT License** – see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Built with vanilla HTML, CSS, and JavaScript.
- Inspired by top educational quiz platforms for an optimal learning experience.

Start your HTML mastery journey today! 🚀

## The purpose of `.nojekyll` :

tells GitHub to just serve the files exactly as they are, which helps bots reach the sitemap and manifest files without interference.
