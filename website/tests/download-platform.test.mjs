import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const { detectDownloadOperatingSystem, detectDownloadPlatform } = createProductionTsLoader()(
  fileURLToPath(new URL("../lib/download-platform.ts", import.meta.url)),
);
const mac = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36",
  platform: "MacIntel",
  maxTouchPoints: 0,
};
const unknownMac = { os: "macos", architecture: "unknown", recommendedPlatform: null, source: "user-agent" };
const unknown = { os: "unknown", architecture: "unknown", recommendedPlatform: null, source: "unknown" };

function timers(t) {
  const active = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const handle = {};
    active.set(handle, { callback, delay });
    return handle;
  });
  t.mock.method(globalThis, "clearTimeout", handle => active.delete(handle));
  return active;
}

test("the same legacy Intel Mac identifiers recommend either native Mac package only from client hints", async t => {
  const active = timers(t);
  for (const [architecture, recommendedPlatform, expected] of [["arm", "mac-arm64", "arm64"], ["x86", "mac-x64", "x64"]]) {
    const userAgentData = {
      platform: "macOS",
      async getHighEntropyValues(requested) {
        assert.equal(this, userAgentData, "call the browser method with its owner");
        assert.deepEqual(requested, ["architecture"], "request only the hint required for package selection");
        return { architecture };
      },
    };
    assert.deepEqual(await detectDownloadPlatform({ ...mac, userAgentData }), {
      os: "macos", architecture: expected, recommendedPlatform, source: "client-hints",
    });
    assert.equal(active.size, 0, "successful detection clears its deadline");
  }
});

test("Safari, Firefox and legacy navigator.platform never turn Intel compatibility identifiers into hardware Intel", async () => {
  for (const userAgent of [
    mac.userAgent,
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
  ]) assert.deepEqual(await detectDownloadPlatform({ ...mac, userAgent }), unknownMac);
  assert.deepEqual(await detectDownloadPlatform({ platform: "MacIntel" }), unknownMac);
});

test("operating system hints and legacy fallbacks keep unsupported and ambiguous devices distinct", async () => {
  for (const [input, os, source, recommendedPlatform] of [
    [{ userAgentData: { platform: "Windows" } }, "windows", "client-hints", "windows-x64"],
    [{ platform: "Win32" }, "windows", "user-agent", "windows-x64"],
    [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows", "user-agent", "windows-x64"],
    [{ userAgentData: { platform: "Linux" } }, "other", "client-hints", null],
    [{ platform: "Linux x86_64" }, "other", "user-agent", null],
    [{ userAgent: "Mozilla/5.0 (X11; CrOS x86_64)" }, "other", "user-agent", null],
    [{ ...mac, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, "other", "user-agent", null],
    [{ userAgent: "Mozilla/5.0 (Linux; Android 16)" }, "other", "user-agent", null],
    [{ ...mac, userAgentData: { platform: "macOS", mobile: true } }, "other", "client-hints", null],
    [{ ...mac, userAgent: "Mozilla/5.0 (Windows NT 10.0)" }, "unknown", "unknown", null],
    [{ userAgent: "unrecognized browser", platform: "unrecognized platform" }, "unknown", "unknown", null],
  ]) {
    assert.deepEqual(detectDownloadOperatingSystem(input), { os, source });
    assert.deepEqual(await detectDownloadPlatform(input), { os, source, architecture: "unknown", recommendedPlatform });
  }
});

test("iPad desktop Mac identifiers stay unknown and never request CPU hints", async () => {
  for (const userAgentData of [undefined, { platform: "macOS", getHighEntropyValues() { assert.fail("do not probe an ambiguous touch device"); } }]) {
    assert.deepEqual(await detectDownloadPlatform({ ...mac, maxTouchPoints: 5, userAgentData }), unknown);
  }
});

test("non-Mac devices never request high-entropy architecture hints", async () => {
  for (const platform of ["Windows", "Linux", "Android", "iOS"]) {
    const result = await detectDownloadPlatform({ userAgentData: {
      platform,
      getHighEntropyValues() { assert.fail("only a Mac needs this architecture hint"); },
    } });
    assert.equal(result.architecture, "unknown");
  }
});

test("absent and malformed navigator observations have a deterministic no-UA fallback", async () => {
  for (const input of [undefined, null, {}, { userAgent: null, platform: 42, userAgentData: [] }, { userAgentData: "macOS" }]) {
    assert.deepEqual(await detectDownloadPlatform(input), unknown);
  }
  for (const userAgentData of [null, {}, { getHighEntropyValues: true }]) {
    assert.deepEqual(await detectDownloadPlatform({ ...mac, userAgentData }), unknownMac);
  }
});

test("denied, omitted, empty and malformed high-entropy values preserve the Mac architecture unknown", async t => {
  const active = timers(t);
  for (const value of [null, undefined, [], "arm", {}, { architecture: "" }, { architecture: "ARM" },
    { architecture: "arm64" }, { architecture: "x86_64" }, { architecture: "mips" }, { architecture: 64 },
    { brands: [], mobile: false, platform: "macOS" }]) {
    assert.deepEqual(await detectDownloadPlatform({ ...mac, userAgentData: { async getHighEntropyValues() { return value; } } }), unknownMac);
    assert.equal(active.size, 0, "malformed/omitted results clear their deadline");
  }
  for (const getHighEntropyValues of [
    () => { throw new Error("browser API failed synchronously"); },
    async () => { throw new Error("permission denied"); },
  ]) {
    assert.deepEqual(await detectDownloadPlatform({ ...mac, userAgentData: { getHighEntropyValues } }), unknownMac);
    assert.equal(active.size, 0, "errors clear their deadline");
  }
});

test("the default deadline is 1000ms, clears its timer and ignores late hints", async t => {
  const active = timers(t);
  let resolveHints;
  const pending = detectDownloadPlatform({ ...mac, userAgentData: {
    getHighEntropyValues: () => new Promise(resolve => { resolveHints = resolve; }),
  } });
  assert.equal(active.size, 1);
  const [{ callback, delay }] = active.values();
  assert.equal(delay, 1000);
  callback();
  const result = await pending;
  assert.deepEqual(result, unknownMac);
  assert.equal(active.size, 0, "timeout completion also clears its timer");
  resolveHints({ architecture: "arm" });
  await Promise.resolve();
  assert.deepEqual(result, unknownMac);
});

test("fixture deadlines can shorten but cannot unbound the production timeout", async t => {
  const active = timers(t);
  for (const [timeoutMs, expected] of [[2, 2], [0, 0], [5000, 1000], [-1, 1000], [Infinity, 1000], [NaN, 1000]]) {
    const pending = detectDownloadPlatform({ ...mac, userAgentData: {
      getHighEntropyValues: () => new Promise(() => {}),
    } }, { timeoutMs });
    const [{ callback, delay }] = active.values();
    assert.equal(delay, expected);
    callback();
    assert.deepEqual(await pending, unknownMac);
    assert.equal(active.size, 0);
  }
});

test("a late rejected hint after timeout remains handled", async t => {
  const active = timers(t);
  let rejectHints;
  const pending = detectDownloadPlatform({ ...mac, userAgentData: {
    getHighEntropyValues: () => new Promise((resolve, reject) => { rejectHints = reject; }),
  } }, { timeoutMs: 2 });
  active.values().next().value.callback();
  assert.deepEqual(await pending, unknownMac);
  rejectHints(new Error("late browser failure"));
  await Promise.resolve();
  assert.equal(active.size, 0);
});
