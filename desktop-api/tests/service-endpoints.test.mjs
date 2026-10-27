import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = relative => path.join(root, relative);
const nativeGrant = () => ({
  kind: "native-deepgram", accessToken: "fixture.temporary.jwt",
  expiresAt: Date.now() + 30_000, transcriptionProfile: "deepgram-en",
  language: "en", model: "nova-3", wsUrl: "wss://api.deepgram.com/v1/listen",
});

function fixture(environment = {}) {
  const files = new Map(), httpClients = [], grpcClients = [], protoFiles = [];
  const load = createProductionTsLoader({
    env: environment,
    console: { log() {}, warn() {}, error() {} },
    mocks: {
      electron: { app: { getPath: () => "/fixture-only", getAppPath: () => root, getVersion: () => "2.0.0" },
        safeStorage: { isEncryptionAvailable: () => false } },
      dotenv: { config() {} },
      "node:fs": {
        readFileSync(name) { if (!files.has(name)) throw new Error("not found"); return files.get(name); },
        writeFileSync(name, value) { files.set(name, value); }, mkdirSync() {}, chmodSync() {},
      },
      openai: { OpenAI: class {
        constructor(options) { httpClients.push(options); }
      } },
      "@grpc/proto-loader": { loadSync(filename) { protoFiles.push(filename); return {}; } },
      "@grpc/grpc-js": {
        credentials: { createSsl: () => "fixture-tls", createInsecure: () => "fixture-insecure" },
        loadPackageDefinition: () => ({ passwisely: { desktop: { v1: { DesktopAI: class {
          constructor(address, credentials) { grpcClients.push({ address, credentials }); }
          close() {}
        } } } } }),
      },
    },
  });
  const { AccountService } = load(entry("electron/account.ts"));
  const { ProcessingHelper } = load(entry("electron/ProcessingHelper.ts"));
  const { getServiceEndpoints } = load(entry("electron/serviceEndpoints.ts"));
  const account = new AccountService();
  const processing = new ProcessingHelper({
    getScreenshotHelper: () => ({}), getWiseAccessToken: () => account.getToken(),
    getMainWindow: () => null, setHasDebugged() {}, setProblemInfo() {},
  });
  return { account, processing, httpClients, grpcClients, protoFiles, getServiceEndpoints };
}
const wiseConfig = {
  route: "wise", provider: "kimi", providerLabel: "Kimi / Moonshot", model: "kimi-k3",
  apiKey: "", usesWiseDefaultKey: true, supportsVision: true, responseLanguage: "en",
  baseUrl: "https://personal-provider.fixture.test/v1",
};

// The production account and AI consumers run together. The credential, HTTP,
// OpenAI and gRPC seams are fixtures; these tests make no network/provider calls.
for (const scenario of [
  { name: "production defaults", environment: {},
    api: "https://passwisely.cn/api", portal: "https://passwisely.cn/#account",
    grpc: "passwisely.cn:443", credentials: "fixture-tls" },
  { name: "explicit API prefix and independent gRPC override", environment: {
    PASSWISELY_API_URL: "https://staging.fixture.test:8443/desktop/api///",
    PASSWISELY_GRPC_URL: "  staging-grpc.fixture.test:9443  ",
  }, api: "https://staging.fixture.test:8443/desktop/api",
    portal: "https://staging.fixture.test:8443/desktop/#account",
    grpc: "staging-grpc.fixture.test:9443", credentials: "fixture-tls" },
  { name: "explicit loopback development transports", environment: {
    PASSWISELY_API_URL: "http://127.0.0.1:3011/api/",
    PASSWISELY_GRPC_URL: "127.0.0.1:50051", PASSWISELY_GRPC_INSECURE: "1",
  }, api: "http://127.0.0.1:3011/api", portal: "http://127.0.0.1:3011/#account",
    grpc: "127.0.0.1:50051", credentials: "fixture-insecure" },
]) {
  test(`${scenario.name} route account, ASR, model HTTP, gRPC and portal consistently`, async t => {
    const f = fixture(scenario.environment), calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/login")) return Response.json({ token: "fixture-account-token", user: { id: "fixture-user" } });
      if (url.endsWith("/desktop/deepgram/token")) return Response.json(nativeGrant());
      assert.fail(`Unexpected fixture request: ${url}`);
    });
    assert.equal((await f.account.login("fixture@example.test", "fixture-password")).success, true);
    const session = await f.account.createNativeCaptureSession("7e481d68-b998-4c55-8d20-40176819fe8f", new AbortController().signal, "deepgram-en");
    assert.equal(session.transcriptionProfile, "deepgram-en");
    assert.deepEqual(calls.map(call => call.url), [`${scenario.api}/auth/login`, `${scenario.api}/desktop/deepgram/token`]);
    assert.equal(calls[1].init.headers.get("authorization"), "Bearer fixture-account-token");
    assert.equal(f.account.getAccountUrl(), scenario.portal);

    f.processing.configure(wiseConfig);
    assert.equal(f.httpClients.length, 1);
    assert.equal(f.httpClients[0].baseURL, `${scenario.api}/ai`);
    assert.deepEqual(f.grpcClients, [{ address: scenario.grpc, credentials: scenario.credentials }]);
    assert.deepEqual(f.protoFiles, [path.join(root, "proto", "desktop_ai.proto")]);
    await f.httpClients[0].fetch(`${scenario.api}/auth/login`);
    assert.equal(calls.at(-1).init.headers.get("authorization"), "Bearer fixture-account-token");
  });
}

test("HTTP override never infers a gRPC address or weakens its transport", () => {
  const f = fixture({ PASSWISELY_API_URL: "http://127.0.0.1:3011/custom-api/", PASSWISELY_GRPC_INSECURE: "true" });
  assert.deepEqual(f.getServiceEndpoints(), {
    apiBase: "http://127.0.0.1:3011/custom-api", aiBase: "http://127.0.0.1:3011/custom-api/ai",
    accountUrl: "http://127.0.0.1:3011/custom-api", grpcAddress: "passwisely.cn:443", grpcInsecure: false,
  });
  f.processing.configure(wiseConfig);
  assert.equal(f.httpClients[0].baseURL, "http://127.0.0.1:3011/custom-api/ai");
  assert.deepEqual(f.grpcClients, [{ address: "passwisely.cn:443", credentials: "fixture-tls" }]);
});

test("empty overrides preserve production defaults and direct model routes retain their personal endpoint", () => {
  const f = fixture({ PASSWISELY_API_URL: "", PASSWISELY_GRPC_URL: "  " });
  assert.equal(f.getServiceEndpoints().apiBase, "https://passwisely.cn/api");
  assert.equal(f.getServiceEndpoints().grpcAddress, "passwisely.cn:443");
  f.processing.configure({ ...wiseConfig, route: "direct", usesWiseDefaultKey: false, apiKey: "fixture-personal-key" });
  assert.equal(f.httpClients[0].baseURL, wiseConfig.baseUrl);
  assert.equal(f.httpClients[0].apiKey, "fixture-personal-key");
  assert.equal(f.httpClients[0].fetch, undefined);
  assert.equal(f.grpcClients.length, 0);
});
