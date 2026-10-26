import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const website = new URL("../", import.meta.url);
const downloadManifest = JSON.parse(readFileSync(new URL("lib/download-artifacts.json", website), "utf8"));
const noop = () => {};
const cleanups = new WeakMap();
const user = (id = "account-a", credits = 220) => ({ id, email: `${id}@example.invalid`, locale: "en", credits,
  creditBalance: { balance: credits, permanentBalance: 20, expiringBalance: credits - 20, nextExpiry: credits > 20 ? "2026-11-19T09:00:00Z" : null } });
const zero = { recordedRequests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, creditsDebited: 0, creditsRefunded: 0, netCreditsUsed: 0 };
function report(days = 30, account = user(), totals = zero) {
  const end = new Date("2026-10-21T13:00:00Z");
  const start = Date.UTC(2026, 9, 21) - (days - 1) * 86400000;
  const daily = Array.from({ length: days }, (_, i) => ({ ...zero, ...(i === days - 1 ? totals : {}), date: new Date(start + i * 86400000).toISOString().slice(0, 10) }));
  return { user: account, period: { days, timeZone: "UTC", from: new Date(start).toISOString(), to: end.toISOString() }, summary: totals, daily,
    recent: { items: [], nextCursor: null }, coverage: { requests: "recorded_events", tokens: "reported_only", credits: "ledger", audioMinutes: false } };
}
function walk(tree, predicate, found = []) {
  if (Array.isArray(tree)) { for (const item of tree) walk(item, predicate, found); return found; }
  if (!tree || typeof tree !== "object") return found;
  if (predicate(tree)) found.push(tree);
  walk(tree.props?.children, predicate, found); return found;
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree);
}
const element = (tree, name) => { const value = walk(tree, e => e.type?.name === name)[0]; assert.ok(value, `Missing ${name}`); return value; };
const button = (tree, label) => { const value = walk(tree, e => e.type === "button" && text(e).trim() === label)[0]; assert.ok(value, `Missing button ${label}`); return value; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

// Browser and hooks are the seams. The real page, parent auth/navigation,
// Dashboard controller, catalog and download normalizer execute from source.
// Separate hook frames preserve component state and effect/abort ownership.
function application(t, siteProps = {}, artifactManifest = downloadManifest) {
  const frames = new Map(); let frame; const effects = [];
  const slot = () => { const index = frame.index++; return [frame, index]; };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const [owner, index] = slot(); if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
      return [owner.slots[index], value => { owner.slots[index] = typeof value === "function" ? value(owner.slots[index]) : value; }]; },
    useRef(initial) { const [owner, index] = slot(); return owner.slots[index] ||= { current: initial }; },
    useMemo(callback, deps) { const [owner, index] = slot(); const previous = owner.slots[index]; if (!previous || !same(previous.deps, deps)) owner.slots[index] = { deps, value: callback() }; return owner.slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const [owner, index] = slot(); const previous = owner.slots[index]; if (!previous || !same(previous.deps, deps)) effects.push(() => { previous?.cleanup?.(); owner.slots[index] = { deps, cleanup: callback() }; }); },
    useId() { return hooks.useRef(`fixture-${frames.size}-${frame.index}`).current; },
  };
  const load = createProductionTsLoader({ mocks: { react: hooks, "./download-artifacts.json": artifactManifest } });
  const { PassWiselySite } = load(fileURLToPath(new URL("app/PassWiselySite.tsx", website)));
  const { Dashboard } = load(fileURLToPath(new URL("app/dashboard/Dashboard.tsx", website)));
  function render(Component, props, key) {
    frame = frames.get(key) || { index: 0, slots: [] }; frame.index = 0; frames.set(key, frame);
    try { return Component(props); } finally { frame = undefined; }
  }
  const app = {
    artifacts: load(fileURLToPath(new URL("lib/downloads.ts", website))).DOWNLOAD_ARTIFACTS,
    render() { const root = render(PassWiselySite, siteProps, "site"); const dashboard = walk(root, e => e.type === Dashboard)[0]; return dashboard ? [root, render(Dashboard, dashboard.props, "dashboard")] : root; },
    dashboard(props) { return render(Dashboard, props, "standalone-dashboard"); },
    page() { return load(fileURLToPath(new URL("app/dashboard/page.tsx", website))); },
    flushEffects() { const batch = effects.splice(0); for (const effect of batch) effect(); },
    cleanup() { for (const owner of frames.values()) for (const effect of owner.slots) effect?.cleanup?.(); },
  };
  cleanups.get(t).push(app.cleanup); return app;
}
function browser(t, { search = "", hash = "", pathname = "/" } = {}) {
  const listeners = new Map(), assigned = [], replaced = [];
  const originals = []; cleanups.set(t, []);
  const values = {
    window: { location: { search, hash, pathname, assign: value => assigned.push(value), replace: value => replaced.push(value), reload: noop },
      history: { replaceState: noop }, addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); }, setInterval: () => 1, clearInterval: noop },
    document: { documentElement: {}, querySelector: () => null, body: { style: {} }, addEventListener: noop, removeEventListener: noop, activeElement: null },
    navigator: { language: "en" }, localStorage: { getItem: () => "en", setItem: noop },
    FormData: class { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } },
  };
  for (const [key, value] of Object.entries(values)) { const previous = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    originals.push([key, previous]); }
  t.after(() => { for (const cleanup of cleanups.get(t)) cleanup(); for (const [key, previous] of originals) { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; } });
  return { assigned, replaced, dispatch(name) { for (const callback of [...(listeners.get(name) || [])]) callback(); } };
}
const submit = async tree => { const form = walk(tree, e => e.type === "form")[0]; assert.ok(form); await form.props.onSubmit({ preventDefault: noop, currentTarget: { fields: { email: "account-a@example.invalid", password: "fixture-password-123" } } }); };
async function mounted(app) { app.render(); app.flushEffects(); await settle(); const tree = app.render(); app.flushEffects(); return tree; }

