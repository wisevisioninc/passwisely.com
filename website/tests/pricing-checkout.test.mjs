import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const website = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(website, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function sourceModule(relative, overrides = {}, cache = new Map()) {
  const filename = path.resolve(website, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: filename }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.endsWith(".css")) return {};
    if (name.startsWith(".") || name.startsWith("@/")) {
      const base = name.startsWith("@/") ? path.resolve(website, name.slice(2)) : path.resolve(path.dirname(filename), name);
      let resolved;
      for (const extension of ["", ".ts", ".tsx"]) { try { readFileSync(base + extension); resolved = base + extension; break; } catch {} }
      if (!resolved) throw new Error(`Test cannot resolve production import ${name}`);
      return sourceModule(path.relative(website, resolved), overrides, cache);
    }
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}
function walk(tree, predicate, found = []) {
  if (Array.isArray(tree)) { for (const item of tree) walk(item, predicate, found); return found; }
  if (!tree || typeof tree !== "object") return found;
  if (predicate(tree)) found.push(tree);
  walk(tree.props?.children, predicate, found);
  return found;
}
const text = tree => {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
};
const noop = () => {};
const { CREDIT_PACKS, TRIAL_CREDITS } = sourceModule("lib/payments/catalog.ts");
const { PricingPlans, LandingPage } = sourceModule("app/LandingPage.tsx");
const { DOWNLOAD_ARTIFACTS } = sourceModule("lib/downloads.ts");

