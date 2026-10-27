import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const filename = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));
function originOwner(environment) {
  return createProductionTsLoader({ mocks: { "cloudflare:workers": { env: environment } } })(filename("lib/public-site.ts"));
}

const invalidOrigins = [
  "", "   ", null, 123, "not-a-url", "//site.example.invalid", "http://site.example.invalid",
  "http://localhost:3011", "http://127.0.0.1:3011", "http://[::1]:3011",
  "https://user:password@site.example.invalid", "https://@site.example.invalid",
  "https://site.example.invalid/path", "https://site.example.invalid/path/..",
  "https://site.example.invalid/.", "https://site.example.invalid//",
  "https://site.example.invalid?", "https://site.example.invalid#",
  "https://site.example.invalid/?target=secret", "https://site.example.invalid/#secret",
  "https:\\site.example.invalid", "https://site.example.invalid\\path",
  "https://site.exa\nmple.invalid", "https://site.example.invalid:invalid",
];

test("public origin is canonical HTTPS configuration; only omission uses the production default", () => {
  const env = {};
  const { getPublicSiteOrigin } = originOwner(env);
  assert.equal(getPublicSiteOrigin(), "https://passwisely.cn");
  for (const [raw, expected] of [
    ["https://test.example.invalid", "https://test.example.invalid"],
    [" https://TEST.example.invalid:443/ ", "https://test.example.invalid"],
    ["https://localhost:3011/", "https://localhost:3011"],
    ["https://[::1]:3011", "https://[::1]:3011"],
  ]) {
    env.PUBLIC_SITE_URL = raw;
    assert.equal(getPublicSiteOrigin(), expected);
  }
  for (const raw of invalidOrigins) {
    env.PUBLIC_SITE_URL = raw;
    assert.throws(getPublicSiteOrigin, { message: "Invalid PUBLIC_SITE_URL configuration." });
  }
  delete env.PUBLIC_SITE_URL;
  assert.equal(getPublicSiteOrigin(), "https://passwisely.cn");
});

test("metadata shares the canonical public-origin owner, including explicit compatibility origin", () => {
  for (const [environment, expected] of [
    [{}, "https://passwisely.cn/"],
    [{ PUBLIC_SITE_URL: "https://passwisely.com/" }, "https://passwisely.com/"],
  ]) {
    const { metadata } = createProductionTsLoader({ mocks: {
      "@/lib/public-site": originOwner(environment),
    } })(filename("app/layout.tsx"));
    assert.equal(metadata.metadataBase.href, expected);
  }
});

test("payment adapters use the canonical CN or explicitly configured origin for notification and return URLs", async t => {
  // Exercise the production URL producers with synthetic signing seams. No
  // credential is loaded, no database order is created, and no request leaves
  // the fetch boundary below.
  const captured = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.mch.weixin.qq.com/v3/pay/transactions/native");
    captured.push(JSON.parse(init.body));
    return Response.json({ code_url: "weixin://synthetic-payment" }, { headers: {
      "wechatpay-timestamp": String(Math.floor(Date.now() / 1000)),
      "wechatpay-nonce": "synthetic-nonce",
      "wechatpay-serial": "PUB_KEY_ID_fixture",
      "wechatpay-signature": "synthetic-signature",
    } });
  });
  const config = {
    getAlipayConfig: () => ({ appId: "synthetic-app", privateKey: "synthetic-private", gateway: "https://payment.example.invalid/gateway.do" }),
    getWechatPayConfig: () => ({ appId: "synthetic-app", mchId: "synthetic-merchant", merchantPrivateKey: "synthetic-private", merchantSerialNo: "synthetic-serial", wechatPayPublicKeyId: "PUB_KEY_ID_fixture" }),
  };
  const adapters = createProductionTsLoader({ mocks: {
    "./config": config,
    "./crypto": { rsaSha256Sign: async () => "synthetic-signature", rsaSha256Verify: async () => true },
  } });
  const alipay = adapters(filename("lib/payments/alipay.ts"));
  const wechat = adapters(filename("lib/payments/wechat.ts"));
  for (const [environment, expected] of [
    [{}, "https://passwisely.cn"],
    [{ PUBLIC_SITE_URL: "https://passwisely.com" }, "https://passwisely.com"],
  ]) {
    const origin = originOwner(environment).getPublicSiteOrigin();
    const input = { origin, merchantOrderNo: "synthetic-only", subject: "synthetic", description: "synthetic", amountFen: 9900 };
    const page = new URL((await alipay.createAlipayPagePayment(input)).redirectUrl);
    assert.equal(page.origin, "https://payment.example.invalid");
    assert.equal(page.searchParams.get("notify_url"), `${expected}/api/payments/alipay/notify`);
    assert.equal(page.searchParams.get("return_url"), `${expected}/?payment=return#account`);
    assert.deepEqual(await wechat.createWechatNativePayment(input), { codeUrl: "weixin://synthetic-payment" });
    assert.equal(captured.at(-1).notify_url, `${expected}/api/payments/wechat/notify`);
  }
  assert.equal(captured.length, 2);
});

