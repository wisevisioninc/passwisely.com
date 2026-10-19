import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
function production(relative, mock = () => undefined) {
  const javascript = ts.transpileModule(readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", javascript)(id => mock(id) ?? require(id), module, module.exports);
  return module.exports;
}
const { createCaptureCloseGuard } = production("electron/live/WindowCloseGuard.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function closeEvent() { return { prevented: false, preventDefault() { this.prevented = true; } }; }

test("repeated window closes cannot bypass pending capture release; failure retains the window for retry", async () => {
  let cleanup = deferred(), calls = 0, closes = 0;
  const failures = [];
  const guard = createCaptureCloseGuard({
    needsCleanup: () => true,
    reset: () => { calls++; return cleanup.promise; },
    isDestroyed: () => false,
    close: () => { const event = closeEvent(); guard(event); assert.equal(event.prevented, false); closes++; },
    failed: message => failures.push(message),
  });
  const first = closeEvent(), repeated = closeEvent();
  guard(first); guard(repeated);
  assert.equal(first.prevented, true);
  assert.equal(repeated.prevented, true);
  assert.equal(calls, 1);
  cleanup.resolve({ success: false, error: "fixture cleanup failure" });
  await tick();
  assert.equal(closes, 0);
  assert.deepEqual(failures, ["fixture cleanup failure"]);
  cleanup = deferred();
  const retry = closeEvent(); guard(retry);
  assert.equal(retry.prevented, true);
  assert.equal(calls, 2);
  cleanup.resolve({ success: true });
  await tick();
  assert.equal(closes, 1);
});

test("a resource-free window closes immediately; destruction during release does not close a replacement", async () => {
  const cleanup = deferred();
  let active = false, destroyed = false, calls = 0, closes = 0;
  const guard = createCaptureCloseGuard({
    needsCleanup: () => active,
    reset: () => { calls++; return cleanup.promise; },
    isDestroyed: () => destroyed,
    close: () => { closes++; },
    failed: () => assert.fail("unexpected cleanup failure"),
  });
  const idle = closeEvent(); guard(idle);
  assert.equal(idle.prevented, false); assert.equal(calls, 0);
  active = true;
  const capturing = closeEvent(); guard(capturing);
  assert.equal(capturing.prevented, true);
  destroyed = true;
  cleanup.resolve({ success: true }); await tick();
  assert.equal(closes, 0);
});

function findSignOut(element) {
  if (!element || typeof element !== "object") return null;
  if (element.type === "button" && String(element.props.children).trim() === "Sign out") return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = findSignOut(child); if (found) return found;
  }
  return null;
}

for (const componentFile of ["Queue/QueueCommands", "Solutions/SolutionCommands"]) {
test(`${componentFile} sign-out reloads only after successful native cleanup and logout`, async () => {
  const previousWindow = globalThis.window;
  const toasts = [];
  let reloads = 0, outcome = { success: false, error: "release failed" };
  globalThis.window = {
    screen: { availHeight: 900 }, location: { reload() { reloads++; } },
    electronAPI: { accountLogout: async () => { if (outcome instanceof Error) throw outcome; return outcome; } },
  };
  try {
    // Evaluate the real component's event handler with its settings panel open.
    // Child panels and hook scheduling are irrelevant to this boundary test.
    let stateIndex = 0;
    const mockReact = { ...React, useState(initial) { return [stateIndex++ === 0 ? "settings" : initial, () => {}]; }, useRef() { return { current: null }; }, useEffect() {} };
    const { default: Component } = production(`src/components/${componentFile}.tsx`, id => {
      if (id === "react") return mockReact;
      if (id === "../../contexts/toast") return { useToast: () => ({ showToast: (...args) => toasts.push(args) }) };
      if (id === "../../utils/platform") return { COMMAND_KEY: "Cmd" };
      if (id.startsWith("../shared/")) return new Proxy({}, { get: () => () => null });
    });
    const signOut = findSignOut(Component({ credits: 1, currentLanguage: "python", currentQuery: "", onTooltipVisibilityChange() {} }));
    assert.ok(signOut, "production settings contains sign out");
    await signOut.props.onClick();
    assert.equal(reloads, 0); assert.equal(toasts[0][1], "release failed");
    outcome = new Error("IPC unavailable"); await signOut.props.onClick();
    assert.equal(reloads, 0); assert.equal(toasts[1][1], "IPC unavailable");
    outcome = { success: true }; await signOut.props.onClick();
    assert.equal(reloads, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
}
