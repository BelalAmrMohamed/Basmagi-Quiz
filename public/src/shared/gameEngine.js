// public/src/shared/gameEngine.js - Enhanced with Levels, Streaks, and More Badges
import { showNotification } from "../components/notifications.js";

const STORAGE_KEY = "quiz_user_profile";

// Initial State
const initialState = {
  totalPoints: 0,
  history: [],
  badges: [],
  bookmarks: {},
  flags: {}, // NEW: Flagged questions for review
  streaks: {
    currentDaily: 0,
    longestStreak: 0,
    lastLoginDate: null,
    consecutivePerfect: 0, // Track perfect scores in a row
  },
  categoryProgress: {}, // Track progress per category
};

// Enhanced Badge Definitions
export const BADGES = [
  // Starter Badges
  {
    id: "novice",
    icon: "🌱",
    title: "First Step",
    desc: "Complete your first quiz",
  },
  { id: "beginner", icon: "🎯", title: "Beginner", desc: "Complete 3 quizzes" },

  // Completion Badges
  {
    id: "quick-learner",
    icon: "🌟",
    title: "Quick Learner",
    desc: "Complete 5 quizzes",
  },
  {
    id: "dedicated",
    icon: "📖",
    title: "Dedicated",
    desc: "Complete 10 quizzes",
  },
  { id: "scholar", icon: "📚", title: "Scholar", desc: "Complete 25 quizzes" },
  {
    id: "academic",
    icon: "🎓",
    title: "Academic",
    desc: "Complete 50 quizzes",
  },
  {
    id: "professor",
    icon: "👨‍🏫",
    title: "Professor",
    desc: "Complete 100 quizzes",
  },

  // Performance Badges
  {
    id: "perfect-score",
    icon: "🏆",
    title: "Perfectionist",
    desc: "Score 100% on a quiz",
  },
  {
    id: "sharpshooter",
    icon: "🎯",
    title: "Sharpshooter",
    desc: "Score 90%+ on 5 quizzes",
  },
  {
    id: "ace",
    icon: "⭐",
    title: "Ace Student",
    desc: "Score 95%+ on 10 quizzes",
  },
  {
    id: "on-fire",
    icon: "🔥",
    title: "On Fire",
    desc: "Get 3 perfect scores in a row",
  },
  {
    id: "unstoppable",
    icon: "💪",
    title: "Unstoppable",
    desc: "Get 5 perfect scores in a row",
  },

  // Speed Badges
  {
    id: "speed-demon",
    icon: "⚡",
    title: "Speed Demon",
    desc: "Complete a quiz in under 2 minutes",
  },
  {
    id: "lightning-round",
    icon: "⚡",
    title: "Lightning Round",
    desc: "Answer 10 questions in under 1 minute",
  },
  {
    id: "flash",
    icon: "💨",
    title: "Flash",
    desc: "Complete 5 quizzes in under 2 minutes each",
  },

  // Streak Badges
  {
    id: "week-warrior",
    icon: "🔥",
    title: "Week Warrior",
    desc: "Take quizzes 7 days in a row",
  },
  {
    id: "month-master",
    icon: "📅",
    title: "Month Master",
    desc: "Maintain a 30-day streak",
  },
  {
    id: "consistent",
    icon: "💎",
    title: "Consistent",
    desc: "Maintain a 14-day streak",
  },

  // Points Badges
  {
    id: "point-collector",
    icon: "💰",
    title: "Point Collector",
    desc: "Earn 1,000 total points",
  },
  {
    id: "point-hoarder",
    icon: "💎",
    title: "Point Hoarder",
    desc: "Earn 5,000 total points",
  },
  {
    id: "point-master",
    icon: "👑",
    title: "Point Master",
    desc: "Earn 10,000 total points",
  },

  // Bookmark Badges
  {
    id: "bookworm",
    icon: "🎨",
    title: "Bookworm",
    desc: "Bookmark 25 questions",
  },
  {
    id: "completionist",
    icon: "✅",
    title: "Completionist",
    desc: "Bookmark 50+ questions",
  },
  {
    id: "organizer",
    icon: "📌",
    title: "Organizer",
    desc: "Bookmark 10 questions",
  },

  // Category Badges
  {
    id: "category-explorer",
    icon: "🗺️",
    title: "Explorer",
    desc: "Try quizzes from 5 different categories",
  },
  {
    id: "jack-of-all-trades",
    icon: "🎭",
    title: "Jack of All Trades",
    desc: "Complete quizzes in 10 categories",
  },

  // Special Achievements
  {
    id: "comeback-kid",
    icon: "💪",
    title: "Comeback Kid",
    desc: "Return after 30 days away",
  },
  {
    id: "early-bird",
    icon: "🌅",
    title: "Early Bird",
    desc: "Complete a quiz before 8 AM",
  },
  {
    id: "night-owl",
    icon: "🦉",
    title: "Night Owl",
    desc: "Complete a quiz after 10 PM",
  },
  {
    id: "perfectionist-plus",
    icon: "🌟",
    title: "Perfectionist+",
    desc: "Get 10 perfect scores",
  },
  {
    id: "practice-master",
    icon: "🎯",
    title: "Practice Master",
    desc: "Complete 20 practice mode quizzes",
  },
];