function application(environment) {
  const owner = originOwner(environment);
  const purchases = [], payments = [], emails = [];
  const checkout = createProductionTsLoader({ mocks: {
    "@/lib/public-site": owner,
    "@/lib/payments/config": createProductionTsLoader({ mocks: { "cloudflare:workers": { env: {
      ALIPAY_APP_ID: "synthetic-app", ALIPAY_SELLER_ID: "2088000000000000",
      ALIPAY_PRIVATE_KEY: "synthetic-private-key", ALIPAY_PUBLIC_KEY: "synthetic-public-key",
      WECHAT_PAY_APP_ID: "fixture-app", WECHAT_PAY_MCH_ID: "fixture-merchant", WECHAT_PAY_MCH_SERIAL_NO: "fixture-serial",
      WECHAT_PAY_PRIVATE_KEY: "synthetic-wechat-private", WECHAT_PAY_API_V3_KEY: "synthetic-wechat-v3-key",
      WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_fixture", WECHAT_PAY_PUBLIC_KEY: "synthetic-wechat-public",
    } } } })(filename("lib/payments/config.ts")),
    "@/lib/auth": {
      getCurrentUser: async () => ({ id: "synthetic-user" }),
      jsonError: (error, status, code) => Response.json({ error, ...(code ? { code } : {}) }, { status }),
    },
    "@/lib/payments/catalog": createProductionTsLoader()(filename("lib/payments/catalog.ts")),
    "@/lib/payments/orders": { createPurchase: async input => {
      purchases.push(input);
      return { id: `synthetic-${purchases.length}`, merchantOrderNo: "synthetic-order", amountMinor: 9900 };
    } },
    "@/lib/payments/alipay": { createAlipayPagePayment: async input => {
      payments.push(["alipay", input]); return { redirectUrl: "https://synthetic.example.invalid/alipay" };
    } },
    "@/lib/payments/wechat": { createWechatNativePayment: async input => {
      payments.push(["wechat", input]); return { codeUrl: "weixin://synthetic-payment" };
    } },
  } })(filename("app/api/checkout/route.ts"));
  class SupabaseRequestError extends Error {}
  const forgotPassword = createProductionTsLoader({ mocks: {
    "@/lib/public-site": owner,
    "@/lib/auth": {
      normalizeEmail: value => typeof value === "string" ? value.trim().toLowerCase() : "",
      jsonError: (error, status) => Response.json({ error }, { status }),
    },
    "@/lib/supabase": {
      SupabaseRequestError,
      requestPasswordReset: async (...args) => { emails.push(args); },
    },
  } })(filename("app/api/auth/forgot-password/route.ts"));
  return { checkout, forgotPassword, purchases, payments, emails };
}

// Real HTTP request -> production routes, with synthetic authenticated account,
// purchase/email and provider seams. The adapter deliberately preserves the
// HTTP Request.url observed in Wrangler 4.92 behind Nginx TLS termination; it
// does not pretend that Node's HTTP adapter establishes a complete Worker run.
async function loopback(t, app) {
  const observedUrls = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        assert.ok(length <= 16_384, "Synthetic HTTP fixture exceeded its bound");
        chunks.push(chunk);
      }
      const url = `http://${incoming.headers.host}${incoming.url}`;
      observedUrls.push(url);
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, body: Buffer.concat(chunks) });
      const route = incoming.url === "/api/checkout" ? app.checkout : app.forgotPassword;
      const result = await route.POST(request);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      outgoing.writeHead(500); outgoing.end("Synthetic adapter failure");
    }
  });
  server.requestTimeout = 5_000;
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  async function post(path, body, headers) {
    return new Promise((resolve, reject) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", ...headers } }, response => {
        const chunks = [];
        response.on("error", reject);
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
          catch (error) { reject(error); }
        });
      });
      request.setTimeout(5_000, () => request.destroy(new Error("Synthetic HTTP request timed out")));
      request.on("error", reject);
      request.end(JSON.stringify(body));
    });
  }
  return { post, observedUrls };
}

