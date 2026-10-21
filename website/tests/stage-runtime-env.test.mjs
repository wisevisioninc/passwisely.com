import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const sourceScript = new URL("../scripts/stage-runtime-env.mjs", import.meta.url);
// Self-signed, synthetic test-only public certificate. Its private key is not retained.
const certificate = `-----BEGIN CERTIFICATE-----
MIICuTCCAaECCBI0VniQq83vMA0GCSqGSIb3DQEBCwUAMB8xHTAbBgNVBAMMFFBh
c3NXaXNlbHktVEVTVC1PTkxZMB4XDTI2MTAyMTA3MjIzNloXDTM2MTAxODA3MjIz
NlowHzEdMBsGA1UEAwwUUGFzc1dpc2VseS1URVNULU9OTFkwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQCdu/wcoD7B4+G5GZQZ3ximfUQjSlFOdUOT1ec4
kpj13CsHGboRUmIiSKO3bD9wv+1xWGkpQhTG8CKKB5NlNAMHl3LJ1ra0zj64dqH3
hOUXjiXX2Q/JmzMRrpA3pTUT63z3xS84R+xKs1Ymom+E/pHbwlFgvj16gy8w9LNp
YLoyFNBYBjeHctU8zqYPJCk+Qzcpa7d+EbYhQ6yjp2gQi5WWZiFUiW33xJr9Ez6I
qn44mRE7blqJ8ZXEX/5iu7cRbkoDj5whMZLt8nQI1BiKkBTs2gRFIPoO8SkyVisL
9Xgz3eJjrXQLP7QN9L3eBxvxg0bulXKo9YLNS6tcHK/ZjxDLAgMBAAEwDQYJKoZI
hvcNAQELBQADggEBAFp7j4Kj9HMMKhTeQlpCEPM2JuHV1r8XDQorOzRajCfX9Eyj
3sEO2RBpT16etbrZ72MTcwm056tfqO03+j/gyT+tJLEEOsOMryqvOznyZumWfe8n
gDqbNj2ohubYhjDxCWDnrHb3eNdOJoI7ze/cBXctOD5smeA51myFBdx8sjRl+uQN
r8shiS/OCtvdGDNOCTDBA2FAaPnSTWDs3GfRSJbo2pjMjy/Tn52q4VyLLMDdr36b
BKIJEB+xT1C1IBPNsNbbhrPfkJ9/1T2KZn3AAhvRj8TTaNsycZqSgAeR4DGDehyP
7rvggUB1b173qbdQzoFdPjeVneKgKBlbmuF2GRw=
-----END CERTIFICATE-----
`;
const serial = "1234567890ABCDEF";
const merchantPrivatePem = "-----BEGIN PRIVATE KEY-----\nsynthetic-merchant-key\n-----END PRIVATE KEY-----\n";
const wechatPublicPem = "-----BEGIN PUBLIC KEY-----\nsynthetic-provider-key\n-----END PUBLIC KEY-----\n";

async function fixture(t, contents) {
  const root = await mkdtemp(path.join(tmpdir(), "passwisely-runtime-staging-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  const script = path.join(root, "scripts/stage-runtime-env.mjs");
  await copyFile(sourceScript, script);
  if (contents !== undefined) await writeFile(path.join(root, ".env.production"), contents);
  const destination = path.join(root, "dist/server/.dev.vars");
  return {
    root, destination,
    run() {
      // No inherited environment credentials; the copied owner reads only this fixture.
      return spawnSync(process.execPath, [script], { cwd: root, env: {}, encoding: "utf8" });
    },
    async values() {
      const text = await readFile(destination, "utf8");
      return Object.fromEntries(text.trimEnd().split("\n").map(line => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
      }));
    },
  };
}

function assertStaged(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Staged protected runtime configuration.\n");
}

function runtimeConfig(values) {
  return readFile(new URL("../lib/payments/config.ts", import.meta.url), "utf8").then(source => {
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", code)(name => {
      assert.equal(name, "cloudflare:workers");
      return { env: values };
    }, loaded, loaded.exports);
    return loaded.exports;
  });
}