// Level System
const LEVEL_CONFIG = {
  // Level = floor(sqrt(totalPoints / 100))
  pointsPerLevel: 100,

  getTitles: (level) => {
    if (level < 5) return "Beginner";
    if (level < 10) return "Intermediate";
    if (level < 15) return "Advanced";
    if (level < 20) return "Expert";
    if (level < 30) return "Master";
    return "Grandmaster";
  },

  getNextLevelPoints: (currentLevel) => {
    return Math.pow(currentLevel + 1, 2) * 100;
  },
};

export const gameEngine = {
  // 1. Get User Data
  getUserData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { ...initialState };
  },

  // 2. Save User Data
  saveUserData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },

  // 3. Calculate Level and XP
  calculateLevel(points) {
    const level = Math.floor(Math.sqrt(points / LEVEL_CONFIG.pointsPerLevel));
    const currentLevelPoints = Math.pow(level, 2) * LEVEL_CONFIG.pointsPerLevel;
    const nextLevelPoints = LEVEL_CONFIG.getNextLevelPoints(level);
    const pointsInCurrentLevel = points - currentLevelPoints;
    const pointsNeededForNext = nextLevelPoints - currentLevelPoints;
    const progressPercent = (pointsInCurrentLevel / pointsNeededForNext) * 100;

    return {
      level,
      title: LEVEL_CONFIG.getTitles(level),
      currentLevelPoints,
      nextLevelPoints,
      pointsInCurrentLevel,
      pointsNeededForNext,
      progressPercent: Math.min(100, Math.max(0, progressPercent)),
    };
  },

  // 4. Update Streak
  updateStreak(user) {
    // FIX: Initialize streaks object if it doesn't exist
    if (!user.streaks) {
      user.streaks = {
        currentDaily: 0,
        longestStreak: 0,
        lastLoginDate: null,
        consecutivePerfect: 0,
      };
    }

    const today = new Date().toDateString();
    const lastLogin = user.streaks.lastLoginDate;

    if (lastLogin === today) {
      // Already logged in today
      return user.streaks.currentDaily;
    }

    if (!lastLogin) {
      // First time
      user.streaks.currentDaily = 1;
      user.streaks.longestStreak = 1;
    } else {
      const lastDate = new Date(lastLogin);
      const todayDate = new Date(today);
      const diffTime = todayDate - lastDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Consecutive day
        user.streaks.currentDaily++;
        if (user.streaks.currentDaily > user.streaks.longestStreak) {
          user.streaks.longestStreak = user.streaks.currentDaily;
        }
      } else if (diffDays > 30) {
        // Comeback after 30+ days
        if (!user.badges.includes("comeback-kid")) {
          return { newBadge: "comeback-kid", streak: 1 };
        }
        user.streaks.currentDaily = 1;
      } else {
        // Streak broken
        user.streaks.currentDaily = 1;
      }
    }

    user.streaks.lastLoginDate = today;
    return user.streaks.currentDaily;
  },

  // 5. Process Quiz Result
  processResult(result) {
    const user = this.getUserData();
    const { score, total, timeElapsed, examId, mode } = result;

    // FIX: Ensure user data properties are initialized to prevent TypeError
    if (!user.history) user.history = [];
    if (!user.badges) user.badges = [];
    if (!user.bookmarks) user.bookmarks = {};
    if (!user.categoryProgress) user.categoryProgress = {};

    // --- FIX: Define these variables AT THE START so they are available for badge logic ---
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    const bookmarkCount = Object.keys(user.bookmarks || {}).length;
    // -----------------------------------------------------------------------------------

    const oldLevel = this.calculateLevel(user.totalPoints).level;

    // --- Update Streak ---
    const streakInfo = this.updateStreak(user);
    const newBadgesFromStreak = [];

    if (streakInfo.newBadge) {
      newBadgesFromStreak.push(streakInfo.newBadge);
    }

    // --- Calculate Points ---
    let pointsEarned = 0;
    const basePoints = score * 10;
    pointsEarned += basePoints;

    // Multipliers
    let multiplier = 1.0;
    let bonusReasons = [];

    // Perfect Score Multiplier
    if (score === total && total > 0) {
      multiplier += 0.3;
      bonusReasons.push("Perfect Score: +30%");
      user.streaks.consecutivePerfect =
        (user.streaks.consecutivePerfect || 0) + 1;
    } else {
      user.streaks.consecutivePerfect = 0;
    }

    // Speed Bonus
    let speedBonus = 0;
    if (timeElapsed < 120 && score > 0) {
      speedBonus = 50;
      bonusReasons.push("Speed Bonus: +50 pts");
    }

    // Timed Mode Bonus
    if (mode === "timed" && score > 0) {
      multiplier += 0.2;
      bonusReasons.push("Timed Mode: +20%");
    }

    // Exam Mode Bonus
    if (mode === "exam" && score > 0) {
      multiplier += 0.1;
      bonusReasons.push("Exam Mode: +10%");
    }

    // Streak Multiplier
    if (user.streaks.currentDaily >= 3) {
      multiplier += 0.15;
      bonusReasons.push(`${user.streaks.currentDaily}-Day Streak: +15%`);
    }

    const finalPoints = Math.round(pointsEarned * multiplier) + speedBonus;

    // --- Badge Logic ---
    const newBadges = [...newBadgesFromStreak];

    // Badge Checks (Now safe because variables are defined)
    if (user.history.length + 1 >= 3 && !user.badges.includes("beginner"))
      newBadges.push("beginner");
    if (user.history.length + 1 >= 10 && !user.badges.includes("dedicated"))
      newBadges.push("dedicated");
    if (user.history.length + 1 >= 100 && !user.badges.includes("professor"))
      newBadges.push("professor");
    if (
      user.totalPoints + finalPoints >= 1000 &&
      !user.badges.includes("point-collector")
    )
      newBadges.push("point-collector");
    if (
      user.totalPoints + finalPoints >= 5000 &&
      !user.badges.includes("point-hoarder")
    )
      newBadges.push("point-hoarder");
    if (
      user.totalPoints + finalPoints >= 10000 &&
      !user.badges.includes("point-master")
    )
      newBadges.push("point-master");
    if (user.streaks.currentDaily >= 14 && !user.badges.includes("consistent"))
      newBadges.push("consistent");

    // Ace Student
    const aceScoreCount = user.history.filter(
      (h) => h.score / h.total >= 0.95,
    ).length;
    if (
      aceScoreCount + (score / total >= 0.95 ? 1 : 0) >= 10 &&
      !user.badges.includes("ace")
    ) {
      newBadges.push("ace");
    }

    // Unstoppable
    if (
      user.streaks.consecutivePerfect >= 5 &&
      !user.badges.includes("unstoppable")
    ) {
      newBadges.push("unstoppable");
    }

    // Perfectionist Plus (Now safe: percentage is defined)
    const perfectCount = user.history.filter(
      (h) => h.percentage === 100,
    ).length;
    if (
      perfectCount + (percentage === 100 ? 1 : 0) >= 10 &&
      !user.badges.includes("perfectionist-plus")
    ) {
      newBadges.push("perfectionist-plus");
    }

    // Practice Master
    const practiceCount = user.history.filter(
      (h) => h.mode === "practice",
    ).length;
    if (
      practiceCount + (mode === "practice" ? 1 : 0) >= 20 &&
      !user.badges.includes("practice-master")
    ) {
      newBadges.push("practice-master");
    }

    // Organizer (Now safe: bookmarkCount is defined)
    if (bookmarkCount >= 10 && !user.badges.includes("organizer")) {
      newBadges.push("organizer");
    }

    // Time-based badges
    const currentHour = new Date().getHours();
    if (currentHour < 8 && !user.badges.includes("early-bird"))
      newBadges.push("early-bird");
    if (currentHour >= 22 && !user.badges.includes("night-owl"))
      newBadges.push("night-owl");

    // Remaining standard badges
    if (!user.badges.includes("novice")) newBadges.push("novice");
    if (score === total && total > 0 && !user.badges.includes("perfect-score"))
      newBadges.push("perfect-score");
    if (
      user.streaks.consecutivePerfect >= 3 &&
      !user.badges.includes("on-fire")
    )
      newBadges.push("on-fire");
    if (timeElapsed < 120 && score > 0 && !user.badges.includes("speed-demon"))
      newBadges.push("speed-demon");
    if (user.history.length + 1 >= 5 && !user.badges.includes("quick-learner"))
      newBadges.push("quick-learner");
    if (user.history.length + 1 >= 25 && !user.badges.includes("scholar"))
      newBadges.push("scholar");
    if (user.history.length + 1 >= 50 && !user.badges.includes("academic"))
      newBadges.push("academic");
    if (user.streaks.currentDaily >= 7 && !user.badges.includes("week-warrior"))
      newBadges.push("week-warrior");
    if (
      user.streaks.currentDaily >= 30 &&
      !user.badges.includes("month-master")
    )
      newBadges.push("month-master");

    // Sharpshooter
    const highScoreCount = user.history.filter(
      (h) => h.score / h.total >= 0.9,
    ).length;
    if (
      highScoreCount + (score / total >= 0.9 ? 1 : 0) >= 5 &&
      !user.badges.includes("sharpshooter")
    ) {
      newBadges.push("sharpshooter");
    }

    // Bookworm & Completionist
    if (bookmarkCount >= 25 && !user.badges.includes("bookworm"))
      newBadges.push("bookworm");
    if (bookmarkCount >= 50 && !user.badges.includes("completionist"))
      newBadges.push("completionist");

    // --- Update User Profile ---
    user.totalPoints += finalPoints;
    user.badges = [...user.badges, ...newBadges];

    // Add to history
    const historyEntry = {
      examId,
      date: new Date().toISOString(),
      score,
      total,
      percentage, // Already calculated at top
      pointsEarned: finalPoints,
      timeElapsed,
      mode: mode || "exam",
    };
    user.history.unshift(historyEntry);

    // Update category progress
    if (!user.categoryProgress) user.categoryProgress = {};
    if (!user.categoryProgress[examId]) {
      user.categoryProgress[examId] = { attempts: 0, bestScore: 0 };
    }
    user.categoryProgress[examId].attempts++;
    if (percentage > user.categoryProgress[examId].bestScore) {
      user.categoryProgress[examId].bestScore = percentage;
    }

    this.saveUserData(user);

    const newLevel = this.calculateLevel(user.totalPoints).level;
    const leveledUp = newLevel > oldLevel;

    return {
      pointsEarned: finalPoints,
      basePoints,
      multiplier,
      speedBonus,
      bonusReasons,
      newBadges: newBadges
        .map((id) => BADGES.find((b) => b.id === id))
        .filter(Boolean),
      totalPoints: user.totalPoints,
      level: this.calculateLevel(user.totalPoints),
      leveledUp,
      streak: user.streaks.currentDaily,
    };
  },

  // 6. Get Leaderboard
  getLeaderboard() {
    const user = this.getUserData();
    const mockUsers = [
      { name: "QuizMaster", points: 5000, rank: 1 },
      { name: "Alex", points: 4200, rank: 2 },
      { name: "Sarah", points: 3800, rank: 3 },
      { name: "Jamie", points: 2500, rank: 4 },
      { name: "Taylor", points: 1800, rank: 5 },
    ];

    const currentUser = {
      name: "You",
      points: user.totalPoints,
      rank: 0,
      isUser: true,
    };

    const all = [...mockUsers, currentUser].sort((a, b) => b.points - a.points);
    return all.map((u, i) => ({ ...u, rank: i + 1 }));
  },

  // 7. Bookmark Management
  toggleBookmark(examId, questionIdx) {
    const user = this.getUserData();
    const key = `${examId}_${questionIdx}`;

    if (user.bookmarks && user.bookmarks[key]) {
      delete user.bookmarks[key];
    } else {
      if (!user.bookmarks) user.bookmarks = {};
      user.bookmarks[key] = { note: "", timestamp: Date.now() };
    }
    this.saveUserData(user);
    if (!this.isBookmarked(examId, questionIdx))
      showNotification(`تم مسح سؤال ${questionIdx + 1} من الحساب`);
    else
      showNotification(
        `تم حفظ سؤال ${questionIdx + 1}`,
        `انظر في الحساب`,
        "success",
      );
    return !!user.bookmarks[key];
  },

  isBookmarked(examId, questionIdx) {
    const user = this.getUserData();
    return user.bookmarks && !!user.bookmarks[`${examId}_${questionIdx}`];
  },

  // 8. NEW: Flag Management
  toggleFlag(examId, questionIdx) {
    const user = this.getUserData();
    if (!user.flags) user.flags = {};

    const key = `${examId}_${questionIdx}`;
    if (user.flags[key]) {
      delete user.flags[key];
    } else {
      user.flags[key] = { timestamp: Date.now() };
    }

    this.saveUserData(user);
    if (!this.isFlagged(examId, questionIdx))
      showNotification(`تمت إزالة العلامة من سؤال ${questionIdx + 1}`);
    else
      showNotification(
        "تستطيع مراجعة السؤال لاحقاّ",
        `تمت إضافة علامة مرجعية لسؤال ${questionIdx + 1}`,
        "success",
      );

    return !!user.flags[key];
  },

  isFlagged(examId, questionIdx) {
    const user = this.getUserData();
    return user.flags && !!user.flags[`${examId}_${questionIdx}`];
  },

  getFlaggedCount(examId) {
    const user = this.getUserData();
    if (!user.flags) return 0;
    return Object.keys(user.flags).filter((key) => key.startsWith(`${examId}_`))
      .length;
  },

  clearFlags(examId) {
    const user = this.getUserData();
    if (!user.flags) return;

    Object.keys(user.flags).forEach((key) => {
      if (key.startsWith(`${examId}_`)) {
        delete user.flags[key];
      }
    });

    this.saveUserData(user);
  },
};