for (const locale of ["zh", "en"]) test(`real ${locale} pricing renders 0/99/299, trial20 and exact monthly terms`, () => {
  const html = renderToStaticMarkup(React.createElement(LandingPage, { locale, onLocale: noop, accountLabel: "Account", onAccount: noop, onBuy: noop, onRegisterTrial: noop, busy: false }));
  assert.equal(TRIAL_CREDITS, 20);
  const cards = [...html.matchAll(/<article class="pw-price-card[^]*?<\/article>/g)].map(match => match[0]);
  assert.equal(cards.length, 3);
  assert.match(cards[0], /<strong>0<\/strong>/); assert.match(cards[0], />20<span>/);
  assert.match(cards[0], locale === "zh" ? /无需绑定支付方式/ : /No payment method required/);
  for (const [index, pack] of Object.values(CREDIT_PACKS).entries()) {
    assert.match(cards[index + 1], new RegExp(`<strong>${pack.amountFen / 100}</strong>`));
    assert.ok(cards[index + 1].includes(pack.credits.toLocaleString("en-US")));
    assert.match(cards[index + 1], /30/);
  }
  assert.match(html, locale === "zh" ? /无自动续费/ : /no auto-renewal/);
  assert.match(html, locale === "zh" ? /并非无限额度/ : /not unlimited usage/);
  assert.match(html, locale === "zh" ? /旧余额长期有效/ : /existing permanent balances do not expire/);
  const downloadLinks = [...html.matchAll(/<a class="pw-download"[^]*?<\/a>/g)].map(match => match[0]);
  for (const platform of ["mac-arm64", "windows-x64"]) {
    const artifact = DOWNLOAD_ARTIFACTS[platform];
    const expectedName = `${platform === "windows-x64" ? "Windows x64" : locale === "zh" ? "Mac Apple 芯片" : "Mac Apple silicon"} · v${artifact.version}`;
    const matching = downloadLinks.filter(link => link.replace(/<svg[^]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").includes(expectedName));
    assert.ok(matching.length >= 1, `Download accessible text must include ${expectedName}`);
    for (const link of matching) {
      assert.ok(link.includes(`aria-disabled="${!artifact.available}"`));
      if (artifact.available) assert.ok(link.includes(`href="/api/track-download/${platform}"`));
      else assert.doesNotMatch(link, /href=/);
    }
    if (artifact.notice) assert.ok(html.includes(artifact.notice[locale]));
  }
  assert.doesNotMatch(html, /Starter|轻量包|冲刺包|10 free welcome credits|注册即送 10/);
});

test("real trial action invokes registration only; paid actions retain versioned identities", () => {
  const calls = [];
  const tree = PricingPlans({ locale: "zh", busy: false, onRegisterTrial: () => calls.push("register"), onBuy: id => calls.push(id) });
  const buttons = walk(tree, element => element.type === "button");
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(calls, ["register", "pro_monthly_v2", "unlimited_monthly_v2"]);
  assert.equal(walk(PricingPlans({ locale: "en", busy: true, onRegisterTrial: noop, onBuy: noop }), e => e.type === "button").every(e => e.props.disabled), true);
});

function checkoutApplication({ providerError, notificationError, completionError } = {}) {
  let user = { id: "fixture-user" };
  const rows = [], providerCalls = [], failures = [], completions = [];
  const orders = sourceModule("lib/payments/orders.ts", { "@/lib/supabase": {
    adminRest: async (url, init) => {
      if (url === "purchases") { rows.push(JSON.parse(init.body)); return []; }
      if (init?.method === "PATCH") { failures.push(url); return []; }
      const orderNo = new URLSearchParams(url.split("?")[1]).get("merchant_order_no")?.slice(3);
      return rows.filter(row => row.merchant_order_no === orderNo);
    },
    adminRpc: async (name, args) => {
      completions.push([name, args]);
      if (completionError) throw completionError;
      return "completed";
    },
  } });
  const payment = async (provider, input) => {
    providerCalls.push([provider, input]);
    if (providerError) throw providerError;
    return provider === "alipay" ? { redirectUrl: "https://payment.example.test/alipay" } : { codeUrl: "weixin://fixture-payment" };
  };
  const route = sourceModule("app/api/checkout/route.ts", {
    "cloudflare:workers": { env: {} },
    "@/lib/auth": { getCurrentUser: async () => user, jsonError: (error, status, code) => Response.json({ error, ...(code ? { code } : {}) }, { status }) },
    "@/lib/payments/orders": orders,
    "@/lib/payments/alipay": { createAlipayPagePayment: input => payment("alipay", input) },
    "@/lib/payments/wechat": { createWechatNativePayment: input => payment("wechat", input) },
  });
  // The provider verification seam supplies a verified fixture; checkout,
  // notification routing, order lookup and completion delegation are production.
  const notify = sourceModule("app/api/payments/wechat/notify/route.ts", {
    "@/lib/payments/config": { getWechatPayConfig: () => ({ appId: "fixture-app", mchId: "fixture-merchant" }) },
    "@/lib/payments/orders": orders,
    "@/lib/payments/wechat": { verifyAndDecryptWechatNotification: async body => {
      if (notificationError) throw notificationError;
      return JSON.parse(body);
    } },
  });
  return {
    rows, providerCalls, failures, completions, get: () => route.GET(), setUser(value) { user = value; },
    send: body => route.POST(new Request("https://example.test/api/checkout", { method: "POST", body: JSON.stringify(body) })),
    notifyWechat: (order, amount = order.amount_minor) => notify.POST(new Request("https://example.test/api/payments/wechat/notify", {
      method: "POST", body: JSON.stringify({ trade_state: "SUCCESS", appid: "fixture-app", mchid: "fixture-merchant", out_trade_no: order.merchant_order_no, transaction_id: "fixture-paid-transaction", amount: { total: amount, currency: "CNY" } }),
    })),
  };
}

test("checkout GET returns a complete method rejection without creating an order or payment", async () => {
  const app = checkoutApplication();
  const response = app.get();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(typeof (await response.json()).error, "string");
  assert.equal(app.rows.length, 0);
  assert.equal(app.providerCalls.length, 0);
});

test("checkout rejects retired cached-page IDs and trial/prototype inputs before DB/payment", async () => {
  const app = checkoutApplication();
  for (const packId of ["starter", "pro", "max"]) {
    const response = await app.send({ packId, provider: "alipay" });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, "PRICING_CHANGED");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const body of [null, [], {}, { packId: "trial" }, { packId: "free" }, { packId: "__proto__" }, { packId: "constructor" }, { packId: "toString" }, { packId: "pro_monthly_v2", provider: "stripe" }]) assert.equal((await app.send(body)).status, 400);
  assert.equal(app.rows.length, 0); assert.equal(app.providerCalls.length, 0);
  app.setUser(null);
  assert.equal((await app.send({ packId: "pro_monthly_v2", provider: "alipay" })).status, 401);
});

test("real checkout+order snapshot use owner amounts/credits/expiry for both providers, ignoring forged prices", async () => {
  const app = checkoutApplication();
  for (const [packId, pack] of Object.entries(CREDIT_PACKS)) for (const provider of ["alipay", "wechat"]) {
    const response = await app.send({ packId, provider, amountFen: 1, credits: 999999, validityDays: 999 });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const order = app.rows.at(-1); const [sentProvider, payment] = app.providerCalls.at(-1);
    assert.equal(order.pack_id, packId); assert.equal(order.amount_minor, pack.amountFen); assert.equal(order.credits, pack.credits);
    assert.equal(order.credit_policy, "expiring"); assert.equal(order.validity_days, 30); assert.equal(order.entitlement_version, 2);
    assert.equal(sentProvider, provider); assert.equal(payment.amountFen, pack.amountFen); assert.equal(order.currency, "CNY");
  }
});

test("uncertain provider exceptions preserve the pending order and return a bounded neutral result", async () => {
  for (const provider of ["alipay", "wechat"]) for (const providerError of [new TypeError("fixture network interruption"), new Error("fixture response signature invalid"), new SyntaxError("fixture unreadable provider response")]) {
    const app = checkoutApplication({ providerError });
    const response = await app.send({ packId: "pro_monthly_v2", provider });
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.code, "CHECKOUT_UNCONFIRMED"); assert.equal(payload.orderId, app.rows[0].id);
    assert.match(payload.error, /could not be confirmed/); assert.doesNotMatch(payload.error, /fixture/);
    assert.equal(app.rows[0].status, "pending"); assert.deepEqual(app.failures, []);
    assert.equal(app.providerCalls.length, 1); assert.deepEqual(app.completions, []);
  }
});

test("a later verified WeChat success can reach completion after uncertain checkout, with amount verification intact", async () => {
  const app = checkoutApplication({ providerError: new Error("fixture response signature invalid") });
  assert.equal((await app.send({ packId: "pro_monthly_v2", provider: "wechat" })).status, 503);
  const order = app.rows[0];
  assert.equal((await app.notifyWechat(order, order.amount_minor - 1)).status, 400);
  assert.deepEqual(app.completions, []);
  const response = await app.notifyWechat(order);
  assert.equal(response.status, 200); assert.equal((await response.json()).code, "SUCCESS");
  assert.equal(order.status, "pending"); assert.deepEqual(app.failures, []);
  assert.deepEqual(app.completions, [["complete_purchase", {
    p_purchase_id: order.id, p_transaction_id: "fixture-paid-transaction",
    p_event_id: "wechat:fixture-paid-transaction", p_event_type: "wechat:TRANSACTION.SUCCESS",
  }]]);
});

for (const boundary of ["notification", "completion"]) test(`WeChat callback ${boundary} errors return a fixed failure without internal details`, async () => {
  const internalMessage = `fixture internal ${boundary} diagnostic`;
  const app = checkoutApplication({ [boundary === "notification" ? "notificationError" : "completionError"]: new Error(internalMessage) });
  assert.equal((await app.send({ packId: "pro_monthly_v2", provider: "wechat" })).status, 200);
  const response = await app.notifyWechat(app.rows[0]);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: "FAIL", message: "Callback processing failed." });
  assert.equal(app.completions.length, boundary === "completion" ? 1 : 0);
  assert.deepEqual(app.failures, []);
});

