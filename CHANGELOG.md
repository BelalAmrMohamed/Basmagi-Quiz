# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0] - 2026-02-11

### 🌍 Localization
- **Major change**: Transitioned the entire platform interface to Arabic Language.
- Full RTL (Right-to-Left) support across all pages (Dashboard, Quiz Player, Summary).
- Localized PWA manifest and shortcuts for an Arabic-first native experience.
- Improved accessibility with Arabic-optimized typography.

### 📁 Custom Quiz Management
- Added "امتحاناتك" (Your Quizzes) dedicated card/folder on the main dashboard.
- Implemented quiz backup/download functionality for user-created content.

### 📤 Advanced Exports
- Added support for Microsoft PowerPoint (PPTX) exports with simulated transitions.
- Added support for Microsoft Word (DOCX) exports with professional formatting.
- Fixed image embedding issues in PDF, Markdown, and HTML exports.

### 🛠️ Creator Tools
- Overhauled `create-quiz` page with improved state persistence.
- Refined quiz creation workflow and error handling.

### 🎨 UI/UX Improvements
- Redesigned side menu for better mobile responsiveness and aesthetic.
- Implemented high-octane notification system in the quiz player.
- Updated FTUE (First-Time User Experience) wizard for localized onboarding.

### 🔧 Bug Fixes & Stability
- Resolved memory leaks in quiz timers.
- Fixed synchronization issues for bookmarks and streaks across sessions.
- Optimized service worker caching for Arabic assets.

---

## [2.0.0] - 2025-01-23

### 🎮 Gamification System

#### Added
- Complete point-based progression system with dynamic leveling algorithm
- 40+ achievement badges with diverse unlock criteria (completion, performance, speed, streaks)
- Daily streak tracking with consecutive day monitoring
- Leaderboard system for competitive learning
- Performance-based point multipliers (perfect score +30%, speed bonus +50pts, timed mode +20%)
- Level system with 30+ tiers from Beginner to Grandmaster
- `gameEngine.js` module managing all gamification logic
- Streak bonuses (+15% for 3+ day streaks)
- Consecutive perfect score tracking
- Badge categories: Starter, Completion, Performance, Speed, Streak, Points, Bookmarks, Categories, and Special Achievements

### 📊 Dashboard & Analytics

#### Added
- Comprehensive dashboard page with tabbed navigation
- Quiz history display with chronological order and detailed statistics
- Bookmarked questions section with quick access across all exams
- Badge collection showcase with visual icons and descriptions
- Performance analytics per category (attempts, best scores)
- Level progress visualization with XP bar
- Total points and current rank display
- Recent activity timeline
- Locked vs unlocked badge indicators

### 📥 Export & Sharing Capabilities

#### Added
- PDF export functionality with professional formatting
- Markdown (.md) export for documentation and note-taking
- Static HTML page export with syntax highlighting
- Interactive quiz export (.html) - fully functional standalone quizzes
- Export from main page (clean quiz without answers)
- Export from summary page (includes user answers and results)
- Download options menu with file format selection
- Auto-generated filenames based on quiz title
- Print-optimized layouts for PDF exports

### 🎨 Visual & UX Enhancements

#### Added
- 3 premium theme options: Light, Dark, and Dark Slate
- Theme selector in settings with instant preview
- Theme persistence across sessions via localStorage
- Animated gradient backgrounds (subtle, non-distracting)
- CSS animations for smooth transitions
- In-app notification system on summary page
- Achievement unlock animations
- Level-up celebration effects
- Improved card-based layout design
- Enhanced color schemes for better readability
- Micro-interactions on buttons and interactive elements
- Loading states and skeleton screens
- Toast notifications for user actions

#### Improved
- Mobile responsiveness across all pages
- Touch-friendly interface elements
- Accessibility with proper ARIA labels
- Contrast ratios for WCAG compliance
- Font sizing and readability

### 📱 Progressive Web App (PWA)

#### Added
- Full PWA support with service worker implementation
- App manifest with multiple icon sizes
- "Install App" button on main page header
- Offline functionality for cached quizzes
- Add to home screen capability
- Splash screen configuration
- App-like navigation without browser UI
- Fast, reliable performance with caching strategies
- Background sync for future features

### 🎓 Multi-Faculty Support System

#### Added
- User profile setup wizard (first-time users)
- Faculty selection with predefined options
- Academic year configuration (1st, 2nd, 3rd, 4th year)
- Term/semester selection (Term 1, Term 2)
- Student name personalization
- Dynamic course loading based on profile
- Custom course management (add/remove courses)
- Cross-faculty content support
- Profile editing capability
- Profile persistence in localStorage
- Automatic quiz filtering based on profile

### 📁 Architecture & Performance

#### Added
- Nested subdirectory support up to 5 levels deep
- Exam module caching system with LRU eviction strategy (max 10 modules)
- Debounced navigation rendering (100ms delay)
- Debounced state saving (300ms delay)
- DocumentFragment-based DOM updates for better performance
- Smart module preloading
- Lazy loading for quiz content
- Optimized localStorage read/write operations (reduced by 80%)
- Memory management for long quiz sessions

#### Changed
- Migrated hosting from GitHub Pages to Vercel
- New production URL: https://divquizzes.vercel.app
- Improved build and deployment pipeline
- Enhanced error boundaries and crash recovery