for (const mode of ["login", "register"]) test(`website ${mode} authenticates using cookies then navigates to Dashboard`, async t => {
  const b = browser(t, mode === "login" ? { search: "?login=1" } : {}), calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([url, init]); return url === "/api/account" ? Response.json({}, { status: 401 }) : Response.json({ user: user() }); });
  const app = application(t); let tree = await mounted(app);
  if (mode === "register") { element(tree, "LandingPage").props.onRegisterTrial(); tree = app.render(); }
  assert.equal(walk(tree, e => e.props?.role === "dialog")[0].props["aria-label"], mode === "login" ? "Sign in to PassWisely" : "Create your account");
  await submit(tree); await settle(); tree = app.render();
  const request = calls.find(([url]) => url === `/api/auth/${mode}`); assert.ok(request);
  assert.equal(request[1].method, "POST"); assert.equal(request[1].credentials, "include");
  assert.deepEqual(JSON.parse(request[1].body), { email: "account-a@example.invalid", password: "fixture-password-123", locale: "en" });
  assert.deepEqual(b.assigned, ["/dashboard"]); assert.deepEqual(b.replaced, []);
  assert.equal(walk(tree, e => e.props?.role === "dialog").length, 0);
  assert.ok(!calls.some(([url]) => url === "/api/account/usage" || url === "/api/checkout"));
});

test("failed sign-in stays on the form and the next successful submission can navigate", async t => {
  const b = browser(t, { search: "?login=1" }); let denied = true;
  t.mock.method(globalThis, "fetch", async url => url === "/api/account" ? Response.json({}, { status: 401 }) : denied ? Response.json({ error: "Password is incorrect." }, { status: 401 }) : Response.json({ user: user() }));
  const app = application(t); let tree = await mounted(app); await submit(tree); tree = app.render();
  assert.match(text(tree), /Password is incorrect/); assert.deepEqual(b.assigned, []); assert.equal(walk(tree, e => e.type === "form").length, 1);
  assert.equal(button(tree, "Sign in").props.disabled, false);
  denied = false; await submit(tree); assert.deepEqual(b.assigned, ["/dashboard"]);
});

