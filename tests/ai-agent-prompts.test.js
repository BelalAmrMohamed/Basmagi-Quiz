import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TOOLS_BY_NAME } from "../api/ai-agent/chat.js";
import { BOT_TOOLS } from "../api/ai-agent/_botTools.js";
import * as prompts from "../public/src/components/ai-agent/ai-agent-default-prompts.js";
import * as pageTools from "../public/src/components/ai-agent/ai-agent-page-tools.js";
import { NOTEBOOK_AGENT_TOOLS } from "../public/src/features/notebook/notebook-agent-tools.js";

// Wording that used to be true (the agent loop once allowed ONE tool call per
// turn) and now steers the model away from valid multi-step plans.
const STALE = /one tool call|only one tool|ONE tool|per turn|once per reply/i;

// edit_item patch operations (set_question, delete_cell, ...) look like tool names but are not.
const PATCH_OPS = new Set(
  [...fs.readFileSync(new URL("../public/src/components/ai-agent/core/item-patch-engine.js", import.meta.url), "utf8").matchAll(/case "([a-z]+_[a-z_]+)"/g)].map((m) => m[1]),
);

const botSource = fs.readFileSync(new URL("../api/ai-agent/bot.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const botPrompt = (botSource.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;\n/) || [])[1];

// The name the MODEL sees is tool.name (e.g. request-level "edit_current_quiz"
// is offered to the model as "edit_quiz").
const visibleName = (requestName) => TOOLS_BY_NAME[requestName]?.name;
const allVisibleNames = new Set(Object.values(TOOLS_BY_NAME).map((t) => t.name));

// [prompt text, request-level tool names the page offers]
const PAGES = {
  home: [prompts.HOME_PAGE_SYSTEM_PROMPT, pageTools.HOME_TOOL_NAMES],
  "create-quiz": [prompts.CREATE_QUIZ_PAGE_SYSTEM_PROMPT, pageTools.CREATE_QUIZ_PAGE_TOOL_NAMES],
  lesson: [prompts.LESSON_PAGE_SYSTEM_PROMPT, pageTools.LESSON_VIEW_TOOL_NAMES],
  "create-lesson": [prompts.CREATE_LESSON_PAGE_SYSTEM_PROMPT, pageTools.CREATE_LESSON_PAGE_TOOL_NAMES],
  notebook: [prompts.NOTEBOOK_PAGE_SYSTEM_PROMPT, NOTEBOOK_AGENT_TOOLS],
};

const TOOL_LIKE = /\b(?:create|edit|delete|add|move|fetch|search|parse|get|display|notebook|reset)_[a-z]+(?:_[a-z]+)*\b/g;

test("patch operation names were extracted", () => {
  assert.ok(PATCH_OPS.has("set_question") && PATCH_OPS.has("delete_cell") && PATCH_OPS.size >= 15);
});

test("the bot system prompt was found", () => {
  assert.ok(botPrompt && botPrompt.length > 500);
});

test("no prompt or tool description carries stale one-tool-per-turn wording", () => {
  const texts = [
    ...Object.entries(prompts)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [k, v]),
    ["buildResultSystemPrompt()", prompts.buildResultSystemPrompt({})],
    ["bot SYSTEM_PROMPT", botPrompt],
    ...Object.entries(TOOLS_BY_NAME).map(([k, v]) => [`web tool ${k}`, JSON.stringify(v)]),
    ...BOT_TOOLS.map((t) => [`bot tool ${t.name}`, JSON.stringify(t)]),
  ];
  for (const [label, text] of texts) {
    assert.doesNotMatch(text, STALE, `${label} contains stale wording`);
  }
});

test("every tool a page offers exists in TOOLS_BY_NAME", () => {
  for (const [page, [, names]] of Object.entries(PAGES)) {
    for (const n of names) assert.ok(TOOLS_BY_NAME[n], `${page} offers unknown tool "${n}"`);
  }
});

test("a page prompt never mentions a tool that the page does not offer", () => {
  for (const [page, [prompt, names]] of Object.entries(PAGES)) {
    const offered = new Set(names.map(visibleName));
    const mentioned = new Set(prompt.match(TOOL_LIKE) || []);
    for (const m of mentioned) {
      if (PATCH_OPS.has(m)) continue;
      assert.ok(allVisibleNames.has(m), `${page} prompt mentions "${m}", which is not a known tool`);
      assert.ok(offered.has(m), `${page} prompt mentions "${m}", but the page does not offer it`);
    }
  }
});

test("the bot prompt only mentions bot tools that exist", () => {
  const botNames = new Set(BOT_TOOLS.map((t) => t.name));
  const mentioned = new Set(botPrompt.match(/\b[a-z]+_[a-z_]+\b/g) || []);
  for (const m of mentioned) {
    if (/^(?:search|get|export|generate)_/.test(m)) assert.ok(botNames.has(m), `bot prompt mentions unknown tool "${m}"`);
  }
});

test("the editor prompts agree with the tool descriptions about confirmation", () => {
  // Natural-language edits execute immediately on the editor pages; confirmation
  // is only for replacing a whole quiz / existing lesson, or deleting.
  assert.doesNotMatch(prompts.NOTEBOOK_PAGE_SYSTEM_PROMPT, /only then call the tool/i);
  assert.doesNotMatch(prompts.CREATE_LESSON_PAGE_SYSTEM_PROMPT, /only then call add_lesson_(section|question)/i);
  assert.match(prompts.CREATE_QUIZ_PAGE_SYSTEM_PROMPT, /call edit_quiz immediately/);
  assert.match(JSON.stringify(TOOLS_BY_NAME.edit_current_quiz), /Execute immediately/);
});