for (const configured of [undefined, "https://TEST.example.invalid:443/", "https://passwisely.com"]) {
  test(`HTTP proxy and hostile Host/forwarding headers cannot select external links (${configured === undefined ? "default" : configured})`, async t => {
    const environment = configured === undefined ? {} : { PUBLIC_SITE_URL: configured };
    const expected = configured === undefined ? "https://passwisely.cn" : new URL(configured).origin;
    const app = application(environment);
    const { post, observedUrls } = await loopback(t, app);
    for (const headers of [
      { host: "passwisely.com", "x-forwarded-proto": "https" },
      { host: "attacker.example.invalid", "x-forwarded-proto": "http", "x-forwarded-host": "attacker.example.invalid", forwarded: "host=attacker.example.invalid;proto=http" },
    ]) {
      for (const provider of ["alipay", "wechat"]) {
        const response = await post("/api/checkout", { packId: "pro_monthly_v2", provider }, headers);
        assert.equal(response.status, 200);
        const [actualProvider, input] = app.payments.at(-1);
        assert.equal(actualProvider, provider);
        assert.equal(input.origin, expected);
      }
      const response = await post("/api/auth/forgot-password", { email: "synthetic@example.invalid" }, headers);
      assert.equal(response.status, 200);
      assert.deepEqual(app.emails.at(-1), ["synthetic@example.invalid", `${expected}/?reset=password`]);
    }
    assert.equal(app.purchases.length, 4);
    assert.equal(app.payments.length, 4);
    assert.equal(app.emails.length, 2);
    assert.equal(observedUrls.length, 6);
    assert.ok(observedUrls.every(url => url.startsWith("http://")), "The regression must actually use an HTTP inbound URL");
    assert.ok(observedUrls.some(url => url.startsWith("http://attacker.example.invalid/")));
  });
}

test("invalid explicit configuration creates no purchase/provider request/recovery email", async () => {
  const environment = {};
  const app = application(environment);
  for (const configured of invalidOrigins) {
    environment.PUBLIC_SITE_URL = configured;
    for (const provider of ["alipay", "wechat"]) {
      const response = await app.checkout.POST(new Request("http://passwisely.com/api/checkout", {
        method: "POST", headers: { "x-forwarded-proto": "https" }, body: JSON.stringify({ packId: "pro_monthly_v2", provider }),
      }));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Payments are temporarily unavailable.", code: "PAYMENT_UNAVAILABLE" });
    }
    const recovery = await app.forgotPassword.POST(new Request("http://passwisely.com/api/auth/forgot-password", {
      method: "POST", body: JSON.stringify({ email: "synthetic@example.invalid" }),
    }));
    assert.equal(recovery.status, 503);
    assert.deepEqual(await recovery.json(), { error: "Password reset is temporarily unavailable." });
  }
  assert.deepEqual(app.purchases, []);
  assert.deepEqual(app.payments, []);
  assert.deepEqual(app.emails, []);
});

test("invalid site configuration degrades only site probes and is never disclosed or fetched", async t => {
  const env = { PUBLIC_SITE_URL: "https://user:private-diagnostic@example.invalid/path" };
  const { getAdminHealth } = createProductionTsLoader({ mocks: {
    "cloudflare:workers": { env },
    "@/lib/ai-catalog": { AI_PROVIDER_CATALOG: {} },
    "@/lib/ai-config": { getDefaultAiConfig: async () => null },
  } })(filename("lib/admin-health.ts"));
  const requests = [];
  t.mock.method(globalThis, "fetch", async url => {
    requests.push(url);
    assert.equal(url, "http://127.0.0.1:3013/health");
    return Response.json({ uptimeSeconds: 1 });
  });
  const report = await getAdminHealth(7);
  assert.deepEqual(requests, ["http://127.0.0.1:3013/health"]);
  for (const id of ["website", "mac-arm64", "mac-x64", "windows-x64"]) {
    const service = report.services.find(service => service.id === id);
    assert.equal(service.state, "degraded");
    assert.equal(service.detail, "PUBLIC_SITE_URL 配置无效");
  }
  assert.equal(report.services.find(service => service.id === "supabase").state, "healthy");
  assert.equal(report.services.find(service => service.id === "desktop-api").state, "healthy");
  assert.equal(report.host.uptimeSeconds, 1);
  assert.doesNotMatch(JSON.stringify(report), /private-diagnostic|example\.invalid|user:/);
});