test("signed-in homepage account and trial actions both navigate without a checkout", async t => {
  const b = browser(t), calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([url, init]); return Response.json({ user: user(), transactions: [] }); });
  const app = application(t), tree = await mounted(app), landing = element(tree, "LandingPage");
  assert.equal(landing.props.accountLabel, "220 · Dashboard"); landing.props.onAccount(); landing.props.onRegisterTrial();
  assert.deepEqual(b.assigned, ["/dashboard", "/dashboard"]); assert.equal(calls.length, 1); assert.equal(calls[0][0], "/api/account");
});

test("Dashboard page is a public noindex shell; it fetches one combined authenticated API", async t => {
  browser(t, { pathname: "/dashboard" }); const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([url, init]); return Response.json(report()); });
  const app = application(t, { initialDashboard: true }), page = app.page();
  assert.deepEqual(page.metadata.robots, { index: false, follow: false }); assert.equal(page.default().props.initialDashboard, true); assert.equal(calls.length, 0);
  let tree = await mounted(app); assert.equal(calls.length, 1); assert.equal(calls[0][0], "/api/account/usage?days=30");
  assert.equal(calls[0][1].cache, "no-store"); assert.equal(calls[0][1].credentials, "same-origin"); assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.match(text(tree), /account-a@example.invalid/); assert.match(text(tree), /No AI requests recorded in this period/);
  const callbacks = element(tree, "Dashboard").props; tree = app.render(); app.flushEffects(); await settle();
  assert.equal(element(tree, "Dashboard").props.onUser, callbacks.onUser); assert.equal(element(tree, "Dashboard").props.onUnauthorized, callbacks.onUnauthorized); assert.equal(calls.length, 1);
});

for (const status of [401, 503]) test(`Dashboard ${status} distinguishes an expired session from unknown usage`, async t => {
  const b = browser(t, { pathname: "/dashboard" }), calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([url, init]); return Response.json({ error: "Unavailable" }, { status }); });
  const app = application(t, { initialDashboard: true }), tree = await mounted(app);
  assert.equal(calls.length, 1); assert.deepEqual(b.replaced, status === 401 ? ["/?login=1"] : []); assert.deepEqual(b.assigned, []);
  if (status === 503) { assert.match(text(tree), /Your usage could not be loaded/); assert.match(text(tree), /not zeroed by this error/); }
  assert.equal(walk(tree, e => e.props?.className === "pd-metric").length, 0);
});

for (const result of ["return", "success"]) test(`payment=${result} returns to Dashboard without treating the URL as proof of payment`, async t => {
  const b = browser(t, { search: `?payment=${result}` }); t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 401 }));
  const app = application(t); const tree = await mounted(app);
  assert.deepEqual(b.replaced, ["/dashboard?payment=return"]); assert.doesNotMatch(text(tree), /Payment received|支付成功/);
});

test("password recovery takes precedence over Dashboard/payment navigation", async t => {
  const b = browser(t, { search: "?payment=success&login=1", hash: "#access_token=fixture-recovery-token&type=recovery" });
  t.mock.method(globalThis, "fetch", async () => Response.json({ user: user(), transactions: [] }));
  const app = application(t), tree = await mounted(app);
  assert.equal(walk(tree, e => e.props?.role === "dialog")[0].props["aria-label"], "Choose a new password");
  assert.deepEqual(b.assigned, []); assert.deepEqual(b.replaced, []);
});

test("range changes abort and ignore late data and late unauthorized responses", async t => {
  const b = browser(t, { pathname: "/dashboard" }); const initial = deferred(), calls = [];
  t.mock.method(globalThis, "fetch", (url, init) => { calls.push([url, init]); return url.endsWith("days=30") ? initial.promise : Promise.resolve(Response.json(report(7, user("new-window")))); });
  const app = application(t, { initialDashboard: true }); let tree = await mounted(app);
  button(tree, "7 days").props.onClick(); tree = app.render(); app.flushEffects(); await settle(); tree = app.render();
  assert.equal(calls.length, 2); assert.equal(calls[0][1].signal.aborted, true); assert.match(text(tree), /new-window@example.invalid/);
  initial.resolve(Response.json({}, { status: 401 })); await settle(); tree = app.render();
  assert.deepEqual(b.replaced, []); assert.match(text(tree), /new-window@example.invalid/);
  assert.equal(element(tree, "Dashboard").props.locale, "en");
});

