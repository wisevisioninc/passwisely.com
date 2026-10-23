import assert from "node:assert/strict";
import { createCipheriv, generateKeyPairSync, sign, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

// Run the real config, Web Crypto implementation and WeChat adapter with fresh
// in-memory credentials. Only the Cloudflare binding and fetch transport are
// substituted; these fixtures never read merchant credentials or send payments.
const keyOptions = {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
};
const application = generateKeyPairSync("rsa", keyOptions);
const platform = generateKeyPairSync("rsa", keyOptions);
const wrongPlatform = generateKeyPairSync("rsa", keyOptions);
const apiV3Key = "0123456789abcdef0123456789abcdef";
const timestamp = "1792713600";
const platformKeyId = "PUB_KEY_ID_SYNTHETIC_PLATFORM";
const source = fileURLToPath(new URL("../lib/payments/wechat.ts", import.meta.url));
const nativeInput = {
  origin: "https://passwisely.example.invalid",
  merchantOrderNo: "PW_SYNTHETIC_WECHAT_1",
  description: "PassWisely 进阶包 + synthetic fixture",
  amountFen: 9900,
};

function adapter(t, overrides = {}) {
  t.mock.method(Date, "now", () => Number(timestamp) * 1000);
  const env = {
    WECHAT_PAY_APP_ID: "wx-synthetic-app",
    WECHAT_PAY_MCH_ID: "1900000000",
    WECHAT_PAY_MCH_SERIAL_NO: "SYNTHETIC_MERCHANT_CERTIFICATE",
    WECHAT_PAY_PRIVATE_KEY: application.privateKey,
    WECHAT_PAY_API_V3_KEY: apiV3Key,
    WECHAT_PAY_PUBLIC_KEY_ID: platformKeyId,
    WECHAT_PAY_PUBLIC_KEY: platform.publicKey,
    ...overrides,
  };
  return createProductionTsLoader({ mocks: { "cloudflare:workers": { env } } })(source);
}

// Independent Node crypto oracle signs the exact wire bytes, including the
// mandatory final newline. It does not call production signing/decryption code.
function signedHeaders(body, { privateKey = platform.privateKey, time = timestamp, serial = platformKeyId } = {}) {
  const nonce = "synthetic-platform-nonce";
  return new Headers({
    "wechatpay-timestamp": time,
    "wechatpay-nonce": nonce,
    "wechatpay-serial": serial,
    "wechatpay-signature": sign("RSA-SHA256", Buffer.from(`${time}\n${nonce}\n${body}\n`), privateKey).toString("base64"),
    "content-type": "application/json",
  });
}

function syntheticTransport(t, body, { status = 200, headers = signedHeaders(body) } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    // Assert the intended target before returning a response; no fetch escapes
    // this test boundary, even if production accidentally selects another URL.
    assert.equal(url, "https://api.mch.weixin.qq.com/v3/pay/transactions/native");
    calls.push({ url, init });
    return new Response(body, { status, headers });
  });
  return calls;
}

function noProviderRequests(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Notification verification must not request a provider."));
}

const transaction = {
  appid: "wx-synthetic-app",
  mchid: "1900000000",
  out_trade_no: nativeInput.merchantOrderNo,
  transaction_id: "synthetic-wechat-transaction-1",
  trade_state: "SUCCESS",
  amount: { total: 9900, payer_total: 9900, currency: "CNY", payer_currency: "CNY" },
};

function encryptedEvent() {
  const nonce = "0123456789ab";
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(transaction), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
  return {
    id: "synthetic-wechat-event-1",
    event_type: "TRANSACTION.SUCCESS",
    resource: { algorithm: "AEAD_AES_256_GCM", ciphertext, nonce, associated_data: associatedData },
  };
}

