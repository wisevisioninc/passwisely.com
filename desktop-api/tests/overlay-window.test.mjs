import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(relative, electron) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(`../../electron/${relative}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.equal(name, 'electron'); return electron; }, console: { log() {}, error() {} }, process: { platform: 'darwin' } });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  let bounds = { x: 50, y: 90, width: 600, height: 600 };
  let displays = [{ id: 1, workArea: { x: 0, y: 24, width: 1440, height: 876 } }, { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }];
  const calls = [], handlers = new Map(), mainFrame = {};
  const win = {
    isDestroyed: () => false, getBounds: () => ({ ...bounds }),
    setBounds: value => { bounds = { ...value }; calls.push(['bounds', plain(value)]); },
    setMovable: value => calls.push(['movable', value]), setResizable: value => calls.push(['resizable', value]),
    setIgnoreMouseEvents: (value, options) => calls.push(['ignore', value, plain(options)]),
    focus: () => calls.push(['focus']), blur: () => calls.push(['blur']),
    webContents: { mainFrame, send: (...args) => calls.push(['send', ...args]) },
  };
  const electron = { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, screen: { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0], getDisplayMatching: rect => displays.find(display => rect.x >= display.workArea.x && rect.x < display.workArea.x + display.workArea.width) || displays[0] } };
  const { OverlayWindowController, initializeOverlayIpc } = load('live/OverlayWindow.ts', electron);
  const controller = new OverlayWindowController(() => win);
  initializeOverlayIpc(controller, () => win);
  return { controller, calls, handlers, win, bounds: () => bounds, event: { sender: win.webContents, senderFrame: mainFrame }, setDisplays: value => { displays = value; } };
}

test('live native geometry fills target workArea while renderer panels and click regions remain independent', () => {
  const h = harness(); const original = h.bounds();
  h.controller.setLive(true);
  assert.deepEqual(h.bounds(), { x: 0, y: 24, width: 1440, height: 876 });
  assert.deepEqual(h.calls.findLast(call => call[0] === 'ignore'), ['ignore', true, { forward: true }]);
  h.controller.setInteractive(true);
  assert.deepEqual(h.calls.findLast(call => call[0] === 'ignore'), ['ignore', false, { forward: true }]);
  h.controller.setInteractive(false);
  assert.deepEqual(h.calls.findLast(call => call[0] === 'ignore'), ['ignore', true, { forward: true }]);
  assert.deepEqual(h.bounds(), { x: 0, y: 24, width: 1440, height: 876 });
  h.controller.setLive(false);
  assert.deepEqual(h.bounds(), original);
  assert.deepEqual(h.calls.findLast(call => call[0] === 'ignore'), ['ignore', false, { forward: true }]);
});

test('overlay IPC rejects iframe, foreign renderer and malformed controls before window mutation', () => {
  const h = harness(); h.controller.setLive(true); const before = h.calls.length;
  for (const channel of ['overlay-set-interactive', 'overlay-set-focus']) {
    const handler = h.handlers.get(channel);
    assert.throws(() => handler({ sender: {}, senderFrame: h.win.webContents.mainFrame }, true), /Untrusted/);
    assert.throws(() => handler({ sender: h.win.webContents, senderFrame: {} }, true), /Untrusted/);
    assert.throws(() => handler(h.event, 'true'), /Invalid/);
  }
  assert.equal(h.calls.length, before);
  h.handlers.get('overlay-set-focus')(h.event, true);
  assert.deepEqual(h.calls.at(-1), ['focus']);
  h.handlers.get('overlay-set-focus')(h.event, false);
  assert.deepEqual(h.calls.at(-1), ['blur']);
  assert.throws(() => h.handlers.get('overlay-get-geometry')({ sender: h.win.webContents, senderFrame: {} }), /Untrusted/);
  assert.throws(() => h.handlers.get('overlay-get-geometry')({ sender: {}, senderFrame: h.win.webContents.mainFrame }), /Untrusted/);
});

test('geometry query plus event handshake never publishes the initial 600px Auth viewport', () => {
  const h = harness();
  assert.equal(h.handlers.get('overlay-get-geometry')(h.event), null);
  h.controller.setLive(true);
  assert.deepEqual(plain(h.controller.getGeometry()), { displayId: 1, width: 1440, height: 876 });
  const events = h.calls.filter(call => call[0] === 'send' && call[1] === 'overlay-geometry');
  assert.equal(events.length, 1);
  assert.deepEqual(plain(events[0][2]), { displayId: 1, width: 1440, height: 876 });
  // A subscriber attached after the initial event can recover the exact same
  // authoritative snapshot by query; no reliance on window.innerWidth.
  assert.deepEqual(plain(h.handlers.get('overlay-get-geometry')(h.event)), plain(events[0][2]));
  h.controller.setLive(false);
  assert.equal(h.controller.getGeometry(), null);
});

test('asynchronous native setBounds remains unready until actual bounds land and resize publishes them', () => {
  const h = harness();
  const setBounds = h.win.setBounds;
  let pending;
  h.win.setBounds = value => { pending = value; };
  h.controller.setLive(true);
  assert.equal(h.bounds().width, 600);
  assert.equal(h.controller.getGeometry(), null);
  assert.ok(!h.calls.some(call => call[0] === 'send' && call[1] === 'overlay-geometry'));
  setBounds(pending);
  h.controller.publishGeometry();
  assert.deepEqual(plain(h.calls.at(-1)), ['send', 'overlay-geometry', { displayId: 1, width: 1440, height: 876 }]);
  const count = h.calls.length;
  h.controller.publishGeometry();
  assert.equal(h.calls.length, count, 'ordinary duplicate native events do not republish');
  h.controller.publishGeometry(true);
  assert.equal(h.calls.length, count + 1, 'show can force a fresh snapshot');
});

test('a replacement display with the same dimensions retains distinct authoritative geometry identity', () => {
  const h = harness(); h.controller.setLive(true);
  h.setDisplays([{ id: 3, workArea: { x: 0, y: 24, width: 1440, height: 876 } }]);
  h.controller.refreshDisplay();
  assert.deepEqual(plain(h.controller.getGeometry()), { displayId: 3, width: 1440, height: 876 });
  assert.deepEqual(plain(h.calls.at(-1)), ['send', 'overlay-geometry', { displayId: 3, width: 1440, height: 876 }]);
});

test('display removal returns full overlay to primary and recenters renderer without a polling loop', () => {
  const h = harness();
  h.win.setBounds({ x: -1500, y: 100, width: 600, height: 600 });
  h.controller.setLive(true);
  assert.equal(h.controller.getDisplay().id, 2);
  assert.equal(h.bounds().x, -1920);
  h.setDisplays([{ id: 1, workArea: { x: 0, y: 24, width: 1280, height: 776 } }]);
  h.controller.refreshDisplay();
  assert.deepEqual(h.bounds(), { x: 0, y: 24, width: 1280, height: 776 });
  assert.ok(h.calls.some(call => call[0] === 'send' && call[1] === 'overlay-recenter'));
  assert.deepEqual(plain(h.controller.getGeometry()), { displayId: 1, width: 1280, height: 776 });
  h.controller.setLive(false);
  assert.ok(h.bounds().x >= 0);
  assert.ok(h.bounds().y >= 24);
});

test('non-live controls cannot make the login container click-through and new windows reset leases', () => {
  const h = harness();
  h.controller.setInteractive(false);
  assert.deepEqual(h.calls.findLast(call => call[0] === 'ignore'), ['ignore', false, { forward: true }]);
  h.controller.setLive(true); h.controller.setInteractive(true); h.controller.reset();
  h.controller.setLive(true);
  assert.deepEqual(h.calls.findLast(call => call[0] === 'ignore'), ['ignore', true, { forward: true }]);
});

test('actual main resize and move entrypoints cannot shrink or displace the live native overlay', () => {
  const source = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['setWindowDimensions', 'moveWindowHorizontal', 'moveWindowVertical'];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
  const calls = [], actions = [], exports = {};
  const win = { isDestroyed: () => false, setBounds: value => calls.push(plain(value)), setPosition: (...args) => calls.push(args) };
  const code = ts.transpileModule(`${functions}\nexports.resize=setWindowDimensions;exports.moveX=moveWindowHorizontal;exports.moveY=moveWindowVertical;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, state: { mainWindow: win }, overlayWindow: { isLive: () => true }, isAuthWindow: () => false, sendLiveShortcut: action => actions.push(action) });
  exports.resize(300, 80); exports.moveX(x => x - 60); exports.moveY(y => y + 60);
  assert.deepEqual(calls, []);
  assert.deepEqual(actions, ['move-left', 'move-down']);
});