test("failed Dashboard logout retains the signed-in state; retry exits and ignores late user callbacks", async t => {
  const b = browser(t, { pathname: "/dashboard" }); let fail = true;
  t.mock.method(globalThis, "fetch", async url => url === "/api/auth/logout" ? Response.json({}, { status: fail ? 503 : 200 }) : Response.json(report()));
  const app = application(t, { initialDashboard: true }); let tree = await mounted(app);
  button(tree, "Sign out").props.onClick(); await settle(); tree = app.render();
  // Failed logout now refreshes through the same usage owner. Complete that
  // effect before checking the recovered account; the original assertions stay.
  app.flushEffects(); await settle(); tree = app.render();
  assert.deepEqual(b.replaced, []); assert.match(text(tree), /Could not sign out/); assert.match(text(tree), /account-a@example.invalid/);
  assert.equal(button(tree, "Sign out").props.disabled, false);
  fail = false; button(tree, "Sign out").props.onClick(); await settle(); tree = app.render(); assert.deepEqual(b.replaced, ["/"]);
  const dashboard = element(tree, "Dashboard"); dashboard.props.onUser(user("late-user")); tree = app.render();
  element(tree, "Dashboard").props.onBuy("pro_monthly_v2"); tree = app.render();
  assert.equal(walk(tree, e => e.props?.role === "dialog")[0].props["aria-label"], "Create your account");
  assert.equal(walk(tree, e => e.props?.className === "modal payment-modal").length, 0);
});

test("Dashboard focus refresh uses its usage owner and updates an open account modal after expiry", async t => {
  const b = browser(t, { pathname: "/dashboard" }), calls = []; let account = user();
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([url, init]); return Response.json(url === "/api/account" ? { user: account, transactions: [] } : report(30, account)); });
  const app = application(t, { initialDashboard: true }); let tree = await mounted(app);
  element(tree, "Dashboard").props.onAccount(); tree = app.render(); app.flushEffects(); await settle(); tree = app.render(); app.flushEffects(); await settle(); tree = app.render(); app.flushEffects();
  assert.match(text(tree), /Permanent credits :\s+20/); assert.match(text(tree), /Active monthly-pack credits :\s+200/); assert.match(text(tree), /Next pack expiry/);
  const accountCalls = calls.filter(([url]) => url === "/api/account").length; assert.equal(accountCalls, 1);
  account = user("account-a", 20); b.dispatch("focus"); app.render(); app.flushEffects(); await settle(); tree = app.render(); app.flushEffects();
  assert.match(text(tree), /Active monthly-pack credits :\s+0/); assert.doesNotMatch(text(tree), /Next pack expiry/);
  assert.equal(calls.filter(([url]) => url === "/api/account").length, accountCalls);
  assert.equal(calls.at(-1)[0], "/api/account/usage?days=30"); assert.ok(calls.every(([,init]) => init.cache === "no-store"));
});

for (const status of [200, 401]) test(`late focus refresh ${status} cannot restore a Dashboard session or redirect after logout`, async t => {
  const b = browser(t, { pathname: "/dashboard" }), focused = deferred(); let reads = 0;
  t.mock.method(globalThis, "fetch", async url => url === "/api/auth/logout" ? Response.json({ success: true }) : ++reads === 1 ? Response.json(report()) : focused.promise);
  const app = application(t, { initialDashboard: true }); let tree = await mounted(app);
  b.dispatch("focus"); tree = app.render(); app.flushEffects(); assert.equal(reads, 2);
  button(tree, "Sign out").props.onClick(); await settle(); tree = app.render(); app.flushEffects(); assert.deepEqual(b.replaced, ["/"]);
  focused.resolve(status === 200 ? Response.json(report(30, user("late-focus"))) : Response.json({}, { status: 401 })); await settle(); tree = app.render();
  assert.deepEqual(b.replaced, ["/"]);
  element(tree, "Dashboard").props.onBuy("pro_monthly_v2"); tree = app.render();
  assert.equal(walk(tree, e => e.props?.role === "dialog")[0].props["aria-label"], "Create your account");
});


