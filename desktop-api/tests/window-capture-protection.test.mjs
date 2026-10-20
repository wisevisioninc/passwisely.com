import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createProductionTsLoader } from './helpers/production-typescript.mjs';

const load = createProductionTsLoader({ env: {} });
const { WindowCaptureProtection } = load(new URL('../../electron/WindowCaptureProtection.ts', import.meta.url).pathname);
const { WindowVisibilityController } = load(new URL('../../electron/WindowVisibility.ts', import.meta.url).pathname);

function windowFixture({ failProtection = false, calls = [] } = {}) {
  const win = new EventEmitter();
  let destroyed = false;
  Object.assign(win, {
    isDestroyed: () => destroyed,
    setContentProtection(value) {
      calls.push(['protection', value]);
      if (typeof failProtection === 'function' ? failProtection() : failProtection) throw new Error('fixture protection failed');
    },
  });
  return { win, calls, destroy: () => { destroyed = true; } };
}

test('production capture-protection owner reasserts only true on show, restore and focus and releases its own listeners', () => {
  const f = windowFixture();
  let foreignShows = 0;
  const foreignShow = () => { foreignShows++; };
  f.win.on('show', foreignShow);
  const owner = new WindowCaptureProtection(f.win);
  assert.deepEqual(f.calls, [['protection', true]], 'installation requests exclusion immediately');
  for (const event of ['show', 'restore', 'focus']) f.win.emit(event);
  assert.deepEqual(f.calls, Array.from({ length: 4 }, () => ['protection', true]));
  for (const event of ['hide', 'blur', 'minimize']) f.win.emit(event);
  assert.equal(f.calls.length, 4, 'visibility/focus loss never turns capture protection off');
  f.destroy();
  f.win.emit('focus'); assert.equal(f.calls.length, 4, 'destroyed native windows cannot receive a request');
  f.win.emit('closed'); owner.dispose();
  for (const event of ['restore', 'focus', 'closed']) assert.equal(f.win.listenerCount(event), 0);
  assert.deepEqual(f.win.listeners('show'), [foreignShow], 'cleanup removes only this owner\'s listeners');
  f.win.emit('show'); assert.equal(foreignShows, 2); assert.equal(f.calls.length, 4);
});

test('initial protection failure propagates without retaining a half-installed event owner', () => {
  const f = windowFixture({ failProtection: true });
  assert.throws(() => new WindowCaptureProtection(f.win), /fixture protection failed/);
  assert.deepEqual(f.calls, [['protection', true]]);
  for (const event of ['show', 'restore', 'focus', 'closed']) assert.equal(f.win.listenerCount(event), 0);
});

