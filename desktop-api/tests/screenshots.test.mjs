import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const supportsScreenStatus = ["darwin", "win32"].includes(process.platform);
const observedScreenAccess = status => supportsScreenStatus ? status : "unknown";
const { ScreenshotFailure } = createProductionTsLoader({ env: {} })(new URL("../../electron/screenshotFailure.ts", import.meta.url).pathname);
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function settled(check) {
  for (let index = 0; index < 300; index++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail("screenshot operation did not reach expected state");
}
function fixture(context, { main = 0, extra = 0, capture, trash, fileSystem = fs, screenAccess = "unknown" } = {}) {
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
  const captures = [], trashed = [], statusReads = [];
  const channels = new Map(), shortcuts = new Map(), events = [];
  const target = { id: 22, scaleFactor: 2, size: { width: 1280, height: 720 } };
  const electron = {
    app: { getPath: () => directory, on() {} },
    systemPreferences: { getMediaAccessStatus(type) { statusReads.push(type); return typeof screenAccess === "function" ? screenAccess() : screenAccess; } },
    ipcMain: { handle: (channel, callback) => channels.set(channel, callback) },
    globalShortcut: { register(key, callback) { shortcuts.set(key, callback); return true; }, unregister(key) { shortcuts.delete(key); }, unregisterAll() { shortcuts.clear(); } },
    screen: { getPrimaryDisplay: () => ({ id: 11, scaleFactor: 1, size: { width: 800, height: 600 } }) },
    desktopCapturer: { async getSources(options) { captures.push(options); if (capture) return capture(options); return [{ display_id: "22", thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from("captured-fixture-png") } }]; } },
    shell: { async trashItem(filename) { trashed.push(filename); if (trash) return trash(filename, trashDirectory); await fs.promises.rename(filename, path.join(trashDirectory, path.basename(filename))); } },
  };
  const load = createProductionTsLoader({
    mocks: { electron, "node:fs": fileSystem, "./ResumeHelper": { ResumeHelper: {} } },
    console: { log() {}, error() {} }, env: {},
  });
  const production = relative => load(new URL(`../../electron/${relative}`, import.meta.url).pathname);
  const helper = new (production("ScreenshotHelper.ts").ScreenshotHelper)("queue", () => target);
  const adapters = () => {
    const window = { isDestroyed: () => false, webContents: { send: (...args) => events.push(args) } };
    const deps = { getMainWindow: () => window, takeScreenshot: () => helper.takeLiveScreenshot(), getImagePreview: filename => helper.getImagePreview(filename),
      canUseShortcuts: () => true, isLiveWorkspace: () => true, isVisible: () => true };
    production("ipcHandlers.ts").initializeIpcHandlers(deps);
    new (production("shortcuts.ts").ShortcutsHelper)(deps).registerGlobalShortcuts();
  };
  return { helper, target, directory, seeded, captures, trashed, trashDirectory, statusReads, channels, shortcuts, events, adapters };
}

test("Live capture freezes the selected display and always uses the normal queue after code view switches", async context => {
  const f = fixture(context, { extra: 1 });
  f.helper.setView("debug");
  const captured = f.helper.takeLiveScreenshot();
  f.target.id = 99; f.target.size.width = 999;
  f.helper.setView("solutions");
  const filename = await captured;
  assert.deepEqual(f.captures[0].thumbnailSize, { width: 2560, height: 1440 });
  assert.deepEqual(f.helper.getPendingScreenshots(), [filename]);
  assert.deepEqual(f.helper.getExtraScreenshotQueue(), f.seeded.extra);
  const external = f.helper.getPendingScreenshots(); external.length = 0;
  assert.deepEqual(f.helper.getPendingScreenshots(), [filename]);
});

test("legacy capture selects its queue at invocation while Live ignores the legacy getView state", async context => {
  const f = fixture(context);
  f.helper.setView("solutions");
  const capture = f.helper.takeScreenshot();
  f.helper.setView("queue");
  const filename = await capture;
  assert.deepEqual(f.helper.getScreenshotQueue(), []);
  assert.deepEqual(f.helper.getExtraScreenshotQueue(), [filename]);
});

test("clear snapshots cannot remove a capture that finishes while the clear waits for serialized ownership", async context => {
  const captured = deferred();
  const f = fixture(context, { main: 1, capture: () => captured.promise });
  const taking = f.helper.takeLiveScreenshot();
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
  await assert.rejects(() => f.helper.takeLiveScreenshot(), /queue is full.*Trash blocked/);
  assert.deepEqual(f.helper.getPendingScreenshots(), f.seeded.main);
  assert.equal(fs.readdirSync(path.join(f.directory, "screenshots")).length, 5);
});