test("historical Stripe callback delegates only order identity to the real transaction owner", async () => {
  const calls = [];
  const backend = { adminRest: async path => { calls.push(["read", path]); return [{ id: "old-starter-order" }]; }, adminRpc: async (name, args) => { calls.push([name, args]); return "completed"; } };
  const orders = sourceModule("lib/payments/orders.ts", { "@/lib/supabase": backend });
  const { POST } = sourceModule("app/api/stripe/webhook/route.ts", {
    "@/lib/stripe": { verifyStripeSignature: async () => true },
    "@/lib/payments/orders": orders, "@/lib/supabase": backend,
  });
  const response = await POST(new Request("https://example.test/api/stripe/webhook", { method: "POST", body: JSON.stringify({ id: "old-event", type: "checkout.session.completed", data: { object: { payment_intent: "old-payment", metadata: { purchaseId: "old-starter-order" } } } }) }));
  assert.equal(response.status, 200);
  assert.match(calls[0][1], /select=id&/);
  assert.deepEqual(calls[1], ["complete_purchase", { p_purchase_id: "old-starter-order", p_transaction_id: "old-payment", p_event_id: "old-event", p_event_type: "checkout.session.completed" }]);
});

function siteHarness(props = {}) {
  const values = [], refs = [], effectSlots = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, pendingEffects = [];
  const hooks = { useState(initial) { const index = stateIndex++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }]; },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; }, useMemo: callback => callback(), useCallback: callback => callback,
    useEffect(callback, deps) { const index = effectIndex++; const previous = effectSlots[index]; if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) pendingEffects.push(() => { previous?.cleanup?.(); effectSlots[index] = { deps, cleanup: callback() }; }); },
  };
  const { PassWiselySite } = sourceModule("app/PassWiselySite.tsx", { react: hooks });
  return { render() { stateIndex = refIndex = effectIndex = 0; return PassWiselySite(props); }, flushEffects() { const batch = pendingEffects; pendingEffects = []; for (const run of batch) run(); }, cleanup() { for (const effect of effectSlots) effect?.cleanup?.(); } };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }
