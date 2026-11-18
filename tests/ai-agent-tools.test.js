import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATE_NOTEBOOK_TOOL,
  EDIT_ITEM_TOOL,
  GET_AUTHORING_GUIDE_TOOL,
  CREATE_QUIZ_TOOL,
  CREATE_LESSON_TOOL,
} from "../api/ai-agent/_tools.js";
import { TOOLS_BY_NAME } from "../api/ai-agent/chat.js";
import { buildGeminiContents } from "../api/ai-agent/_providerClients.js";
import { validateNotebookRecord } from "../public/src/features/home/notebook-input.js";

test("ai-agent tools: CREATE_NOTEBOOK_TOOL schema is properly defined and registered", () => {
  assert.equal(CREATE_NOTEBOOK_TOOL.name, "create_notebook");
  assert.equal(CREATE_NOTEBOOK_TOOL.input_schema.type, "object");
  assert.ok(CREATE_NOTEBOOK_TOOL.input_schema.properties.title);
  assert.ok(CREATE_NOTEBOOK_TOOL.input_schema.properties.cells);
  assert.ok(CREATE_NOTEBOOK_TOOL.input_schema.required.includes("title"));
  assert.ok(CREATE_NOTEBOOK_TOOL.input_schema.required.includes("cells"));

  assert.ok(TOOLS_BY_NAME.create_notebook, "create_notebook must be present in TOOLS_BY_NAME");
});

test("ai-agent tools: EDIT_ITEM_TOOL schema supports atomic in-place edits", () => {
  assert.equal(EDIT_ITEM_TOOL.name, "edit_item");
  assert.ok(EDIT_ITEM_TOOL.input_schema.properties.targetTitle);
  assert.ok(EDIT_ITEM_TOOL.input_schema.properties.patch);
  assert.ok(EDIT_ITEM_TOOL.input_schema.required.includes("targetTitle"));

  assert.ok(TOOLS_BY_NAME.edit_item, "edit_item must be present in TOOLS_BY_NAME");
});

test("ai-agent tools: GET_AUTHORING_GUIDE_TOOL provides schema instructions", () => {
  assert.equal(GET_AUTHORING_GUIDE_TOOL.name, "get_authoring_guide");
  assert.ok(TOOLS_BY_NAME.get_authoring_guide, "get_authoring_guide must be present in TOOLS_BY_NAME");
});

test("ai-agent tools: Creation tools do not demand unnecessary user confirmation in descriptions", () => {
  const toolsToCheck = [CREATE_QUIZ_TOOL, CREATE_LESSON_TOOL, CREATE_NOTEBOOK_TOOL];
  for (const tool of toolsToCheck) {
    const desc = tool.description || "";
    assert.doesNotMatch(
      desc,
      /Only call this when the user has explicitly confirmed|answer Yes\/No/i,
      `Tool ${tool.name} description should not enforce confirmation gate`
    );
  }
});

test("ai-agent tools: Notebook validation handles valid MATLAB and C++ notebooks cleanly", () => {
  const cppNotebook = {
    title: "C++ Functions and Loops",
    runtime: "cpp",
    cells: [
      { type: "markdown", source: "# C++ Functions\nExplanation of pass-by-reference." },
      { type: "code", source: "#include <iostream>\nusing namespace std;\nint main() { cout << \"Hi\"; return 0; }" },
      {
        type: "code",
        source: "// Challenge: Add two numbers from stdin\n#include <iostream>\nusing namespace std;\nint main() { int a, b; if (cin >> a >> b) cout << a + b; return 0; }",
        challenge: {
          testStdin: "5 7",
          expectedOutput: "12",
          hint: "Use cin to read inputs",
        },
      },
    ],
  };

  const validation = validateNotebookRecord(cppNotebook);
  assert.equal(validation.errors.length, 0, `Validation errors: ${validation.errors.join("; ")}`);
});

test("ai-agent tools: buildGeminiContents normalizes tool results to role: user with functionResponse and NO role: function", () => {
  const messages = [
    { role: "user", content: "inspect this item" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "call_1", name: "parse_item_info", input: { id: "item_123" } },
        { id: "call_2", name: "get_authoring_guide", input: { kind: "quiz" } },
      ],
    },
    {
      role: "tool",
      toolCallId: "call_1",
      toolName: "parse_item_info",
      content: '{"title":"Math"}',
    },
    {
      role: "tool",
      toolCallId: "call_2",
      toolName: "get_authoring_guide",
      content: "guide details",
    },
  ];

  const contents = buildGeminiContents(messages);

  // Gemini strictly allows only role: "user" or "model"
  for (const c of contents) {
    assert.ok(
      c.role === "user" || c.role === "model",
      `Role "${c.role}" is invalid for Gemini API; must be "user" or "model"`
    );
  }

  // Turn 0: user message
  assert.equal(contents[0].role, "user");
  assert.equal(contents[0].parts[0].text, "inspect this item");

  // Turn 1: model toolCalls must contain thought_signature to prevent 400 errors
  assert.equal(contents[1].role, "model");
  assert.equal(contents[1].parts.length, 2);
  assert.equal(contents[1].parts[0].functionCall.name, "parse_item_info");
  assert.equal(contents[1].parts[0].thought_signature, "skip_thought_signature_validator");
  assert.equal(contents[1].parts[1].functionCall.name, "get_authoring_guide");
  assert.equal(contents[1].parts[1].thought_signature, "skip_thought_signature_validator");

  // Turn 2: tool responses must be grouped into role: user
  assert.equal(contents[2].role, "user");
  assert.equal(contents[2].parts.length, 2);
  assert.equal(contents[2].parts[0].functionResponse.name, "parse_item_info");
  assert.equal(contents[2].parts[0].functionResponse.response.output, '{"title":"Math"}');
  assert.equal(contents[2].parts[1].functionResponse.name, "get_authoring_guide");
  assert.equal(contents[2].parts[1].functionResponse.response.output, "guide details");
});

test("ai-agent tools: buildGeminiContents preserves explicit thoughtSignature on functionCall", () => {
  const messages = [
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "call_1", name: "parse_item_info", input: {}, thoughtSignature: "enc_sig_12345" },
      ],
    },
  ];
  const contents = buildGeminiContents(messages);
  assert.equal(contents[0].parts[0].thought_signature, "enc_sig_12345");
  assert.equal(contents[0].parts[0].thoughtSignature, "enc_sig_12345");
});