const requiredWechatFixture = {
  WECHAT_PAY_APP_ID: "fixture-bound-app",
  WECHAT_PAY_MCH_SERIAL_NO: serial,
  WECHAT_PAY_PRIVATE_KEY: "fixture-private-key",
  WECHAT_PAY_API_V3_KEY: "fixture-api-v3-key",
  WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_fixture",
  WECHAT_PAY_PUBLIC_KEY: "fixture-public-key",
};

function envText(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

test("staging without a source env exits without creating runtime output", async t => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  await assert.rejects(stat(f.destination), { code: "ENOENT" });
});

test("unrelated web configuration stages without inventing payment identity or logging values", async t => {
  const f = await fixture(t, "PUBLIC_FIXTURE=synthetic-web-value\n");
  assertStaged(f.run());
  assert.deepEqual(await f.values(), { PUBLIC_FIXTURE: "synthetic-web-value" });
  if (process.platform !== "win32") assert.equal((await stat(f.destination)).mode & 0o777, 0o600);
});

test("explicit legacy merchant ID is normalized while existing API-key aliases survive", async t => {
  const f = await fixture(t, envText({
    WECHAT_MCH_ID: "fixture-legacy-merchant",
    WECHAT_APIV3_KEY: "fixture-legacy-v3",
    WECHAT_PUB_KEY_ID: "PUB_KEY_ID_legacy",
  }));
  assertStaged(f.run());
  assert.deepEqual(await f.values(), {
    WECHAT_MCH_ID: "fixture-legacy-merchant",
    WECHAT_APIV3_KEY: "fixture-legacy-v3",
    WECHAT_PUB_KEY_ID: "PUB_KEY_ID_legacy",
    WECHAT_PAY_MCH_ID: "fixture-legacy-merchant",
    WECHAT_PAY_API_V3_KEY: "fixture-legacy-v3",
    WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_legacy",
  });
});

test("canonical merchant identity wins over a conflicting legacy value", async t => {
  const values = { WECHAT_PAY_MCH_ID: "fixture-canonical", WECHAT_MCH_ID: "fixture-legacy" };
  const f = await fixture(t, envText(values));
  assertStaged(f.run());
  assert.deepEqual(await f.values(), values);
});

test("blank canonical merchant uses an explicit alias, but empty inputs remain unconfigured", async t => {
  const legacy = await fixture(t, 'WECHAT_PAY_MCH_ID=""\nWECHAT_MCH_ID="fixture-explicit"\n');
  assertStaged(legacy.run());
  assert.equal((await legacy.values()).WECHAT_PAY_MCH_ID, "fixture-explicit");
  const absent = await fixture(t, 'WECHAT_PAY_MCH_ID=""\nWECHAT_MCH_ID=\n');
  assertStaged(absent.run());
  assert.deepEqual(await absent.values(), { WECHAT_PAY_MCH_ID: "", WECHAT_MCH_ID: "" });
});

test("staging succeeds without a merchant number while real runtime config rejects payment", async t => {
  const f = await fixture(t, envText(requiredWechatFixture));
  assertStaged(f.run());
  const values = await f.values();
  assert.equal(Object.hasOwn(values, "WECHAT_PAY_MCH_ID"), false);
  const config = await runtimeConfig(values);
  assert.throws(() => config.getWechatPayConfig(), /Payment configuration is missing: WECHAT_PAY_MCH_ID or WECHAT_MCH_ID/);
});