test('actual activate and second-instance entrypoints reveal hidden windows and focus only Auth', () => {
  const source = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter(node => {
    if (ts.isFunctionDeclaration(node)) return ['showMainWindow', 'revealMainWindow'].includes(node.name?.text);
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    return call.expression.getText(ast) === 'app.on' && ts.isStringLiteral(call.arguments[0]) && ['activate', 'second-instance'].includes(call.arguments[0].text);
  }).map(node => node.getText(ast)).join('\n');
  const code = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const name of ['activate', 'second-instance']) {
    for (const auth of [false, true]) {
      for (const initiallyMinimized of [false, true]) {
        const handlers = new Map(), calls = [];
        let minimized = initiallyMinimized, visible = false, destroyed = false;
        const win = { isDestroyed: () => destroyed, isMinimized: () => minimized,
          restore: () => { minimized = false; calls.push('restore'); },
          showInactive: () => { visible = true; calls.push('showInactive'); }, focus: () => calls.push('focus'),
          setVisibleOnAllWorkspaces() {}, setContentProtection() {},
          webContents: { send: (...args) => calls.push(args) },
        };
        const state = { mainWindow: win, isWindowVisible: false, shortcutsHelper: { refreshGlobalShortcuts: () => calls.push('shortcuts') } };
        vm.runInNewContext(code, { state, console: { log() {} }, PROTOCOL: 'passwisely', handleAuthCallback() {},
          app: { on: (event, callback) => handlers.set(event, callback) }, isAuthWindow: () => auth,
          overlayWindow: { isLive: () => !auth, restoreMousePolicy: () => calls.push('mouse-policy'), publishGeometry: () => calls.push('geometry') },
          createWindow: () => calls.push('create'), handleWindowClosed: () => { state.mainWindow = null; calls.push('release-destroyed-window'); },
        });
        const activate = () => name === 'second-instance' ? handlers.get(name)({}, []) : handlers.get(name)();
        activate();
        assert.equal(visible, true, `${name} must reveal a hidden ${auth ? 'Auth' : 'Live'} window`);
        assert.equal(state.isWindowVisible, true);
        assert.equal(minimized, false);
        assert.equal(calls.includes('restore'), initiallyMinimized);
        assert.equal(calls.includes('focus'), auth);
        assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'overlay-visibility' && call[1] === true));
        assert.ok(calls.includes('mouse-policy') && calls.includes('shortcuts'));
        state.mainWindow = null; activate();
        assert.equal(calls.filter(call => call === 'create').length, 1);
        state.mainWindow = win; destroyed = true; activate();
        assert.equal(calls.filter(call => call === 'create').length, 2);
        assert.ok(calls.includes('release-destroyed-window'));
      }
    }
  }
});

