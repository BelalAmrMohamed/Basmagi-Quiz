import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { setSharedSupabaseClient } from "../public/src/shared/supabaseClientRegistry.js";
import { loadFullQuizData, QuizLockedError } from "../public/src/features/home/quiz-data-loader.js";
import { storeUnlockedQuiz, forgetUnlockedQuiz } from "../public/src/features/home/quiz-unlock-store.js";
import { verifyQuizPasswordRemote, quizPasswordFailureMessage } from "../public/src/features/home/download-password.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

// ── Fake supabase client ────────────────────────────────────────────────────
const STUB = { meta: { id: "abc", title: "محمي" }, stats: { questionCount: 2 } };
const FULL = { ...STUB, questions: [{ q: "1+1?", options: ["1", "2"], correct: 1 }] };
function fakeClient({ protectedQuiz, rpc } = {}) {
  const calls = { from: [], rpc: [] };
  return {
    calls,
    from(table) {
      calls.from.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "db1", data: protectedQuiz ? STUB : FULL, password_protected: !!protectedQuiz },
              error: null,
            }),
          }),
        }),
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return rpc ? rpc(name, args) : { data: null, error: null };
    },
  };
}

test("loader reads the quiz_public view and returns questions of an unprotected quiz", async () => {
  const c = fakeClient({ protectedQuiz: false });
  setSharedSupabaseClient(c);
  const q = await loadFullQuizData({ dbId: "db1" });
  assert.deepEqual(c.calls.from, ["quiz_public"]);
  assert.equal(q.questions.length, 1);
});

test("protected quiz: locked until unlocked; 'stub' gives meta/stats only; 'never' ignores an unlock", async () => {
  forgetUnlockedQuiz("db1");
  setSharedSupabaseClient(fakeClient({ protectedQuiz: true }));

  await assert.rejects(loadFullQuizData({ dbId: "db1" }, { whenLocked: "cached" }), (e) => e instanceof QuizLockedError && e.code === "QUIZ_LOCKED");

  const stub = await loadFullQuizData({ dbId: "db1" }, { whenLocked: "stub" });
  assert.deepEqual(stub.questions, []);
  assert.equal(stub.stats.questionCount, 2);
  assert.equal(stub.locked, true);

  storeUnlockedQuiz("db1", FULL);
  const q = await loadFullQuizData({ dbId: "db1" }, { whenLocked: "cached" });
  assert.equal(q.questions.length, 1);
  // Content headed for the AI model must stay locked even after the user unlocked it.
  await assert.rejects(loadFullQuizData({ dbId: "db1" }, { whenLocked: "never" }), QuizLockedError);
  forgetUnlockedQuiz("db1");
});

test("verifyQuizPasswordRemote: success stores the questions, returns the stored value", async () => {
  forgetUnlockedQuiz("db1");
  const c = fakeClient({ protectedQuiz: true, rpc: () => ({ data: { stored: "hash", data: FULL }, error: null }) });
  setSharedSupabaseClient(c);
  assert.equal(await verifyQuizPasswordRemote("db1", "pw"), "hash");
  assert.equal(c.calls.rpc[0].name, "unlock_quiz");
  assert.equal((await loadFullQuizData({ dbId: "db1" }, { whenLocked: "cached" })).questions.length, 1);
  forgetUnlockedQuiz("db1");
});

test("verifyQuizPasswordRemote: wrong password and rate limit both fail; limit has its own message", async () => {
  forgetUnlockedQuiz("db1");
  setSharedSupabaseClient(fakeClient({ rpc: () => ({ data: null, error: null }) }));
  assert.equal(await verifyQuizPasswordRemote("db1", "bad"), false);
  assert.equal(quizPasswordFailureMessage("wrong"), "wrong");

  setSharedSupabaseClient(fakeClient({ rpc: () => ({ data: null, error: { message: "quiz_password_rate_limited", details: "240" } }) }));
  assert.equal(await verifyQuizPasswordRemote("db1", "bad"), false);
  assert.match(quizPasswordFailureMessage("wrong"), /4 دقيقة/);
});

// ── Static guards ───────────────────────────────────────────────────────────
test("migration: questions are private, protected quizzes are stubbed, guesses are rate limited", () => {
  const sql = read("supabase/migrations/20261118120000_quiz_questions_private.sql");
  const grant = sql.match(/GRANT SELECT \(([\s\S]*?)\) ON public\.quizzes TO anon, authenticated/);
  assert.ok(grant);
  assert.doesNotMatch(grant[1], /\bdata\b/);
  assert.doesNotMatch(grant[1], /\bpassword\b/);
  assert.match(sql, /jsonb_build_object\(\s*'meta'/);
  assert.match(sql, /FUNCTION public\.unlock_quiz/);
  assert.match(sql, /quiz_password_attempts/);
  assert.match(sql, /quiz_password_rate_limited/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._quiz_pw_check/);
});

test("browser code never reads quizzes.data directly", () => {
  const pattern = /from\(\s*["']quizzes["']\s*\)\s*\.select\(\s*[`"'][^`"']*\bdata\b/;
  const offenders = walk(path.join(root, "public/src"))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .filter((rel) => pattern.test(read(rel)));
  assert.deepEqual(offenders, []);
});

test("anon-keyed API code reads quiz_public, not quizzes", () => {
  assert.match(read("api/render-quiz.js"), /from\("quiz_public"\)/);
  assert.doesNotMatch(read("api/render-quiz.js"), /from\("quizzes"\)/);
  for (const f of ["api/_og/quiz.js", "api/_og/course.js"]) {
    assert.match(read(f), /rest\/v1\/quiz_public/, f);
    assert.doesNotMatch(read(f), /rest\/v1\/quizzes/, f);
  }
});

test("service-role readers that expose questions check the password first", () => {
  const bot = read("api/ai-agent/_botTools.js");
  assert.match(bot, /if \(data\.password\) return PROTECTED_QUIZ_REPLY/);
  assert.match(bot, /if \(quizRow\.password\) return PROTECTED_QUIZ_REPLY/);
  assert.match(read("api/admin.js"), /action === "get-quiz"/);
});