test("WeChat Native signs the exact request and accepts an independently signed platform response", async t => {
  const wechat = adapter(t);
  const body = JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=SYNTHETIC_ONLY" });
  const calls = syntheticTransport(t, body);
  assert.deepEqual(await wechat.createWechatNativePayment(nativeInput), {
    codeUrl: "weixin://wxpay/bizpayurl?pr=SYNTHETIC_ONLY",
  });
  assert.equal(calls.length, 1);
  const { init } = calls[0];
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), {
    appid: "wx-synthetic-app",
    mchid: "1900000000",
    description: nativeInput.description,
    out_trade_no: nativeInput.merchantOrderNo,
    notify_url: "https://passwisely.example.invalid/api/payments/wechat/notify",
    amount: { total: 9900, currency: "CNY" },
  });
  const headers = new Headers(init.headers);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("wechatpay-serial"), platformKeyId);
  const authorization = headers.get("authorization");
  assert.match(authorization, /^WECHATPAY2-SHA256-RSA2048 /);
  const fields = Object.fromEntries([...authorization.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
  assert.deepEqual(Object.keys(fields).sort(), ["mchid", "nonce_str", "serial_no", "signature", "timestamp"]);
  assert.equal(fields.mchid, "1900000000");
  assert.equal(fields.serial_no, "SYNTHETIC_MERCHANT_CERTIFICATE");
  assert.equal(fields.timestamp, timestamp);
  assert.match(fields.nonce_str, /^[a-f0-9]{32}$/);
  const message = `POST\n/v3/pay/transactions/native\n${fields.timestamp}\n${fields.nonce_str}\n${init.body}\n`;
  assert.equal(verify("RSA-SHA256", Buffer.from(message), application.publicKey, Buffer.from(fields.signature, "base64")), true);
});

for (const [name, response] of [
  ["missing signature", body => { const headers = signedHeaders(body); headers.delete("wechatpay-signature"); return { body, headers }; }],
  ["untrusted signing key", body => ({ body, headers: signedHeaders(body, { privateKey: wrongPlatform.privateKey }) })],
  ["wrong platform key ID", body => ({ body, headers: signedHeaders(body, { serial: "PUB_KEY_ID_OTHER_PLATFORM" }) })],
  ["expired timestamp", body => ({ body, headers: signedHeaders(body, { time: String(Number(timestamp) - 301) }) })],
  ["changed response bytes", body => ({ body: body.replace("ORIGINAL", "TAMPERED"), headers: signedHeaders(body) })],
]) {
  test(`WeChat Native rejects a response with ${name}`, async t => {
    const wechat = adapter(t);
    const fixture = response(JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=ORIGINAL" }));
    const calls = syntheticTransport(t, fixture.body, { headers: fixture.headers });
    await assert.rejects(wechat.createWechatNativePayment(nativeInput), /Invalid WeChat Pay signature|Expired WeChat Pay signature/);
    assert.equal(calls.length, 1);
  });
}

test("WeChat Native preserves a signed provider failure instead of returning a QR code", async t => {
  const wechat = adapter(t);
  const body = JSON.stringify({ code: "APPID_MCHID_NOT_MATCH", message: "synthetic binding rejection" });
  syntheticTransport(t, body, { status: 400 });
  await assert.rejects(wechat.createWechatNativePayment(nativeInput), /APPID_MCHID_NOT_MATCH: synthetic binding rejection/);
});

test("WeChat notification verifies the platform signature and decrypts independent AES-GCM wire data", async t => {
  const wechat = adapter(t);
  noProviderRequests(t);
  const body = JSON.stringify(encryptedEvent());
  assert.deepEqual(await wechat.verifyAndDecryptWechatNotification(body, signedHeaders(body)), transaction);
  await assert.rejects(wechat.verifyAndDecryptWechatNotification(`${body} `, signedHeaders(body)), /Invalid WeChat Pay signature/);
});

for (const [name, mutate] of [
  ["ciphertext", event => {
    const bytes = Buffer.from(event.resource.ciphertext, "base64");
    bytes[0] ^= 1;
    event.resource.ciphertext = bytes.toString("base64");
  }],
  ["associated data", event => { event.resource.associated_data = "other-transaction"; }],
]) {
  test(`WeChat notification rejects authenticated resource ${name} tampering even under a valid outer signature`, async t => {
    const wechat = adapter(t);
    noProviderRequests(t);
    const event = encryptedEvent();
    mutate(event);
    const body = JSON.stringify(event);
    await assert.rejects(wechat.verifyAndDecryptWechatNotification(body, signedHeaders(body)), { name: "OperationError" });
  });
}

test("WeChat notification rejects a different APIv3 decryption key", async t => {
  const wechat = adapter(t, { WECHAT_PAY_API_V3_KEY: "fedcba9876543210fedcba9876543210" });
  noProviderRequests(t);
  const body = JSON.stringify(encryptedEvent());
  await assert.rejects(wechat.verifyAndDecryptWechatNotification(body, signedHeaders(body)), { name: "OperationError" });
});