test("a missing selected display fails instead of silently capturing another display", async context => {
  const f = fixture(context, { capture: async () => [{ display_id: "11", thumbnail: { isEmpty: () => false, toPNG() { assert.fail("must not capture a different display"); } } }], screenAccess: "granted" });
  await assert.rejects(() => f.helper.takeLiveScreenshot(), error => {
    assert.equal(error.stage, "display-selection");
    assert.equal(error.screenAccess, observedScreenAccess("granted"));
    assert.match(error.message, /selected display/);
    return true;
  });
  assert.deepEqual(f.helper.getPendingScreenshots(), []);
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
  await assert.rejects(() => f.helper.takeLiveScreenshot(), /write failed.*Trash blocked/);
  const pending = f.helper.getPendingScreenshots();
  assert.equal(pending.length, 1);
  assert.equal(fs.readFileSync(pending[0], "utf8"), "partial fixture image");
  assert.equal(fs.readdirSync(path.join(f.directory, "screenshots")).length, 1);
});


test("Electron's real string rejection and Error failures retain their native reason, stage and observed access", async context => {
  for (const reason of ["Failed to get sources.", new Error("fixture backend unavailable")]) {
    const f = fixture(context, { capture: async () => { throw reason; }, screenAccess: "granted" });
    await assert.rejects(() => f.helper.takeLiveScreenshot(), error => {
      assert.equal(error.name, "ScreenshotFailure");
      assert.equal(error.stage, "screen-enumeration");
      assert.equal(error.screenAccess, observedScreenAccess("granted"));
      assert.equal(error.cause, reason);
      assert.equal(error.needsScreenPermission, false);
      assert.ok(error.message.includes(typeof reason === "string" ? reason : reason.message));
      assert.ok(error.message.includes(`stage=screen-enumeration; screen=${observedScreenAccess("granted")}`));
      assert.doesNotMatch(error.message, /allow PassWisely|access is denied/);
      return true;
    });
    assert.deepEqual(f.statusReads, supportsScreenStatus ? ["screen"] : []);
    assert.deepEqual(f.helper.getPendingScreenshots(), []);
    assert.deepEqual(fs.readdirSync(path.join(f.directory, "screenshots")), []);
  }
});

test("unknown native errors and failed or unrecognized status reads remain unknown without coercion", async context => {
  const unknown = { toString() { assert.fail("must not stringify an unknown boundary value"); } };
  for (const [reason, status] of [[null, "unknown"], [unknown, "unexpected-status"], [42, () => { throw new Error("status API unavailable"); }]]) {
    const f = fixture(context, { capture: async () => { throw reason; }, screenAccess: status });
    await assert.rejects(() => f.helper.takeLiveScreenshot(), error => {
      assert.equal(error.stage, "screen-enumeration");
      assert.equal(error.screenAccess, "unknown");
      assert.equal(error.cause, reason);
      assert.equal(error.needsScreenPermission, false);
      assert.match(error.message, /unknown error value/);
      assert.doesNotMatch(error.message, /allow PassWisely|access is denied/);
      return true;
    });
    assert.deepEqual(f.helper.getPendingScreenshots(), []);
  }
});

test("empty thumbnails and PNG conversion failures have separate stages and never reach storage", async context => {
  for (const [stage, thumbnail] of [
    ["thumbnail", { isEmpty: () => true, toPNG() { assert.fail("empty images must not be converted"); } }],
    ["image-conversion", { isEmpty: () => false, toPNG() { throw "fixture PNG conversion failed"; } }],
    ["image-conversion", { isEmpty: () => false, toPNG: () => Buffer.alloc(0) }],
  ]) {
    const f = fixture(context, { capture: async () => [{ display_id: "22", thumbnail }], screenAccess: "granted" });
    await assert.rejects(() => f.helper.takeLiveScreenshot(), error => {
      assert.equal(error.stage, stage); assert.equal(error.screenAccess, observedScreenAccess("granted"));
      assert.equal(error.needsScreenPermission, false);
      return true;
    });
    assert.deepEqual(f.helper.getPendingScreenshots(), []);
    assert.deepEqual(fs.readdirSync(path.join(f.directory, "screenshots")), []);
  }
});

test("storage failure retains its native string without being classified as a screen permission failure", async context => {
  const fileSystem = { ...fs, promises: { ...fs.promises, async open() { throw "fixture disk is full"; } } };
  const f = fixture(context, { fileSystem, screenAccess: "denied" });
  await assert.rejects(() => f.helper.takeLiveScreenshot(), error => {
    assert.equal(error.stage, "storage"); assert.equal(error.screenAccess, observedScreenAccess("denied"));
    assert.equal(error.needsScreenPermission, false);
    assert.match(error.message, /fixture disk is full/);
    assert.doesNotMatch(error.message, /allow PassWisely/);
    return true;
  });
  assert.deepEqual(f.helper.getPendingScreenshots(), []);
});

test("buttons and hotkey preserve the same production capture error and request guidance only for observed blocked access", async context => {
  for (const screenAccess of ["denied", "restricted", "granted", "not-determined", "unknown"]) {
    const f = fixture(context, { capture: async () => { throw "Failed to get sources."; }, screenAccess });
    f.adapters();
    const triggered = await f.channels.get("trigger-screenshot")();
    const taken = await f.channels.get("take-screenshot")();
    await f.shortcuts.get("CommandOrControl+H")();
    const hotkey = f.events.find(([name]) => name === "screenshot-error");
    assert.equal(triggered.error, taken.error);
    assert.equal(triggered.error, hotkey[1]);
    assert.match(triggered.error, /Failed to get sources\./);
    assert.equal(f.events.filter(([name]) => name === "capture-permissions-needed").length,
      process.platform === "darwin" && ["denied", "restricted"].includes(screenAccess) ? 3 : 0);
    assert.equal(f.events.some(([name]) => name === "screenshot-taken"), false);
    assert.deepEqual(f.helper.getPendingScreenshots(), []);
  }
});