#### Improved
- Load time reduction of up to 70% with caching
- Smoother animations with requestAnimationFrame
- Reduced bundle size through code splitting
- Better memory usage in list/grid view rendering

### 🐛 Bug Fixes

#### Fixed
- Critical crash when `user.streaks` object is undefined during quiz submission
- TypeError: Cannot read properties of undefined (reading 'lastLoginDate')
- Auto-submit countdown timer removed for instant user experience
- Bookmark synchronization issues across multiple sessions
- Flag persistence problems after page refresh
- Progress bar calculation errors for essay-type questions
- Timer interval memory leaks during rapid navigation
- State save conflicts between debounced and immediate saves
- Incorrect percentage calculation when essay questions present
- Double-counting of badges in some edge cases
- LocalStorage quota exceeded errors with large histories

#### Improved
- Error handling in `gameEngine.js` for missing data structures
- Initialization sequence to prevent undefined object access
- State recovery logic for corrupted localStorage data
- Validation for user input in essay questions

### 🔧 Technical Improvements

#### Added
- Comprehensive JSDoc comments throughout codebase
- Input validation and sanitization
- HTML escaping for user-generated content (XSS prevention)
- Try-catch blocks for critical operations
- Graceful degradation for unsupported browsers
- Console logging for debugging (development mode only)

#### Improved
- Code organization with clear separation of concerns
- ES6 module structure for better maintainability
- Variable naming conventions for consistency
- Function documentation and type hints
- Error messages for user-friendly feedback

### 📚 Documentation

#### Added
- Comprehensive README with feature overview
- Installation instructions for local development
- Contribution guidelines
- Code of Conduct
- Detailed CHANGELOG
- Inline code comments for complex logic
- API documentation for gameEngine
- Quiz format specification guide

---

## [1.0.0] - 2024-XX-XX

### Added
- Initial release of the quiz application
- Full implementation of quiz logic and state management
- Multiple-choice question support (2-4 options)
- 40 curated HTML fundamental questions
- State persistence using localStorage
- Progress tracking (answered questions, score, time)
- Intuitive single-question view with navigation
- Dynamic progress bar and real-time timer
- Summary page with detailed results breakdown
- Modular architecture with ES6 modules
- Responsive design for all devices
- Question review mode showing correct/wrong answers
- Retry mechanism for individual questions
- "Finish Quiz" button with completion validation
- Animated feedback for user interactions

### Technical
- ES6 JavaScript with module imports
- Vanilla CSS with gradient aesthetics
- LocalStorage for client-side persistence
- Semantic HTML5 structure
- Mobile-first responsive design

---

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/belalamrmohamed/Quiz.git
cd Quiz

# No dependencies to install - pure vanilla JavaScript!
```

### Local Development

Option 1: Using Python
```bash
python -m http.server 8000
# Open http://localhost:8000
```

Option 2: Using Node.js
```bash
npx http-server
# Open http://localhost:8080
```

Option 3: Using VS Code Live Server
- Install "Live Server" extension
- Right-click `index.html` → "Open with Live Server"

### Production Deployment

The project is automatically deployed to Vercel on every push to the main branch.

**Live URL:** https://divquizzes.vercel.app

---

## Upgrade Guide

### From v1.0.0 to v2.0.0

#### For End Users
1. Your quiz history will be automatically migrated
2. Bookmarked questions remain accessible
3. New gamification features start fresh - complete a quiz to initialize
4. Set up your profile on first launch of v2.0.0
5. Choose your preferred theme in settings

#### For Developers/Contributors

**Breaking Changes:**
- None! v2.0.0 is fully backward compatible

**New Features to Integrate:**
1. Update `examManifest.js` for nested directory support:
```javascript
{
  id: "unique-id",
  path: "./Exams/Faculty/Year/Term/Course/Quiz.js",
  title: "Quiz Title",
  category: "Course Name",
  faculty: "Engineering", // NEW
  year: 1, // NEW
  term: 1  // NEW
}
```

2. Optional question enhancements:
```javascript
{
  q: "Question text",
  options: ["Option 1", "Option 2"],
  correct: 0,
  explanation: "Detailed explanation", // NEW - recommended
  difficulty: "medium", // NEW - optional
  tags: ["tag1", "tag2"] // NEW - optional
}
```

**Recommended Updates:**
- Add explanations to all questions for better learning
- Organize quizzes in faculty/year/term structure
- Test PWA installation on your local setup

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/NewFeature`)
3. Make your changes with clear commit messages
4. Test thoroughly on multiple browsers
5. Submit a Pull Request with description

### Areas We Need Help
- 📝 Additional quiz content for various subjects
- 🌍 Translations for internationalization (i18n)
- 🎨 UI/UX design improvements
- ⚡ Performance optimizations
- 🐛 Bug reports with reproducible steps
- 📚 Documentation improvements

---

## Support

- **Bug Reports:** [GitHub Issues](https://github.com/belalamrmohamed/Quiz/issues)
- **Feature Requests:** [GitHub Discussions](https://github.com/belalamrmohamed/Quiz/discussions)
- **Questions:** Open a discussion thread

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Happy Learning! 🎓✨**