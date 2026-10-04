// public/src/shared/gameEngine.js - Enhanced with Levels, Streaks, and More Badges
import { showNotification } from "../components/notifications/notifications.js";

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
    title: "بسم الله بدأنا",
    desc: "أول امتحان! بداية موفقة",
  },
  {
    id: "beginner",
    icon: "🎯",
    title: "مبتدئ شاطر",
    desc: "أتممت 3 امتحانات بنجاح",
  },

  // Completion Badges
  {
    id: "quick-learner",
    icon: "🌟",
    title: "سريع البديهة",
    desc: "أتممت 5 امتحانات بتركيز",
  },
  {
    id: "dedicated",
    icon: "📖",
    title: "مواظب",
    desc: "أتممت 10 امتحانات باجتهاد",
  },
  {
    id: "scholar",
    icon: "📚",
    title: "الطالب النجيب",
    desc: "25 امتحانًا! طالب مجتهد",
  },
  {
    id: "academic",
    icon: "🎓",
    title: "الأكاديمي",
    desc: "50 امتحانًا! مستوى أكاديمي",
  },
  {
    id: "professor",
    icon: "👨‍🏫",
    title: "الدكتور بتاعنا",
    desc: "100 امتحان! أسطورة المنهج",
  },

  // Performance Badges
  {
    id: "perfect-score",
    icon: "🏆",
    title: "مُقفل العداد",
    desc: "درجة كاملة 100% في امتحان",
  },
  {
    id: "sharpshooter",
    icon: "🎯",
    title: "قناص الدرجات",
    desc: "90%+ في 5 امتحانات",
  },
  {
    id: "ace",
    icon: "⭐",
    title: "نجم الدفعة",
    desc: "95%+ في 10 امتحانات",
  },
  {
    id: "on-fire",
    icon: "🔥",
    title: "شعلة نشاط",
    desc: "3 درجات كاملة متتالية",
  },
  {
    id: "unstoppable",
    icon: "💪",
    title: "محدش يوقفه",
    desc: "5 درجات كاملة متتالية",
  },

  // Speed Badges
  {
    id: "speed-demon",
    icon: "⚡",
    title: "البرق الخاطف",
    desc: "امتحان كامل في أقل من دقيقتين",
  },
  {
    id: "lightning-round",
    icon: "⚡",
    title: "جولة البُراق",
    desc: "10 أسئلة في أقل من دقيقة",
  },
  {
    id: "flash",
    icon: "💨",
    title: "صاروخ",
    desc: "5 امتحانات، كل امتحان تحت دقيقتين",
  },

  // Streak Badges
  {
    id: "week-warrior",
    icon: "🔥",
    title: "بطل الأسبوع",
    desc: "مذاكرة 7 أيام متتالية",
  },
  {
    id: "month-master",
    icon: "📅",
    title: "نجم الشهر",
    desc: "مذاكرة 30 يومًا متواصلة",
  },
  {
    id: "consistent",
    icon: "💎",
    title: "ثابت زي الجبل",
    desc: "مذاكرة 14 يومًا بانتظام",
  },

  // Points Badges
  {
    id: "point-collector",
    icon: "💰",
    title: "جامع النقط",
    desc: "جمعت 1,000 نقطة",
  },
  {
    id: "point-hoarder",
    icon: "💎",
    title: "مكنز النقط",
    desc: "جمعت 5,000 نقطة",
  },
  {
    id: "point-master",
    icon: "👑",
    title: "ملك النقط",
    desc: "جمعت 10,000 نقطة",
  },

  // Bookmark Badges
  {
    id: "bookworm",
    icon: "🎨",
    title: "دودة الكتب",
    desc: "حفظت 25 سؤالاً في المفضلة",
  },
  {
    id: "completionist",
    icon: "✅",
    title: "متمم النواقص",
    desc: "حفظت أكثر من 50 سؤالاً",
  },
  {
    id: "organizer",
    icon: "📌",
    title: "المنظم",
    desc: "حفظت 10 أسئلة في المفضلة",
  },

  // Category Badges
  {
    id: "category-explorer",
    icon: "🗺️",
    title: "ابن بطوطة",
    desc: "جرّبت 5 تصنيفات مختلفة",
  },
  {
    id: "jack-of-all-trades",
    icon: "🎭",
    title: "بتاع كله",
    desc: "امتحانات في 10 تصنيفات مختلفة",
  },

  // Special Achievements
  {
    id: "comeback-kid",
    icon: "💪",
    title: "العودة الأسطورية",
    desc: "عدت للمذاكرة بعد 30 يوم غياب",
  },
  {
    id: "early-bird",
    icon: "🌅",
    title: "بركة البكور",
    desc: "أنهيت امتحانًا قبل 8 صباحًا",
  },
  {
    id: "night-owl",
    icon: "🦉",
    title: "سهران للصبح",
    desc: "أنهيت امتحانًا بعد 10 مساءً",
  },
  {
    id: "perfectionist-plus",
    icon: "🌟",
    title: "امتياز بلس",
    desc: "10 درجات كاملة في الامتحانات",
  },
  {
    id: "practice-master",
    icon: "🎯",
    title: "أسطورة التمرين",
    desc: "أنهيت 20 امتحان تدريب بنجاح",
  },
];
// Level System
const LEVEL_CONFIG = {
  // Level = floor(sqrt(totalPoints / 100))
  pointsPerLevel: 100,

  getTitles: (level) => {
    if (level < 5) return "مبتدئ";
    if (level < 10) return "متوسط";
    if (level < 15) return "متقدم";
    if (level < 20) return "خبير";
    if (level < 30) return "أسطورة";
    return "معلم";
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

    if (!user.history) user.history = [];
    if (!user.badges) user.badges = [];
    if (!user.bookmarks) user.bookmarks = {};
    if (!user.categoryProgress) user.categoryProgress = {};

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