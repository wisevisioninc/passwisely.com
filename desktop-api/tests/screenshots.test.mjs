import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../../electron/ScreenshotHelper.ts", import.meta.url), "utf8");
const limits = {};
new Function("exports", ts.transpileModule(fs.readFileSync(new URL("../../electron/screenshotLimits.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(limits);
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function settled(check) {
  for (let index = 0; index < 300; index++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail("screenshot operation did not reach expected state");
}
function fixture(context, { main = 0, extra = 0, capture, trash, fileSystem = fs } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-screenshot-test-"));
  const trashDirectory = path.join(directory, "fixture-trash"); fs.mkdirSync(trashDirectory);
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seeded = { main: [], extra: [] };
  for (const [kind, count] of [["main", main], ["extra", extra]]) {
    const folder = path.join(directory, kind === "main" ? "screenshots" : "extra_screenshots"); fs.mkdirSync(folder);
    for (let index = 0; index < count; index++) {
      const filename = path.join(folder, "seed-" + index + ".png"); fs.writeFileSync(filename, "fixture-png-" + index); fs.utimesSync(filename, 100 + index, 100 + index); seeded[kind].push(filename);
    }
  }
  const captures = [], trashed = [], visibility = [];
  const target = { id: 22, scaleFactor: 2, size: { width: 1280, height: 720 } };
  const electron = {
    app: { getPath: () => directory }, screen: { getPrimaryDisplay: () => ({ id: 11, scaleFactor: 1, size: { width: 800, height: 600 } }) },
    desktopCapturer: { async getSources(options) { captures.push(options); if (capture) return capture(options); return [{ display_id: "22", thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from("captured-fixture-png") } }]; } },
    shell: { async trashItem(filename) { trashed.push(filename); if (trash) return trash(filename, trashDirectory); await fs.promises.rename(filename, path.join(trashDirectory, path.basename(filename))); } },
  };
  const module = { exports: {} };
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", javascript)(id => id === "electron" ? electron : id === "node:fs" ? fileSystem : id === "./screenshotLimits" ? limits : require(id), module, module.exports);
  const helper = new module.exports.ScreenshotHelper("queue", () => target);
  return { helper, target, directory, seeded, captures, trashed, trashDirectory, visibility, hide: () => visibility.push("hide"), show: () => visibility.push("show") };
}

test("Live capture freezes the selected display and always uses the normal queue after code view switches", async context => {
  const f = fixture(context, { extra: 1 });
  f.helper.setView("debug");
  const captured = f.helper.takeLiveScreenshot(f.hide, f.show);
  f.target.id = 99; f.target.size.width = 999;
  f.helper.setView("solutions");
  const filename = await captured;
  assert.deepEqual(f.captures[0].thumbnailSize, { width: 2560, height: 1440 });
  assert.deepEqual(f.helper.getPendingScreenshots(), [filename]);
  assert.deepEqual(f.helper.getExtraScreenshotQueue(), f.seeded.extra);
  const external = f.helper.getPendingScreenshots(); external.length = 0;
  assert.deepEqual(f.helper.getPendingScreenshots(), [filename]);
  assert.deepEqual(f.visibility, ["hide", "show"]);
});

test("legacy capture selects its queue at invocation while Live ignores the legacy getView state", async context => {
  const f = fixture(context);
  f.helper.setView("solutions");
  const capture = f.helper.takeScreenshot(f.hide, f.show);
  f.helper.setView("queue");
  const filename = await capture;
  assert.deepEqual(f.helper.getScreenshotQueue(), []);
  assert.deepEqual(f.helper.getExtraScreenshotQueue(), [filename]);
});

test("clear snapshots cannot remove a capture that finishes while the clear waits for serialized ownership", async context => {
  const captured = deferred();
  const f = fixture(context, { main: 1, capture: () => captured.promise });
  const taking = f.helper.takeLiveScreenshot(f.hide, f.show);
  await settled(() => f.captures.length === 1);
  const clearing = f.helper.clearPendingScreenshots();
  captured.resolve([{ display_id: "22", thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from("new-image") } }]);
  const newPath = await taking;
  assert.equal((await clearing).success, true);
  assert.deepEqual(f.trashed, f.seeded.main);
  assert.deepEqual(f.helper.getPendingScreenshots(), [newPath]);
  assert.equal(fs.existsSync(newPath), true);
  assert.equal(fs.existsSync(path.join(f.trashDirectory, path.basename(f.seeded.main[0]))), true);
});

test("Trash failure retains exact queue ownership and reason; retry consumes only the supplied snapshot", async context => {
  let fail = true;
  const f = fixture(context, { main: 2, async trash(filename, destination) { if (fail) throw new Error("fixture Trash permission denied"); await fs.promises.rename(filename, path.join(destination, path.basename(filename))); } });
  const first = await f.helper.consumeScreenshots([f.seeded.main[0]]);
  assert.equal(first.success, false); assert.match(first.error, /permission denied/);
  assert.deepEqual(first.failed.map(item => item.path), [f.seeded.main[0]]);
  assert.deepEqual(f.helper.getPendingScreenshots(), f.seeded.main);
  fail = false;
  const retry = f.helper.consumeScreenshots([f.seeded.main[0]]);
  const concurrent = f.helper.consumeScreenshots([f.seeded.main[0]]);
  assert.equal((await retry).success, true);
  assert.equal((await concurrent).success, true);
  assert.deepEqual(f.helper.getPendingScreenshots(), [f.seeded.main[1]]);
  assert.equal(f.trashed.length, 2, "already retired snapshot must not invoke Trash again");
});

test("cancellation retains unprocessed screenshot owners when a prior Trash operation is already in flight", async context => {
  const firstTrash = deferred();
  const f = fixture(context, { main: 2, async trash(filename, destination) { await firstTrash.promise; await fs.promises.rename(filename, path.join(destination, path.basename(filename))); } });
  const controller = new AbortController();
  const consuming = f.helper.consumeScreenshots(f.helper.getPendingScreenshots(), controller.signal);
  await settled(() => f.trashed.length === 1); controller.abort(); firstTrash.resolve();
  const result = await consuming;
  assert.equal(result.success, false);
  assert.deepEqual(result.removed, [f.seeded.main[0]]);
  assert.deepEqual(f.helper.getPendingScreenshots(), [f.seeded.main[1]]);
  assert.match(result.error, /cancelled/);
});

test("unowned paths and replaced symlinks are never handed to Trash or read as previews", async context => {
  const f = fixture(context, { main: 1 });
  const outside = path.join(f.directory, "outside.png"); fs.writeFileSync(outside, "outside");
  assert.equal((await f.helper.deleteScreenshot(outside)).success, false);
  await assert.rejects(() => f.helper.getImagePreview(outside), /not owned/);
  fs.unlinkSync(f.seeded.main[0]); fs.symlinkSync(outside, f.seeded.main[0]);
  assert.equal((await f.helper.consumeScreenshots(f.seeded.main)).success, false);
  assert.deepEqual(f.trashed, []);
  assert.equal(fs.readFileSync(outside, "utf8"), "outside");
  assert.deepEqual(f.helper.getPendingScreenshots(), f.seeded.main);
});

test("full queue capacity does not discard a failed cleanup owner or save an untracked sixth image", async context => {
  const f = fixture(context, { main: 5, trash: async () => { throw new Error("fixture Trash blocked"); } });
  await assert.rejects(() => f.helper.takeLiveScreenshot(f.hide, f.show), /queue is full.*Trash blocked/);
  assert.deepEqual(f.helper.getPendingScreenshots(), f.seeded.main);
  assert.equal(fs.readdirSync(path.join(f.directory, "screenshots")).length, 5);
  assert.deepEqual(f.visibility, ["hide", "show"]);
});

test("a missing selected display fails instead of silently capturing another display", async context => {
  const f = fixture(context, { capture: async () => [{ display_id: "11", thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from("wrong-display") } }] });
  await assert.rejects(() => f.helper.takeLiveScreenshot(f.hide, f.show), /selected display/);
  assert.deepEqual(f.helper.getPendingScreenshots(), []);
  assert.deepEqual(f.visibility, ["hide", "show"]);
});

test("a partial file write remains owned when recoverable cleanup also fails", async context => {
  const fileSystem = { ...fs, promises: { ...fs.promises,
    async open(filename, flags) {
      const handle = await fs.promises.open(filename, flags);
      return {
        async writeFile() { await handle.writeFile("partial fixture image"); throw new Error("fixture write failed"); },
        close: () => handle.close(),
      };
    },
  } };
  const f = fixture(context, { fileSystem, trash: async () => { throw new Error("fixture Trash blocked"); } });
  await assert.rejects(() => f.helper.takeLiveScreenshot(f.hide, f.show), /write failed.*Trash blocked/);
  const pending = f.helper.getPendingScreenshots();
  assert.equal(pending.length, 1);
  assert.equal(fs.readFileSync(pending[0], "utf8"), "partial fixture image");
  assert.equal(fs.readdirSync(path.join(f.directory, "screenshots")).length, 1);
  assert.deepEqual(f.visibility, ["hide", "show"]);
});