test("relative credential directory still loads PEM files and derives the certificate serial", async t => {
  const f = await fixture(t, "WECHAT_V3_CERT=./test-credentials\nWECHAT_MCH_ID=fixture-merchant\n");
  const credentials = path.join(f.root, "test-credentials");
  await mkdir(credentials);
  await Promise.all([
    writeFile(path.join(credentials, "apiclient_key.pem"), merchantPrivatePem),
    writeFile(path.join(credentials, "apiclient_cert.pem"), certificate),
    writeFile(path.join(credentials, "wechatpay_public_key.pem"), wechatPublicPem),
  ]);
  assertStaged(f.run());
  const values = await f.values();
  assert.equal(values.WECHAT_PAY_PRIVATE_KEY, merchantPrivatePem);
  assert.equal(values.WECHAT_PAY_PUBLIC_KEY, wechatPublicPem);
  assert.equal(values.WECHAT_PAY_MCH_SERIAL_NO, serial);
  assert.equal(values.WECHAT_PAY_MCH_ID, "fixture-merchant");
});

test("individual absolute and relative credential paths keep their existing precedence", async t => {
  const f = await fixture(t, "");
  await mkdir(path.join(f.root, "individual"));
  const privatePath = path.join(f.root, "individual/custom-private.pem");
  const publicPath = path.join(f.root, "individual/custom-public.pem");
  await Promise.all([
    writeFile(privatePath, merchantPrivatePem),
    writeFile(publicPath, wechatPublicPem),
    writeFile(path.join(f.root, "individual/custom-cert.pem"), certificate),
  ]);
  await writeFile(path.join(f.root, ".env.production"), envText({
    WECHAT_V3_CERT: "./missing-fallback-directory",
    WECHAT_V3_CERT_PE: privatePath,
    WECHAT_V3_CERT_PEM: "./individual/custom-cert.pem",
    WECHAT_PUB_KEY: publicPath,
  }));
  assertStaged(f.run());
  const values = await f.values();
  assert.equal(values.WECHAT_PAY_PRIVATE_KEY, merchantPrivatePem);
  assert.equal(values.WECHAT_PAY_PUBLIC_KEY, wechatPublicPem);
  assert.equal(values.WECHAT_PAY_MCH_SERIAL_NO, serial);
  assert.equal(Object.hasOwn(values, "WECHAT_PAY_MCH_ID"), false);
});

test("inline canonical keys and serial bypass configured file fallbacks and keep aliases usable", async t => {
  const f = await fixture(t, envText({
    ...requiredWechatFixture,
    WECHAT_PAY_PRIVATE_KEY: merchantPrivatePem.replaceAll("\n", "\\n"),
    WECHAT_PAY_PUBLIC_KEY: wechatPublicPem.replaceAll("\n", "\\n"),
    WECHAT_V3_CERT: "./missing-directory",
    WECHAT_PUB_KEY: "./missing-public.pem",
    WECHAT_MCH_ID: "fixture-merchant",
    WECHAT_APP_ID: "fixture-alias-app",
    WECHAT_MCH_SERIAL_NO: "fixture-alias-serial",
    WECHAT_MERCHANT_PRIVATE_KEY: "fixture-alias-private",
  }));
  assertStaged(f.run());
  const values = await f.values();
  const config = await runtimeConfig(values);
  const canonical = config.getWechatPayConfig();
  assert.equal(canonical.merchantPrivateKey, merchantPrivatePem);
  assert.equal(canonical.wechatPayPublicKey, wechatPublicPem);
  assert.equal(canonical.merchantSerialNo, serial);
  assert.equal(canonical.appId, "fixture-bound-app");
  delete values.WECHAT_PAY_APP_ID;
  delete values.WECHAT_PAY_MCH_SERIAL_NO;
  delete values.WECHAT_PAY_PRIVATE_KEY;
  const aliases = config.getWechatPayConfig();
  assert.equal(aliases.appId, "fixture-alias-app");
  assert.equal(aliases.merchantSerialNo, "fixture-alias-serial");
  assert.equal(aliases.merchantPrivateKey, "fixture-alias-private");
});

test("an explicitly configured missing credential still fails without writing partial runtime bindings", async t => {
  const f = await fixture(t, "WECHAT_V3_CERT_PE=./missing-private.pem\n");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WECHAT_PAY_PRIVATE_KEY credential file was not found/);
  await assert.rejects(stat(f.destination), { code: "ENOENT" });
});