function browser(t, locale = "en") {
  const listeners = new Map(); const assigned = [];
  const fakeWindow = { location: { search: "", hash: "", pathname: "/", assign: value => assigned.push(value), replace: value => assigned.push(value), reload: () => assigned.push("reload") }, history: { replaceState: noop }, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name), setInterval: () => 1, clearInterval: noop };
  for (const [key, value] of Object.entries({ window: fakeWindow, localStorage: { getItem: () => locale, setItem: noop }, navigator: { language: locale }, document: { documentElement: {}, querySelector: () => null, body: { style: {} }, addEventListener: noop, removeEventListener: noop, activeElement: null } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  return { listeners, assigned };
}

test("actual site trial CTA opens registration with20 and never checkout", async t => {
  const app = siteHarness(); const calls = []; t.mock.method(globalThis, "fetch", async (...args) => { calls.push(args); return Response.json({}); });
  const tree = app.render(); walk(tree, e => e.type?.name === "LandingPage")[0].props.onRegisterTrial();
  const next = app.render(); assert.equal(walk(next, e => e.props?.role === "dialog")[0].props["aria-label"], "创建账户");
  assert.match(text(next), /注册并领取 20 积分/); assert.equal(calls.length, 0);
});

test("actual purchase client sends versioned ID and makes pricing-change recovery explicit", async t => {
  const app = siteHarness(); t.after(() => app.cleanup()); const b = browser(t); const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([url, init]); return url === "/api/account" ? Response.json({ user: { id: "fixture-user", email: "fixture@example.test", credits: 20 }, transactions: [] }) : Response.json({ error: "Changed", code: "PRICING_CHANGED" }, { status: 409 }); });
  app.render(); app.flushEffects(); await settle(); let tree = app.render();
  walk(tree, e => e.type?.name === "LandingPage")[0].props.onBuy("unlimited_monthly_v2"); tree = app.render(); app.flushEffects();
  assert.match(text(tree), /1,000 credits per pack/); assert.match(text(tree), /not unlimited credits/);
  walk(tree, e => e.type === "button" && e.props.className === "payment-option alipay")[0].props.onClick(); await settle(); tree = app.render();
  const request = calls.find(([url]) => url === "/api/checkout"); assert.deepEqual(JSON.parse(request[1].body), { packId: "unlimited_monthly_v2", provider: "alipay" });
  assert.match(text(tree), /Refresh to review current prices/); assert.equal(walk(tree, e => e.props?.className === "payment-modal").length, 0); assert.deepEqual(b.assigned, []);
  walk(tree, e => e.type === "button" && text(e) === "Refresh plans")[0].props.onClick({ stopPropagation: noop }); assert.deepEqual(b.assigned, ["reload"]);
});

