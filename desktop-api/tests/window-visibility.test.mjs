import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { createProductionTsLoader } from './helpers/production-typescript.mjs';

const load = createProductionTsLoader({ env: {} });
const { WindowVisibilityController, WindowVisibilityCleanupError } = load(new URL('../../electron/WindowVisibility.ts', import.meta.url).pathname);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const syntheticFrame = [{ display_id: '22', thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from('synthetic fixture PNG; no screen pixels') } }];

function fixture(context, { visible = true, live = false, auth = false, screenAccess = "unknown" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'passwisely-window-visibility-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const events = [], bindings = new Map(), captures = [], windows = [];
  let failShow = false, failHide = false;
  function nativeWindow() {
    const win = new EventEmitter(); let shown = false, destroyed = false, minimized = false;
    Object.assign(win, {
      isDestroyed: () => destroyed, isMinimized: () => minimized,
      getBounds: () => ({ x: 0, y: 24, width: 1440, height: 876 }),
      setBounds: value => events.push(['bounds', value]), setIgnoreMouseEvents() {}, setVisibleOnAllWorkspaces() {},
      hide() { shown = false; events.push(['hide', win]); if (failHide) throw new Error('fixture hide failed'); },
      showInactive() { shown = true; events.push(['showInactive', win]); if (failShow) throw new Error('fixture show failed'); },
      focus() { events.push(['focus', win]); },
      restore() { minimized = false; shown = true; events.push(['restore', win]); },
      webContents: { send: (...args) => events.push(['send', ...args]) },
    });
    const native = { win, visible: () => shown, minimize: () => { minimized = true; shown = false; }, close: () => { destroyed = true; shown = false; win.emit('closed'); } };
    windows.push(native); return native;
  }
  const target = { id: 22, scaleFactor: 1, size: { width: 1440, height: 900 } };
  const electron = {
    app: { getPath: () => directory, on() {} }, screen: { getPrimaryDisplay: () => target },
    systemPreferences: { getMediaAccessStatus: () => screenAccess },
    globalShortcut: { register(key, run) { bindings.set(key, run); return true; }, unregister(key) { bindings.delete(key); }, unregisterAll() { bindings.clear(); } },
    desktopCapturer: { getSources() { const capture = deferred(); captures.push(capture); return capture.promise; } },
    shell: { async trashItem() { assert.fail('No screenshot retirement expected'); } },
  };
  const production = createProductionTsLoader({ mocks: { electron }, env: {}, console: { log() {}, error() {} } });
  // All production modules share the same error constructors, as in the app.
  const visibility = production(new URL('../../electron/WindowVisibility.ts', import.meta.url).pathname);
  const { ScreenshotHelper } = production(new URL('../../electron/ScreenshotHelper.ts', import.meta.url).pathname);
  const { ShortcutsHelper } = production(new URL('../../electron/shortcuts.ts', import.meta.url).pathname);
  const mainSource = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  const names = ['createWindowVisibility', 'applyNativeHideMainWindow', 'applyNativeShowMainWindow', 'hideMainWindow', 'showMainWindow', 'toggleMainWindow', 'takeScreenshot', 'revealMainWindow', 'handleWindowClosed'];
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
  const code = ts.transpileModule(`${selected}\n${names.map(name => `exports.${name}=${name};`).join('\n')}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let native = nativeWindow();
  const state = { mainWindow: native.win, windowVisibility: null, screenshotHelper: new ScreenshotHelper('queue', () => target), windowPosition: null, windowSize: null };
  const main = {};
  vm.runInNewContext(code, {
    exports: main, state, WindowVisibilityController: visibility.WindowVisibilityController, WindowVisibilityCleanupError: visibility.WindowVisibilityCleanupError,
    console: { log() {}, error() {} }, isAuthWindow: () => auth, createWindow: async () => { assert.fail('No native creation expected'); },
    overlayWindow: { isLive: () => live, setInteractive() {}, restoreMousePolicy() {}, publishGeometry: () => events.push(['geometry']), reset() {} },
    notifyScreenshotQueueChanged() {},
  });
  const install = () => { state.windowVisibility = main.createWindowVisibility(native.win); native.win.on('closed', main.handleWindowClosed); };
  install();
  if (visible) main.showMainWindow();
  state.shortcutsHelper = new ShortcutsHelper({
    canUseShortcuts: () => true, isLiveWorkspace: () => live, isVisible: () => state.windowVisibility?.canPresent() ?? false,
    getMainWindow: () => state.mainWindow, takeScreenshot: main.takeScreenshot,
    getImagePreview: filename => state.screenshotHelper.getImagePreview(filename), toggleMainWindow: main.toggleMainWindow,
    processingHelper: null, clearQueues: async () => ({ success: true }), setView() {},
  });
  state.shortcutsHelper.registerGlobalShortcuts(); events.length = 0;
  return { main, state, captures, bindings, events, windows, WindowVisibilityCleanupError: visibility.WindowVisibilityCleanupError, get native() { return native; },
    async captured(count = 1) { for (let i = 0; i < 1000; i++) { if (captures.length >= count) return captures[count - 1]; await new Promise(resolve => setTimeout(resolve, 1)); } assert.fail('capture did not reach the native boundary'); },
    replace() { native.close(); native = nativeWindow(); state.mainWindow = native.win; install(); },
    failShow(value) { failShow = value; }, failHide(value) { failHide = value; },
  };
}

test('hidden Programming Cmd+H captures without changing its persistent hidden intent or showing the window', async context => {
  const f = fixture(context, { visible: false });
  assert.ok(f.bindings.has('CommandOrControl+H'));
  const taking = f.bindings.get('CommandOrControl+H')(); const frame = await f.captured(); frame.resolve(syntheticFrame); await taking;
  assert.equal(f.native.visible(), false); assert.equal(f.state.windowVisibility.isRequestedVisible(), false);
  assert.equal(f.events.some(([name]) => ['showInactive', 'focus', 'restore'].includes(name)), false);
});

test('a pending capture preserves later explicit Hide and a single Show/Hide toggle changes intent rather than temporary native state', async context => {
  const f = fixture(context);
  const taking = f.bindings.get('CommandOrControl+H')(); const frame = await f.captured();
  assert.equal(f.native.visible(), false); assert.equal(f.state.windowVisibility.isRequestedVisible(), true);
  f.bindings.get('CommandOrControl+B')();
  assert.equal(f.state.windowVisibility.isRequestedVisible(), false); assert.equal(f.native.visible(), false);
  f.main.hideMainWindow(); frame.resolve(syntheticFrame); await taking;
  assert.equal(f.native.visible(), false); assert.equal(f.events.filter(([name]) => name === 'showInactive').length, 0);
});

test('explicit Show and activate/reveal cannot bypass capture suppression, including minimized Auth restore/focus', async context => {
  const f = fixture(context, { auth: true });
  const taking = f.main.takeScreenshot(); const frame = await f.captured(); f.native.minimize();
  f.main.showMainWindow(); f.main.revealMainWindow();
  assert.equal(f.native.visible(), false); assert.equal(f.events.some(([name]) => ['showInactive', 'restore', 'focus'].includes(name)), false);
  frame.resolve(syntheticFrame); await taking;
  assert.equal(f.native.visible(), true); assert.equal(f.events.filter(([name]) => name === 'restore').length, 1);
  assert.equal(f.events.filter(([name]) => name === 'focus').length, 0, 'capture cleanup remains passive');
});

test('two queued real captures keep the native window suppressed until both leases release', async context => {
  const f = fixture(context, { live: true });
  const first = f.main.takeScreenshot(), second = f.main.takeScreenshot();
  const firstFrame = await f.captured();
  assert.equal(f.bindings.has('CommandOrControl+H'), false, 'Live retains its hidden-shortcut restriction during suppression');
  assert.ok(f.bindings.has('CommandOrControl+B'));
  firstFrame.resolve(syntheticFrame); await first;
  assert.equal(f.native.visible(), false); assert.equal(f.events.filter(([name]) => name === 'showInactive').length, 0);
  const secondFrame = await f.captured(2); secondFrame.resolve(syntheticFrame); await second;
  assert.equal(f.native.visible(), true); assert.equal(f.events.filter(([name]) => name === 'showInactive').length, 1);
  assert.ok(f.bindings.has('CommandOrControl+H'));
  assert.equal(f.events.some(([name]) => ['bounds', 'focus'].includes(name)), false, 'Live capture does not alter native geometry or keyboard ownership');
});

test('capture failure releases suppression while window replacement prevents an old completion showing a new window', async context => {
  const f = fixture(context);
  const failed = f.main.takeScreenshot(); const failure = assert.rejects(failed, /fixture capture failed/);
  (await f.captured()).reject(new Error('fixture capture failed')); await failure;
  assert.equal(f.native.visible(), true);
  const taking = f.main.takeScreenshot(); const frame = await f.captured(2); f.replace(); const replacement = f.native.win;
  frame.resolve(syntheticFrame); await taking;
  assert.equal(f.native.visible(), false); assert.equal(f.state.windowVisibility.isRequestedVisible(), false);
  assert.equal(f.events.some(([name, win]) => name === 'showInactive' && win === replacement), false);
});

test('failed capture restoration keeps the exact release retryable and preserves both operation and cleanup errors', async context => {
  const f = fixture(context);
  const taking = f.main.takeScreenshot();
  const rejected = assert.rejects(taking, error => error instanceof f.WindowVisibilityCleanupError && /fixture capture failed/.test(error.operationError.message) && /fixture show failed/.test(error.cleanupError.message));
  const frame = await f.captured(); f.failShow(true); frame.reject(new Error('fixture capture failed')); await rejected;
  f.failShow(false); f.main.hideMainWindow(); assert.equal(f.native.visible(), false, 'a partially-applied failed show cannot be mistaken for a successful hidden state');
  f.main.showMainWindow(); assert.equal(f.native.visible(), true, 'the same owner recovers through explicit intent without creating a substitute');
});

test('lease release is idempotent, survives a throwing native effect, and cannot control a disposed original window', () => {
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const effects = []; let fail = false;
  const owner = new WindowVisibilityController(win, { show() { effects.push('show'); if (fail) throw new Error('fixture show failed'); }, hide() { effects.push('hide'); }, changed() {} });
  owner.setRequestedVisible(true); const lease = owner.suppressForCapture(); fail = true;
  assert.throws(() => lease.release(), /fixture show failed/); fail = false; lease.release();
  const done = effects.length; lease.release(); assert.equal(effects.length, done, 'only the same failed release can retry its pending effect');
  const old = owner.suppressForCapture(); win.emit('closed'); old.release(); owner.setRequestedVisible(true);
  assert.equal(effects.at(-1), 'hide'); assert.equal(owner.canPresent(), false);
});

test('failed suppression never starts capture and failed recovery remains owned until a later explicit request', () => {
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  let failHide = false, failShow = false; const effects = [];
  const owner = new WindowVisibilityController(win, { show() { effects.push('show'); if (failShow) throw new Error('fixture show failed'); }, hide() { effects.push('hide'); if (failHide) throw new Error('fixture hide failed'); }, changed() {} });
  owner.setRequestedVisible(true); failHide = true; failShow = true;
  assert.throws(() => owner.suppressForCapture(), error => error instanceof WindowVisibilityCleanupError && /fixture hide failed/.test(error.operationError.message) && /fixture show failed/.test(error.cleanupError.message));
  failHide = false; failShow = false; owner.setRequestedVisible(false); owner.setRequestedVisible(true);
  assert.deepEqual(effects.slice(-2), ['hide', 'show']); assert.equal(owner.canPresent(), true);
});


test('actual screenshot hotkey preserves native capture and restoration failures and opens permission recovery only for observed denial', async context => {
  for (const screenAccess of ['denied', 'granted', 'unknown']) {
    const f = fixture(context, { screenAccess });
    const taking = f.bindings.get('CommandOrControl+H')();
    const frame = await f.captured(); f.failShow(true); frame.reject('Failed to get sources.'); await taking;
    const failure = f.events.find(event => event[0] === 'send' && event[1] === 'screenshot-error');
    assert.ok(failure); assert.match(failure[2], /Failed to get sources\./);
    assert.match(failure[2], /stage=screen-enumeration/);
    assert.ok(failure[2].includes(`screen=${['darwin', 'win32'].includes(process.platform) ? screenAccess : 'unknown'}`));
    assert.match(failure[2], /fixture show failed/);
    assert.equal(f.events.some(event => event[0] === 'send' && event[1] === 'capture-permissions-needed'),
      process.platform === 'darwin' && screenAccess === 'denied');
    assert.deepEqual(f.state.screenshotHelper.getPendingScreenshots(), []);
    f.failShow(false); f.main.hideMainWindow(); f.main.showMainWindow();
    assert.equal(f.native.visible(), true, 'the original visibility owner remains recoverable');
  }
});
