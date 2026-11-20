import "./helpers/dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS_BY_NAME } from "../api/ai-agent/chat.js";
import { BOT_TOOLS } from "../api/ai-agent/_botTools.js";
import { QUESTION_ITEM_SCHEMA, LESSON_BLOCK_SCHEMA } from "../api/ai-agent/_schemas.js";
import { AUTHORING_RULES, authoringRulesText } from "../public/src/shared/ai-agent-authoring.js";
import { handleGetAuthoringGuideToolCall } from "../public/src/components/ai-agent/core/tool-registry.js";

const questionItems = (tool) => (tool.input_schema || tool.parameters).properties.questions.items;
const blockItems = (tool) => (tool.input_schema || tool.parameters).properties.sections.items.properties.blocks.items;
const botTool = (name) => BOT_TOOLS.find((t) => t.name === name);

test("every web quiz tool and the bot quiz tool use the same question schema object", () => {
  for (const name of ["create_quiz", "edit_quiz", "edit_current_quiz"]) {
    assert.equal(questionItems(TOOLS_BY_NAME[name]), QUESTION_ITEM_SCHEMA, name);
  }
  assert.equal(questionItems(botTool("generate_quiz_file")), QUESTION_ITEM_SCHEMA);
});

test("the bot can now ask for fill-in-the-blank questions", () => {
  const props = questionItems(botTool("generate_quiz_file")).properties;
  assert.deepEqual(props.questionKind.enum, ["complete"]);
  assert.ok(props.strictMatch);
});

test("web create_lesson and the bot lesson tool share the lesson block schema (incl. strictMatch)", () => {
  assert.equal(blockItems(TOOLS_BY_NAME.create_lesson), LESSON_BLOCK_SCHEMA);
  assert.equal(blockItems(botTool("generate_lesson_file")), LESSON_BLOCK_SCHEMA);
  assert.ok(LESSON_BLOCK_SCHEMA.properties.strictMatch);
});

test("the Gemini note holds: `correct` is an array of integers, never a union type", () => {
  assert.deepEqual(QUESTION_ITEM_SCHEMA.properties.correct, { type: "array", items: { type: "integer" } });
  assert.ok(!Array.isArray(QUESTION_ITEM_SCHEMA.properties.correct.type));
});

test("the authoring guide and the bot tool carry the shared key rules", async () => {
  const guide = await handleGetAuthoringGuideToolCall({ input: { topic: "quiz" } });
  const botDesc = botTool("generate_quiz_file").description;
  for (const rule of Object.values(AUTHORING_RULES)) {
    assert.ok(guide.includes(rule), `guide misses: ${rule.slice(0, 40)}`);
    assert.ok(botDesc.includes(rule), `bot misses: ${rule.slice(0, 40)}`);
  }
  assert.ok(authoringRulesText().includes("ZERO-based"));
  assert.ok(authoringRulesText().includes("{{answer|alt1|alt2}}"));
});

function findSchemaProblems(node, path, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node.type)) out.push(`${path}: union type`);
  if (node.type === "array" && (!node.items || typeof node.items !== "object" || !node.items.type)) {
    out.push(`${path}: array without typed items`);
  }
  for (const [key, value] of Object.entries(node.properties || {})) findSchemaProblems(value, `${path}.${key}`, out);
  if (node.items) findSchemaProblems(node.items, `${path}[]`, out);
}

test("no web or bot tool schema has an array without items or a union type", () => {
  const problems = [];
  for (const [name, tool] of Object.entries(TOOLS_BY_NAME)) findSchemaProblems(tool.input_schema, name, problems);
  for (const tool of BOT_TOOLS) findSchemaProblems(tool.parameters || tool.input_schema, `bot:${tool.name}`, problems);
  assert.deepEqual(problems, []);
});

test("edit_item declares item schemas for its replacement arrays", () => {
  const props = TOOLS_BY_NAME.edit_item.input_schema.properties;
  assert.equal(props.questions.items, QUESTION_ITEM_SCHEMA);
  assert.equal(props.sections.items.properties.blocks.items, LESSON_BLOCK_SCHEMA);
  assert.ok(props.cells.items.properties.source);
});