test('preload overlay and screenshot subscriptions release exactly their own listeners', () => {
  const listeners = new Map(), invocations = [], exposed = {};
  const ipcRenderer = {
    on: (channel, callback) => listeners.set(channel, callback),
    removeListener: (channel, callback) => { assert.equal(listeners.get(channel), callback); listeners.delete(channel); },
    invoke: async (...args) => { invocations.push(args); },
  };
  load('preload.ts', { ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } });
  const api = exposed.electronAPI, received = [];
  void api.getOverlayGeometry();
  assert.deepEqual(invocations.at(-1), ['overlay-get-geometry']);
  const removeAction = api.onLiveShortcut(value => received.push(value));
  const removeRecenter = api.onOverlayRecenter(() => received.push('recenter'));
  const removeQueue = api.onScreenshotQueueChanged(() => received.push('queue'));
  const removeVisibility = api.onOverlayVisibilityChanged(value => received.push(value));
  const removeError = api.onScreenshotError(value => received.push(value));
  const removeGeometry = api.onOverlayGeometryChanged(value => received.push(value));
  listeners.get('live-shortcut')({}, 'response'); listeners.get('overlay-recenter')(); listeners.get('screenshots-changed')();
  listeners.get('overlay-visibility')({}, true); listeners.get('screenshot-error')({}, 'Screen permission denied');
  listeners.get('overlay-geometry')({}, { displayId: 1, width: 1440, height: 876 });
  assert.deepEqual(received, ['response', 'recenter', 'queue', true, 'Screen permission denied', { displayId: 1, width: 1440, height: 876 }]);
  removeAction(); removeRecenter(); removeQueue(); removeVisibility(); removeError(); removeGeometry();
  assert.ok(!listeners.has('live-shortcut') && !listeners.has('overlay-recenter') && !listeners.has('screenshots-changed'));
});