function mainWindowFixture({ failProtection = false, failDestroy = false, platform = "darwin" } = {}) {
  const source = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const functions = ['cleanupFailedMainWindow', 'createWindow', 'createWindowVisibility', 'applyNativeShowMainWindow', 'applyNativeHideMainWindow', 'showMainWindow', 'revealMainWindow', 'getMainWindow'];
  const selected = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) && functions.includes(node.name?.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === 'mainWindowAwaitingCleanup')
  ).map(node => node.getText(ast)).join('\n');
  const code = ts.transpileModule(`${selected}\n${functions.filter(name => name !== 'cleanupFailedMainWindow').map(name => `exports.${name} = ${name};`).join('\n')}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [], windows = [], errors = [], exports = {};
  let protectionFails = failProtection, destroyFails = failDestroy;
  const state = { mainWindow: null, liveWorkspace: true, shortcutsHelper: { refreshGlobalShortcuts: () => calls.push(['shortcuts']) } };
  function BrowserWindow(options) {
    assert.equal(options.show, false, 'the native constructor must not expose an unprotected window');
    const f = windowFixture({ failProtection: () => protectionFails, calls });
    let bounds = { x: options.x, y: options.y, width: options.width, height: options.height }, visible = false;
    Object.assign(f.win, {
      getBounds: () => ({ ...bounds }), setBounds: value => { bounds = { ...value }; calls.push(['bounds']); },
      isMinimized: () => false, restore() { calls.push(['restore']); this.emit('restore'); },
      focus() { calls.push(['focus']); this.emit('focus'); },
      showInactive() { visible = true; calls.push(['showInactive']); this.emit('show'); },
      destroy() {
        calls.push(['destroy']);
        if (destroyFails) throw new Error('fixture native destruction failed');
        visible = false; f.destroy(); this.emit('closed');
      },
      loadFile() { assert.equal(visible, false); assert.deepEqual(calls.at(-1), ['protection', true]); calls.push(['loadFile']); return Promise.resolve(); },
      loadURL() { assert.equal(visible, false); assert.deepEqual(calls.at(-1), ['protection', true]); calls.push(['loadURL']); return Promise.resolve(); },
    });
    // Native APIs are inert here; actual first-show ordering comes from main.ts.
    for (const name of ['setSkipTaskbar', 'setVisibleOnAllWorkspaces', 'setWindowButtonVisibility', 'setAlwaysOnTop', 'moveTop', 'setHiddenInMissionControl', 'setBackgroundColor', 'setHasShadow']) f.win[name] = () => { if (platform === 'win32' && ['setWindowButtonVisibility', 'setHiddenInMissionControl'].includes(name)) assert.fail(`macOS-only presentation API called on Windows: ${name}`); };
    f.win.webContents = Object.assign(new EventEmitter(), {
      setZoomFactor() {}, setWindowOpenHandler() {}, setBackgroundThrottling() {}, setFrameRate() {},
      send: (...args) => calls.push(['send', ...args]),
    });
    windows.push({ ...f, options, visible: () => visible }); calls.push(['construct-hidden']);
    return f.win;
  }
  const context = {
    exports, state, BrowserWindow, WindowCaptureProtection, WindowVisibilityController, process: { platform }, isDev: false, __dirname: '/fixture',
    path: { join: (...parts) => parts.join('/') },
    app: { dock: { hide() { assert.equal(platform, 'darwin', 'Windows has no macOS Dock'); } } }, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }) },
    console: { log() {}, error: (...args) => errors.push(args) }, createCaptureCloseGuard: () => () => {},
    isAuthWindow: () => false,
    handleWindowMove() {}, handleWindowResize() {}, handleWindowClosed() {},
    applyWorkspaceWindow: () => calls.push(['workspace']),
    overlayWindow: { isLive: () => true, restoreMousePolicy() {}, publishGeometry() {}, setInteractive() {} },
  };
  vm.runInNewContext(code, context);
  return { calls, windows, errors, state, ...exports, get win() { return windows.at(-1)?.win; }, visible: () => windows.some(item => item.visible()), setProtectionFailure: value => { protectionFails = value; }, setDestroyFailure: value => { destroyFails = value; } };
}

test('actual main window producer installs capture exclusion before loading UI and first shows through the shared path', async () => {
  const f = mainWindowFixture();
  await f.createWindow();
  assert.deepEqual(f.calls.slice(0, 3), [['construct-hidden'], ['protection', true], ['loadFile']]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'protection'), [['protection', true], ['protection', true]], 'initial request plus the actual show event share one policy owner');
  assert.equal(f.visible(), true); assert.equal(f.state.windowVisibility.isRequestedVisible(), true);
  assert.equal(f.calls.some(call => call[0] === 'focus'), false, 'initial overlay show does not acquire native keyboard focus');
  assert.ok(f.calls.some(call => call[0] === 'send' && call[1] === 'overlay-visibility' && call[2] === true));
  f.win.restore(); f.win.focus(); f.showMainWindow();
  assert.equal(f.calls.filter(call => call[0] === 'protection').length, 5, 'restore, focus and subsequent show all reassert through the same owner');
});

test('Windows main producer protects before UI load, passively shows and retains protection on restore/focus without macOS APIs (mock native)', async () => {
  const f = mainWindowFixture({ platform: 'win32' }); await f.createWindow();
  assert.deepEqual(f.calls.slice(0, 3), [['construct-hidden'], ['protection', true], ['loadFile']]);
  const options = f.windows[0].options;
  assert.equal(options.transparent, true); assert.equal(options.frame, false); assert.equal(options.focusable, true);
  assert.equal(options.skipTaskbar, true); assert.equal(f.visible(), true);
  assert.equal(f.calls.some(call => call[0] === 'focus'), false);
  f.win.restore(); f.win.focus(); f.showMainWindow();
  assert.equal(f.calls.filter(call => call[0] === 'protection').length, 5);
  assert.ok(f.calls.filter(call => call[0] === 'protection').every(call => call[1] === true));
});

test('actual producer destroys a failed hidden window before reveal retries a fresh protected native window', async () => {
  const f = mainWindowFixture({ failProtection: true });
  await assert.rejects(f.createWindow(), /fixture protection failed/);
  const failed = f.windows[0].win;
  assert.equal(failed.isDestroyed(), true);
  assert.equal(f.state.mainWindow, null); assert.equal(f.getMainWindow(), null);
  assert.equal(f.visible(), false);
  assert.deepEqual(f.calls, [['construct-hidden'], ['protection', true], ['destroy']]);
  f.showMainWindow(); assert.equal(f.visible(), false, 'show cannot reuse the rejected resource');
  f.setProtectionFailure(false); f.revealMainWindow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.windows.length, 2); assert.notEqual(f.state.mainWindow, failed);
  assert.equal(f.state.mainWindow, f.windows[1].win); assert.equal(f.visible(), true);
  assert.equal(f.errors.length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'loadFile').length, 1, 'only the protected replacement loads UI');
});

test('failed native destruction retains ownership, blocks reveal/recreation, and is retried before any replacement', async () => {
  const f = mainWindowFixture({ failProtection: true, failDestroy: true });
  await assert.rejects(f.createWindow(), /hidden native window is retained/);
  const failed = f.windows[0].win;
  assert.equal(failed.isDestroyed(), false);
  assert.equal(f.state.mainWindow, null); assert.equal(f.getMainWindow(), null); assert.equal(f.visible(), false);
  f.showMainWindow(); assert.equal(f.visible(), false);
  f.revealMainWindow(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.errors.length, 1, 'reveal reports cleanup rejection instead of an unhandled promise');
  assert.equal(f.windows.length, 1, 'cleanup failure must not create a substitute resource');
  await assert.rejects(f.createWindow(), /native destruction failed/);
  assert.equal(f.windows.length, 1); assert.equal(f.calls.filter(call => call[0] === 'destroy').length, 3, 'the same owned native window is retried');
  assert.equal(f.calls.some(call => ['loadFile', 'loadURL', 'showInactive', 'focus'].includes(call[0])), false);
  f.setDestroyFailure(false); f.setProtectionFailure(false);
  await f.createWindow();
  assert.equal(failed.isDestroyed(), true); assert.equal(f.windows.length, 2);
  assert.notEqual(f.state.mainWindow, failed); assert.equal(f.visible(), true);
  assert.equal(f.calls.filter(call => call[0] === 'destroy').length, 4, 'cleanup completes before the replacement constructor');
  assert.equal(f.calls.filter(call => call[0] === 'loadFile').length, 1);
});
