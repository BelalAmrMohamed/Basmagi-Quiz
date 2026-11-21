import test from "node:test";
import assert from "node:assert/strict";
import { ADD_YOUTUBE_TOOL, LIST_YOUTUBE_TOOL, SEARCH_YOUTUBE_TOOL } from "../api/ai-agent/_tools.js";

test("the three YouTube agent tools have stable names and required inputs", () => {
  assert.equal(SEARCH_YOUTUBE_TOOL.name, "search_youtube");
  assert.deepEqual(SEARCH_YOUTUBE_TOOL.input_schema.required, ["query"]);
  assert.equal(LIST_YOUTUBE_TOOL.name, "list_youtube");
  assert.deepEqual(LIST_YOUTUBE_TOOL.input_schema.properties.kind.enum, ["video", "playlist", "all"]);
  assert.equal(ADD_YOUTUBE_TOOL.name, "add_youtube");
  assert.deepEqual(ADD_YOUTUBE_TOOL.input_schema.required, ["url"]);
});
