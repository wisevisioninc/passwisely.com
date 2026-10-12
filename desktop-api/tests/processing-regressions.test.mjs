import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("screenshot solve extracts only the programming problem in one model call", async () => {
  const processing = await read("../../electron/ProcessingHelper.ts");

  assert.match(processing, /solveScreenshotProblemHelper/);
  assert.match(processing, /Extract ONLY the programming problem itself/);
  assert.match(processing, /Exclude browser menus, tabs, URLs/);
  assert.match(processing, /parsed.problem_statement/);
  assert.match(processing, /thinking: \{ type: "disabled" \}/);
  assert.match(processing, /extractJsonStringField/);
  assert.match(processing, /Completing the solution/);
  assert.match(processing, /reportsNoProblem/);
  assert.match(processing, /If no programming problem is visible/);
  assert.doesNotMatch(processing, /Extract all text from the image\(s\)/);
});

test("initial processing events are owned by the stable parent view", async () => {
  const [parent, solutions] = await Promise.all([
    read("../../src/_pages/SubscribedApp.tsx"),
    read("../../src/_pages/Solutions.tsx"),
  ]);

  assert.match(parent, /onSolutionStart/);
  assert.match(parent, /onProblemExtracted/);
  assert.match(parent, /onSolutionSuccess/);
  assert.match(parent, /onSolutionError/);
  assert.match(parent, /AI 服务未在规定时间内完成/);
  assert.match(parent, /role="alert"/);
  assert.doesNotMatch(solutions, /onSolutionSuccess/);
  assert.doesNotMatch(solutions, /data\.code\.replace/);
});