test("observed access yields Mac guidance only for denied or restricted capture, never Windows or storage", () => {
  for (const platform of ["darwin", "win32"]) {
    for (const stage of ["screen-enumeration", "storage"]) {
      for (const status of ["denied", "restricted", "granted", "not-determined", "unknown"]) {
        const failure = new ScreenshotFailure(stage, "fixture native reason", status, platform);
        const needed = platform === "darwin" && stage !== "storage" && ["denied", "restricted"].includes(status);
        assert.equal(failure.needsScreenPermission, needed);
        assert.equal(failure.message.includes("allow PassWisely"), needed);
        assert.ok(failure.message.includes(`screen=${status}`));
      }
    }
  }
});

test("a partial write plus failed close preserves both reasons and keeps the file owned without attempting Trash", async context => {
  const handles = [];
  const fileSystem = { ...fs, promises: { ...fs.promises,
    async open(filename, flags) {
      const handle = await fs.promises.open(filename, flags); handles.push(handle);
      return {
        async writeFile() { await handle.writeFile("partial fixture image"); throw "fixture native write error"; },
        async close() { throw "fixture native close error"; },
      };
    },
  } };
  // The fixture retains its deliberately unclosed handle until test cleanup.
  context.after(async () => { for (const handle of handles) await handle.close(); });
  const f = fixture(context, { fileSystem });
  await assert.rejects(() => f.helper.takeLiveScreenshot(), error => {
    assert.equal(error.stage, "storage");
    assert.match(error.message, /fixture native write error.*fixture native close error/);
    return true;
  });
  assert.equal(f.helper.getPendingScreenshots().length, 1);
  assert.deepEqual(f.trashed, []);
});


test("explicit screen permission probe freezes the selected display and checks only a tiny thumbnail without encoding or writing", async context => {
  let opened = 0;
  const fileSystem = { ...fs, promises: { ...fs.promises, async open() { opened++; assert.fail("a permission probe must not open an image file"); } } };
  const f = fixture(context, { main: 1, extra: 1, fileSystem, capture: async () => [
    { display_id: "11", thumbnail: { isEmpty() { assert.fail("must not inspect another display"); }, toPNG() { assert.fail("must not encode a permission probe"); } } },
    { display_id: "22", thumbnail: { isEmpty: () => false, toPNG() { assert.fail("must not encode a permission probe"); } } },
  ] });
  f.helper.setView("solutions");
  const before = ["screenshots", "extra_screenshots"].map(folder => fs.readdirSync(path.join(f.directory, folder)));
  const probing = f.helper.probeScreenPermission();
  f.target.id = 99; f.target.size.width = 999;
  await probing;
  assert.deepEqual(f.captures, [{ types: ["screen"], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false }]);
  assert.equal(opened, 0);
  assert.deepEqual(f.helper.getPendingScreenshots(), f.seeded.main);
  assert.deepEqual(f.helper.getExtraScreenshotQueue(), f.seeded.extra);
  assert.deepEqual(["screenshots", "extra_screenshots"].map(folder => fs.readdirSync(path.join(f.directory, folder))), before);
  assert.deepEqual(f.statusReads, [], "a successful probe does not declare that the OS granted permission");
  assert.deepEqual(f.trashed, []);
});

test("screen permission probe shares enumeration, selected-display and empty-thumbnail failures without changing either queue", async context => {
  for (const [stage, capture] of [
    ["screen-enumeration", async () => { throw "Failed to get sources."; }],
    ["display-selection", async () => [{ display_id: "11", thumbnail: { isEmpty: () => false, toPNG() { assert.fail("must not encode"); } } }]],
    ["thumbnail", async () => [{ display_id: "22", thumbnail: { isEmpty: () => true, toPNG() { assert.fail("must not encode"); } } }]],
  ]) {
    const f = fixture(context, { main: 1, extra: 1, capture, screenAccess: "denied", fileSystem: {
      ...fs, promises: { ...fs.promises, async open() { assert.fail("a rejected permission probe must not write files"); } },
    } });
    await assert.rejects(() => f.helper.probeScreenPermission(), error => {
      assert.equal(error.name, "ScreenshotFailure"); assert.equal(error.stage, stage);
      assert.equal(error.screenAccess, observedScreenAccess("denied"));
      return true;
    });
    assert.deepEqual(f.helper.getPendingScreenshots(), f.seeded.main);
    assert.deepEqual(f.helper.getExtraScreenshotQueue(), f.seeded.extra);
    assert.deepEqual(f.trashed, []);
    assert.deepEqual(f.captures[0].thumbnailSize, { width: 1, height: 1 });
  }
});
