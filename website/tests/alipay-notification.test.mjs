import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

// End-to-end handler fixtures execute the real config, Alipay verification,
// order mapping and completion delegation. Only Cloudflare's binding and the
// database transport are substituted; no production key or provider is used.
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const sellerId = "2088000000000000";
const source = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const purchase = {
  id: "synthetic-purchase-1",
  user_id: "synthetic-user-1",
  merchant_order_no: "PW_SYNTHETIC_1",
  provider: "alipay",
  credits: 200,
  amount_minor: 9900,
  currency: "CNY",
  status: "pending",
  provider_transaction_id: null,
  credit_policy: "expiring",
  validity_days: 30,
  entitlement_version: 2,
};
function application(t, envOverrides = {}) {
  const env = {
    ALIPAY_APP_ID: "synthetic-app",
    ALIPAY_SELLER_ID: sellerId,
    ALIPAY_PRIVATE_KEY: keys.privateKey,
    ALIPAY_PUBLIC_KEY: keys.publicKey,
    ...envOverrides,
  };
  const reads = [], completions = [];
  const mocks = {
    "cloudflare:workers": { env },
    "@/lib/supabase": {
      adminRest: async (url, init) => { reads.push({ url, init }); return [purchase]; },
      adminRpc: async (name, args) => { completions.push({ name, args }); return completions.length === 1 ? "completed" : "duplicate"; },
    },
  };
  const load = createProductionTsLoader({ mocks });
  for (const name of ["config", "alipay", "orders"]) {
    mocks[`@/lib/payments/${name}`] = load(source(`lib/payments/${name}.ts`));
  }
  const { POST } = load(source("app/api/payments/alipay/notify/route.ts"));
  t.mock.method(globalThis, "fetch", async () => assert.fail("Callback fixtures must not request a provider."));
  return {
    reads,
    completions,
    send: params => POST(new Request("https://passwisely.example.invalid/api/payments/alipay/notify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })),
  };
}
function notification(fields = {}) {
  const values = {
    notify_id: "synthetic-notify-1",
    app_id: "synthetic-app",
    seller_id: sellerId,
    out_trade_no: "PW_SYNTHETIC_1",
    total_amount: "99.00",
    trade_no: "synthetic-trade-1",
    trade_status: "TRADE_SUCCESS",
    sign_type: "RSA2",
    subject: "进阶包 + %2B",
    empty_optional: "",
    ...fields,
  };
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined));
  // Independent Node crypto oracle follows Alipay's async-notification rule.
  const message = [...params.entries()]
    .filter(([name]) => name !== "sign" && name !== "sign_type")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  params.set("sign", sign("RSA-SHA256", Buffer.from(message, "utf8"), keys.privateKey).toString("base64"));
  return params;
}

test("Alipay signed callbacks delegate normal and repeated delivery to the real order completion boundary", async t => {
  const app = application(t);
  for (let i = 0; i < 2; i++) {
    const response = await app.send(notification());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "success");
  }
  assert.equal(app.reads.length, 2);
  for (const read of app.reads) assert.match(read.url, /^purchases\?merchant_order_no=eq\.PW_SYNTHETIC_1&select=/);
  assert.deepEqual(app.completions, Array.from({ length: 2 }, () => ({
    name: "complete_purchase",
    args: {
      p_purchase_id: purchase.id,
      p_transaction_id: "synthetic-trade-1",
      p_event_id: "alipay:synthetic-notify-1",
      p_event_type: "alipay:TRADE_SUCCESS",
    },
  })));
  // The mock verifies delegation only. Database idempotency has separate real
  // SQL coverage in monthly-credit-ledger.test.mjs, not in this transport test.
});

for (const [description, fields, expectedReads] of [
  ["wrong seller", { seller_id: "2088000000000001" }, 0],
  ["missing seller", { seller_id: undefined }, 0],
  ["wrong app", { app_id: "other-app" }, 0],
  ["wrong amount", { total_amount: "299.00" }, 1],
]) {
  test(`Alipay validly signed callback rejects ${description} without completing a purchase`, async t => {
    const app = application(t);
    const response = await app.send(notification(fields));
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "failure");
    assert.equal(app.reads.length, expectedReads);
    assert.deepEqual(app.completions, []);
  });
}

test("Alipay callback rejects a damaged signature before any database operation", async t => {
  const app = application(t);
  const params = notification(); params.set("sign", "malformed !");
  const response = await app.send(params);
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "failure");
  assert.deepEqual(app.reads, []);
  assert.deepEqual(app.completions, []);
});

test("Alipay callback fails closed when the configured seller ID is missing", async t => {
  const app = application(t, { ALIPAY_SELLER_ID: undefined });
  const response = await app.send(notification());
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "failure");
  assert.deepEqual(app.reads, []);
  assert.deepEqual(app.completions, []);
});
