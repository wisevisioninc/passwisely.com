import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

// Protocol fixtures use generated in-memory keys and the real production
// config, RSA implementation and Alipay adapter. No merchant key, payment order,
// provider request or account database is read or used.
const keyOptions = {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
};
const application = generateKeyPairSync("rsa", keyOptions);
const platform = generateKeyPairSync("rsa", keyOptions);
const wrongPlatform = generateKeyPairSync("rsa", keyOptions);
const env = {
  ALIPAY_APP_ID: "synthetic-app",
  ALIPAY_SELLER_ID: "2088000000000000",
  ALIPAY_PRIVATE_KEY: application.privateKey,
  ALIPAY_PUBLIC_KEY: platform.publicKey,
  ALIPAY_GATEWAY_URL: "https://payment.example.invalid/gateway.do",
};
const alipayPath = fileURLToPath(new URL("../lib/payments/alipay.ts", import.meta.url));
const alipay = createProductionTsLoader({ mocks: { "cloudflare:workers": { env } } })(alipayPath);

// Independent protocol oracle uses Node's RSA implementation, not production
// canonicalization or signing helpers. Notification signing excludes BOTH
// sign and sign_type and preserves empty fields; outgoing page-pay signing
// excludes only sign and omits empty optional values. See Alipay's official SDK:
// https://github.com/alipay/alipay-sdk-nodejs-all/blob/master/src/alipay.ts
function message(params, excluded, includeEmpty = false) {
  return [...params.entries()]
    .filter(([name, value]) => !excluded.includes(name) && (includeEmpty || value !== ""))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}
function signedNotification({ privateKey = platform.privateKey, includeSignType = false, omitEmpty = false } = {}) {
  const params = new URLSearchParams({
    notify_id: "synthetic-notify-1",
    app_id: "synthetic-app",
    out_trade_no: "PW_SYNTHETIC_1",
    total_amount: "99.00",
    trade_no: "synthetic-trade-1",
    trade_status: "TRADE_SUCCESS",
    subject: "进阶包 + spaces & symbols=ok %2B %2520",
    empty_optional: "",
    sign_type: "RSA2",
  });
  const text = message(params, includeSignType ? ["sign"] : ["sign", "sign_type"], !omitEmpty);
  params.set("sign", sign("RSA-SHA256", Buffer.from(text, "utf8"), privateKey).toString("base64"));
  return params;
}
function noProviderRequests(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("This cryptographic fixture must not call a provider."));
}

test("Alipay page-pay request includes sign_type in its independently verified RSA2 signature", async t => {
  noProviderRequests(t);
  const payment = await alipay.createAlipayPagePayment({
    origin: "https://passwisely.example.invalid",
    merchantOrderNo: "PW_SYNTHETIC_1",
    subject: "PassWisely 进阶包 + test",
    amountFen: 9900,
  });
  const url = new URL(payment.redirectUrl);
  assert.equal(url.origin, "https://payment.example.invalid");
  const params = url.searchParams;
  assert.equal(params.get("method"), "alipay.trade.page.pay");
  assert.equal(params.get("sign_type"), "RSA2");
  assert.equal(params.get("notify_url"), "https://passwisely.example.invalid/api/payments/alipay/notify");
  assert.equal(params.get("return_url"), "https://passwisely.example.invalid/?payment=return#account");
  assert.deepEqual(JSON.parse(params.get("biz_content")), {
    out_trade_no: "PW_SYNTHETIC_1",
    product_code: "FAST_INSTANT_TRADE_PAY",
    total_amount: "99.00",
    subject: "PassWisely 进阶包 + test",
  });
  const signature = Buffer.from(params.get("sign"), "base64");
  assert.equal(verify("RSA-SHA256", Buffer.from(message(params, ["sign"])), application.publicKey, signature), true);
  assert.equal(verify("RSA-SHA256", Buffer.from(message(params, ["sign", "sign_type"])), application.publicKey, signature), false);
});

test("Alipay notification verifies the decoded fields with sign and sign_type excluded", async t => {
  noProviderRequests(t);
  const params = new URLSearchParams(signedNotification().toString());
  const original = params.toString();
  assert.equal(params.get("subject"), "进阶包 + spaces & symbols=ok %2B %2520");
  assert.equal(await alipay.verifyAlipayNotification(params), true);
  assert.equal(params.toString(), original, "Verification must preserve caller-owned notification fields.");
  assert.equal(await alipay.verifyAlipayNotification(new URLSearchParams([...params.entries()].reverse())), true);
});

test("Alipay notification rejects a signature that incorrectly includes sign_type", async t => {
  noProviderRequests(t);
  assert.equal(await alipay.verifyAlipayNotification(signedNotification({ includeSignType: true })), false);
});

test("Alipay notification retains empty fields in its verification content", async t => {
  noProviderRequests(t);
  assert.equal(await alipay.verifyAlipayNotification(signedNotification()), true);
  assert.equal(await alipay.verifyAlipayNotification(signedNotification({ omitEmpty: true })), false);
});

for (const [field, changed] of [["total_amount", "299.00"], ["trade_no", "other-trade"], ["trade_status", "TRADE_CLOSED"], ["app_id", "other-app"]]) {
  test(`Alipay notification rejects a changed ${field}`, async t => {
    noProviderRequests(t);
    const params = signedNotification();
    params.set(field, changed);
    assert.equal(await alipay.verifyAlipayNotification(params), false);
  });
}

test("Alipay notification rejects missing, malformed and wrong-key signatures", async t => {
  noProviderRequests(t);
  const absent = signedNotification(); absent.delete("sign");
  assert.equal(await alipay.verifyAlipayNotification(absent), false);
  const malformed = signedNotification(); malformed.set("sign", "not valid base64 !");
  assert.equal(await alipay.verifyAlipayNotification(malformed), false);
  assert.equal(await alipay.verifyAlipayNotification(signedNotification({ privateKey: wrongPlatform.privateKey })), false);
});