function shortcutsHarness() {
  const registered = new Map(), events = [], calls = [];
  let live = true, enabled = true, visible = true, clearResult = { success: true }, captureFails = false;
  const deps = { isLiveWorkspace: () => live, canUseShortcuts: () => enabled,
    isVisible: () => visible,
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (...args) => events.push(args) } }),
    takeScreenshot: async () => { calls.push('capture'); if (captureFails) throw new Error('Screen permission denied'); return '/fixture.png'; }, getImagePreview: async () => 'fixture-preview',
    processingHelper: { processScreenshots: () => calls.push('solve'), cancelOngoingRequests: () => calls.push('cancel') },
    toggleMainWindow: () => calls.push('toggle-native'), clearQueues: async () => { calls.push('clear-screenshots'); return await clearResult; }, setView: () => calls.push('queue'),
    moveWindowLeft: () => calls.push('native-left'), moveWindowRight() {}, moveWindowUp() {}, moveWindowDown() {},
  };
  const { ShortcutsHelper } = load('shortcuts.ts', { globalShortcut: { register: (key, callback) => { registered.set(key, callback); return true; }, unregister: key => registered.delete(key), unregisterAll() { registered.clear(); } }, app: { on() {} } });
  const helper = new ShortcutsHelper(deps); helper.registerGlobalShortcuts();
  return { registered, events, calls, setLive: value => { live = value; helper.refreshGlobalShortcuts(); }, setEnabled: value => { enabled = value; helper.refreshGlobalShortcuts(); }, setVisible: value => { visible = value; helper.refreshGlobalShortcuts(); }, setClear: value => { clearResult = value; }, failCapture: () => { captureFails = true; } };
}

test('SC shortcut map routes live actions without native geometry or programming work', async () => {
  const h = shortcutsHarness();
  for (const [key, action] of [['CommandOrControl+Enter', 'ask'], ['Alt+1', 'response'], ['Alt+2', 'transcripts'], ['CommandOrControl+Shift+\\', 'toggle-session'], ['CommandOrControl+Left', 'move-left'], ['CommandOrControl+Shift+Up', 'scroll-up']]) {
    h.registered.get(key)(); assert.deepEqual(h.events.at(-1), ['live-shortcut', action]);
  }
  assert.deepEqual(h.calls, []);
  h.registered.get('CommandOrControl+B')();
  assert.deepEqual(h.calls, ['toggle-native']);
  await h.registered.get('CommandOrControl+H')();
  assert.deepEqual(plain(h.events.at(-1)), ['screenshot-taken', { path: '/fixture.png', preview: 'fixture-preview' }]);
});

test('clear shortcut requests the same renderer operation as its button without a second main pre-call', () => {
  const h = shortcutsHarness();
  h.registered.get('CommandOrControl+G')();
  assert.deepEqual(h.events, [['live-shortcut', 'clear']]);
  assert.deepEqual(h.calls, []);
});

test('screenshot hotkey failures use their own visible error channel rather than programming errors', async () => {
  const h = shortcutsHarness(); h.failCapture();
  await h.registered.get('CommandOrControl+H')();
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'screenshot-error');
  assert.equal(typeof h.events[0][1], 'string');
});

test('hidden overlay retains only restore and session shortcuts, and restores visible bindings without polling', () => {
  const h = shortcutsHarness(); h.setVisible(false);
  assert.deepEqual([...h.registered.keys()].sort(), ['CommandOrControl+B', 'CommandOrControl+Shift+\\']);
  h.registered.get('CommandOrControl+B')();
  assert.deepEqual(h.calls, ['toggle-native']);
  h.setVisible(true);
  assert.ok(h.registered.has('CommandOrControl+H') && h.registered.has('Alt+1'));
});

test('programming reset waits for recoverable screenshot cleanup before clearing the old view', async () => {
  const h = shortcutsHarness(); h.setLive(false); let finish;
  h.setClear(new Promise(resolve => { finish = resolve; }));
  const pending = h.registered.get('CommandOrControl+R')();
  assert.deepEqual(h.calls, ['cancel', 'clear-screenshots']);
  assert.deepEqual(h.events, []);
  finish({ success: false, error: 'Trash unavailable' }); await pending;
  assert.ok(!h.calls.includes('queue'));
  assert.ok(!h.events.some(event => event[0] === 'reset-view'));
  assert.equal(h.events.at(-1)[0], 'solution-error');
  h.setClear({ success: true });
  await h.registered.get('CommandOrControl+R')();
  assert.ok(h.calls.includes('queue'));
  assert.ok(h.events.some(event => event[0] === 'reset-view'));
});

test('programming keeps its established controls while auth never captures or mutates sessions through shortcuts', async () => {
  const h = shortcutsHarness(); h.setLive(false);
  h.registered.get('CommandOrControl+Enter')(); h.registered.get('CommandOrControl+Left')();
  assert.deepEqual(h.calls, ['solve', 'native-left']);
  const lateCapture = h.registered.get('CommandOrControl+H');
  h.setEnabled(false);
  assert.equal(h.registered.size, 0);
  await lateCapture();
  assert.deepEqual(h.calls, ['solve', 'native-left']);
});