for (const locale of ["zh", "en"]) test(`actual ${locale} checkout client treats an uncertain result neutrally and preserves the support reference`, async t => {
  const app = siteHarness(); t.after(() => app.cleanup()); const b = browser(t, locale);
  t.mock.method(globalThis, "fetch", async url => url === "/api/account"
    ? Response.json({ user: { id: "fixture-user", email: "fixture@example.test", credits: 20 }, transactions: [] })
    : Response.json({ error: "fixture raw provider exception", code: "CHECKOUT_UNCONFIRMED", orderId: "fixture-pending-order" }, { status: 503 }));
  app.render(); app.flushEffects(); await settle(); let tree = app.render();
  walk(tree, e => e.type?.name === "LandingPage")[0].props.onBuy("pro_monthly_v2"); tree = app.render(); app.flushEffects();
  walk(tree, e => e.type === "button" && e.props.className === "payment-option wechat")[0].props.onClick(); await settle(); tree = app.render();
  const notice = walk(tree, e => e.props?.role === "status")[0];
  assert.match(text(notice), locale === "zh" ? /暂未确认支付发起结果/ : /could not be confirmed/);
  assert.match(text(notice), /fixture-pending-order/); assert.doesNotMatch(text(notice), /raw provider exception|Payment received|支付成功/);
  assert.equal(walk(tree, e => e.props?.className?.split(" ").includes("payment-modal")).length, 0);
  assert.equal(walk(tree, e => e.props?.className?.split(" ").includes("wechat-modal")).length, 0);
  assert.deepEqual(b.assigned, []);
});

test("a lost checkout response does not tell the user to retry a potentially accepted payment", async t => {
  const app = siteHarness(); t.after(() => app.cleanup()); const b = browser(t);
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/account") return Response.json({ user: { id: "fixture-user", email: "fixture@example.test", credits: 20 }, transactions: [] });
    throw new TypeError("fixture transport interrupted after submission");
  });
  app.render(); app.flushEffects(); await settle(); let tree = app.render();
  walk(tree, e => e.type?.name === "LandingPage")[0].props.onBuy("pro_monthly_v2"); tree = app.render(); app.flushEffects();
  walk(tree, e => e.type === "button" && e.props.className === "payment-option wechat")[0].props.onClick(); await settle(); tree = app.render();
  assert.match(text(walk(tree, e => e.props?.role === "status")[0]), /could not be confirmed/);
  assert.doesNotMatch(text(walk(tree, e => e.props?.role === "status")[0]), /try again|interrupted after submission/);
  assert.equal(walk(tree, e => e.props?.className?.split(" ").includes("payment-modal")).length, 0);
  assert.deepEqual(b.assigned, []);
});