for (const locale of ["zh", "en"]) test(`real ${locale} Dashboard offers all three manifest packages with exact versions and limitations`, t => {
  browser(t);
  const app = application(t);
  const tree = app.dashboard({ locale, onLocale: noop, onAccount: noop, onBuy: noop, onLogout: async () => {}, onUser: noop, onUnauthorized: noop });
  const cards = walk(tree, item => item.props?.className === "pd-download-card");
  assert.equal(cards.length, 3);
  for (const platform of ["mac-arm64", "mac-x64", "windows-x64"]) {
    const artifact = app.artifacts[platform];
    const card = cards.find(item => item.props["data-platform"] === platform);
    assert.ok(card);
    assert.ok(text(card).includes(`v ${artifact.version}`));
    const links = walk(card, item => item.type === "a");
    if (artifact.available) {
      assert.equal(links.length, 1);
      assert.equal(links[0].props.href, `/api/download/${platform}`);
      assert.match(links[0].props["aria-label"], platform === "mac-arm64" ? /macOS Apple silicon/ : platform === "mac-x64" ? /macOS Intel/ : /Windows x64/);
    } else assert.equal(links.length, 0);
    if (artifact.liveAudio === "not_included") assert.match(text(card), locale === "zh" ? /不含实时音频/ : /No live audio/);
    if (artifact.legacy) assert.match(text(card), locale === "zh" ? /旧版/ : /Legacy/);
    else assert.doesNotMatch(text(card), /旧版|legacy/i);
    if (artifact.notice) assert.ok(text(card).includes(artifact.notice[locale]));
  }
});

for (const locale of ["zh", "en"]) test(`real ${locale} Dashboard Intel v2 stays current and pending packages have no links`, t => {
  browser(t);
  const v2 = { ...downloadManifest, artifacts: Object.fromEntries(Object.entries(downloadManifest.artifacts).map(([platform, artifact]) => [platform, {
    ...artifact, version: "2.0.0", legacy: false, sha256: "a".repeat(64), bytes: 1234,
    notice: platform === "mac-x64" ? { zh: "Intel v2 不含实时音频。", en: "Intel v2 has no live audio." } : artifact.notice,
  }])) };
  for (const pendingPlatform of [null, "mac-arm64", "mac-x64", "windows-x64"]) {
    const input = structuredClone(v2);
    if (pendingPlatform) { input.artifacts[pendingPlatform].sha256 = null; input.artifacts[pendingPlatform].bytes = null; }
    const tree = application(t, {}, input).dashboard({ locale, onLocale: noop, onAccount: noop, onBuy: noop, onLogout: async () => {}, onUser: noop, onUnauthorized: noop });
    const cards = walk(tree, item => item.props?.className === "pd-download-card");
    const intel = cards.find(item => item.props["data-platform"] === "mac-x64");
    assert.match(text(intel), /v 2\.0\.0/);
    assert.match(text(intel), locale === "zh" ? /不含实时音频/ : /No live audio/);
    assert.doesNotMatch(text(intel), /旧版|legacy/i);
    assert.ok(text(intel).includes(input.artifacts["mac-x64"].notice[locale]));
    for (const card of cards) {
      const platform = card.props["data-platform"];
      const links = walk(card, item => item.type === "a");
      if (platform === pendingPlatform) {
        assert.equal(links.length, 0);
        assert.match(text(card), locale === "zh" ? /安装包准备中，暂时无法下载/ : /Installer pending; not available yet/);
      } else assert.equal(links[0].props.href, `/api/download/${platform}`);
    }
  }
});