test("Dashboard account open and homepage focus read server-owned balances and only nearest expiry", async t => {
  const app = siteHarness({ initialDashboard: true }), home = siteHarness(); t.after(() => { app.cleanup(); home.cleanup(); }); const b = browser(t);
  let balance = { balance: 220, permanentBalance: 20, expiringBalance: 200, nextExpiry: "2026-11-19T09:00:00.000Z" }; const requests = [];
  const account = () => ({ user: { id: "fixture-user", email: "fixture@example.test", credits: balance.balance, creditBalance: balance }, transactions: [] });
  t.mock.method(globalThis, "fetch", async (url, init) => { requests.push([url, init]); return Response.json(account()); });
  home.render(); home.flushEffects(); await settle(); assert.equal(walk(home.render(), e => e.type?.name === "LandingPage")[0].props.accountLabel, "220 · Dashboard");
  let tree = app.render(); app.flushEffects(); await settle(); tree = app.render();
  const dashboard = walk(tree, e => e.type?.name === "Dashboard")[0]; dashboard.props.onUser(account().user); dashboard.props.onAccount();
  tree = app.render(); app.flushEffects(); await settle(); tree = app.render();
  assert.match(text(tree), /Permanent credits :\s+20/); assert.match(text(tree), /Active monthly-pack credits :\s+200/); assert.match(text(tree), /Next pack expiry/);
  balance = { balance: 20, permanentBalance: 20, expiringBalance: 0, nextExpiry: null };
  b.listeners.get("focus")(); await settle(); assert.equal(walk(home.render(), e => e.type?.name === "LandingPage")[0].props.accountLabel, "20 · Dashboard");
  walk(tree, e => e.type === "button" && e.props.className === "modal-close")[0].props.onClick(); app.render(); app.flushEffects();
  walk(app.render(), e => e.type?.name === "Dashboard")[0].props.onAccount(); app.render(); app.flushEffects(); await settle(); tree = app.render();
  assert.match(text(tree), /Active monthly-pack credits :\s+0/); assert.doesNotMatch(text(tree), /Next pack expiry/);
  assert.ok(requests.length >= 4); assert.equal(requests.every(([url, init]) => url === "/api/account" && init.cache === "no-store"), true);
});

test("a pending Dashboard account refresh cannot restore the account after sign-out completes", async t => {
  const app = siteHarness({ initialDashboard: true }); t.after(() => app.cleanup()); const b = browser(t);
  let accountCalls = 0, releaseLogout, releaseAccount;
  const snapshot = { id: "fixture-user", email: "fixture@example.test", credits: 220 };
  const account = () => Response.json({ user: snapshot, transactions: [] });
  t.mock.method(globalThis, "fetch", (url) => {
    if (url === "/api/auth/logout") return new Promise(resolve => { releaseLogout = () => resolve(Response.json({ success: true })); });
    accountCalls++;
    if (accountCalls === 1) return Promise.resolve(account());
    return new Promise(resolve => { releaseAccount = () => resolve(account()); });
  });
  let tree = app.render(); app.flushEffects(); await settle(); tree = app.render();
  walk(tree, e => e.type?.name === "Dashboard")[0].props.onUser(snapshot);
  walk(app.render(), e => e.type?.name === "Dashboard")[0].props.onAccount(); app.render(); app.flushEffects(); await settle(); tree = app.render();
  walk(tree, e => e.type === "button" && e.props.className === "modal-close")[0].props.onClick(); app.render(); app.flushEffects();
  walk(app.render(), e => e.type?.name === "Dashboard")[0].props.onAccount(); tree = app.render(); app.flushEffects();
  walk(tree, e => e.type === "button" && text(e) === "Sign out")[0].props.onClick();
  releaseLogout(); await settle(); releaseAccount(); await settle(); tree = app.render();
  assert.deepEqual(b.assigned, ["/"]); assert.equal(walk(tree, e => e.props?.className === "modal account-modal").length, 0);
  walk(tree, e => e.type?.name === "Dashboard")[0].props.onBuy("pro_monthly_v2"); tree = app.render();
  assert.equal(walk(tree, e => e.props?.role === "dialog")[0].props["aria-label"], "Create your account");
  assert.equal(walk(tree, e => e.props?.className === "modal payment-modal").length, 0);
});

for (const initialDashboard of [false, true]) test(`actual ${initialDashboard ? "Dashboard" : "homepage"} shell owns a unique main landmark and anchor IDs`, () => {
  const { PassWiselySite } = sourceModule("app/PassWiselySite.tsx");
  const html = renderToStaticMarkup(React.createElement(PassWiselySite, { initialDashboard }));
  assert.equal([...html.matchAll(/<main(?:\s|>)/g)].length, 1);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Duplicate anchor IDs break skip links and page navigation");
  assert.ok(ids.includes("top"));
});
