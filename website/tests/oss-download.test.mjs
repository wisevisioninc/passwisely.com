import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(await read("../lib/download-artifacts.json"));
const platforms = ["mac-arm64", "mac-x64", "windows-x64"];
const fixtureSha256 = "a".repeat(64);
const legacyIntelFixture = {
  version: "1.2.6", filename: "PassWisely-macOS-x64.dmg",
  sha256: "b".repeat(64), bytes: 2345, legacy: true, liveAudio: "not_included",
  notice: { zh: "Intel 兼容旧版 v1.2.6，不含实时音频。", en: "Intel legacy compatibility release v1.2.6, with no live audio." },
};
function application(data = manifest) {
  const load = createProductionTsLoader({ mocks: { "./download-artifacts.json": data } });
  return load(fileURLToPath(new URL("../lib/downloads.ts", import.meta.url)));
}
const verified = () => ({ ...manifest, artifacts: Object.fromEntries(Object.entries(manifest.artifacts).map(([platform, value]) =>
  [platform, { ...value, version: "2.0.0", legacy: false, sha256: fixtureSha256, bytes: 1234 }])), });

test("published catalog identifies verified v2 installers for all three platforms", () => {
  const app = application();
  assert.equal(manifest.releaseVersion, "2.0.0");
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), [...platforms].sort());
  for (const platform of platforms) {
    const artifact = app.downloadArtifact(platform), response = app.downloadResponse(platform);
    assert.equal(artifact.version, manifest.releaseVersion, platform);
    assert.equal(artifact.legacy, false, platform);
    assert.equal(artifact.available, true, platform);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, platform);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), artifact.url);
    assert.equal(response.headers.get("x-passwisely-artifact-sha256"), artifact.sha256);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const intel = app.downloadArtifact("mac-x64");
  assert.equal(intel.liveAudio, "included");
  assert.equal(intel.revision, 5);
  assert.equal(intel.sha256, "938e2c785916b12ded9fc547ab9fff076ef4a7196335fe635a82e4ae3e6923ca");
  assert.equal(intel.bytes, 119247160);
  assert.equal(intel.url, `${app.OSS_RELEASE_ORIGIN}/releases/v2.0.0/r5/PassWisely-macOS-x64.dmg`);
  assert.equal(intel.notice.zh, "原生音频需 macOS 13 或更新版本。");
  assert.equal(intel.notice.en, "Native live audio requires macOS 13 or later.");
  assert.doesNotMatch(intel.notice.zh, /不含实时音频/);
  assert.doesNotMatch(intel.notice.en, /no live audio/i);
  assert.doesNotMatch(intel.notice.zh, /旧版|v1\.2\.6/);
  assert.doesNotMatch(intel.notice.en, /legacy|v1\.2\.6/i);
});

test("verified v2 downloads return the selected immutable artifact without caching the alias", () => {
  const app = application(verified());
  for (const platform of platforms) {
    const artifact = app.downloadArtifact(platform), response = app.downloadResponse(platform);
    assert.equal(artifact.version, "2.0.0"); assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `${app.OSS_RELEASE_ORIGIN}/releases/v2.0.0/${artifact.revision > 1 ? `r${artifact.revision}/` : ""}${artifact.filename}`);
    assert.equal(response.headers.get("x-passwisely-release-version"), "2.0.0");
    assert.equal(response.headers.get("x-passwisely-artifact-sha256"), fixtureSha256);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(app.downloadUrl(platform), artifact.url);
  }
});

test("the independent Intel v1.2.6 legacy fixture retains its identity and audio limitation", () => {
  const current = verified();
  const app = application({ ...current, artifacts: { ...current.artifacts, "mac-x64": legacyIntelFixture } });
  const intel = app.downloadArtifact("mac-x64"), response = app.downloadResponse("mac-x64");
  assert.deepEqual({ version: intel.version, legacy: intel.legacy, liveAudio: intel.liveAudio,
    sha256: intel.sha256, bytes: intel.bytes, available: intel.available }, {
    version: "1.2.6", legacy: true, liveAudio: "not_included",
    sha256: legacyIntelFixture.sha256, bytes: legacyIntelFixture.bytes, available: true,
  });
  assert.equal(app.downloadUrl("mac-x64"), `${app.OSS_RELEASE_ORIGIN}/releases/v1.2.6/${legacyIntelFixture.filename}`);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("x-passwisely-artifact-sha256"), legacyIntelFixture.sha256);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(intel.notice.zh, /旧版.*v1\.2\.6.*不含实时音频/);
  assert.match(intel.notice.en, /legacy.*v1\.2\.6.*no live audio/i);
  const unverifiedLegacy = app.versionedArtifact("mac-x64", { ...legacyIntelFixture, sha256: null, bytes: null });
  assert.equal(unverifiedLegacy.available, true);
});

test("unverified v2 artifacts fail closed for every platform without selecting v1.2.6", () => {
  const current = verified();
  const pending = { ...current, artifacts: Object.fromEntries(Object.entries(current.artifacts).map(([platform, value]) => [platform, { ...value, sha256: null, bytes: null }])) };
  const app = application(pending);
  for (const platform of platforms) {
    const response = app.downloadResponse(platform);
    assert.equal(response.status, 503); assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(app.downloadUrl(platform), null);
  }
});

test("unknown and prototype names cannot select a download", () => {
  const app = application(verified());
  for (const value of ["", "__proto__", "constructor", "toString", "mac-universal", "../mac-arm64"]) {
    assert.equal(app.downloadArtifact(value), null); assert.equal(app.downloadUrl(value), null);
    assert.equal(app.downloadResponse(value).status, 404);
  }
});

test("artifact owner validates version, filename, digest, length and legacy exception", () => {
  const app = application(), valid = verified().artifacts["mac-arm64"];
  for (const patch of [{version:"../../2"}, {filename:"other.exe"}, {sha256:"invalid"}, {bytes:0}, {bytes:Infinity}, {revision:0}, {revision:1.5}, {revision:"2/../"}, {legacy:true}]) {
    assert.throws(() => app.versionedArtifact("mac-arm64", { ...valid, ...patch }), /release artifact/);
  }
  assert.throws(() => app.versionedArtifact("unknown", valid), /release artifact/);
  for (const patch of [{ version: "2.0.0" }, { liveAudio: "included" }]) {
    assert.throws(() => app.versionedArtifact("mac-x64", { ...legacyIntelFixture, ...patch }), /legacy/);
  }
});

test("download and tracking route use the parsed owner before recording an event", async () => {
  const [route, tracking, nginx] = await Promise.all([read("../app/api/download/[platform]/route.ts"), read("../app/api/track-download/[platform]/route.ts"), read("../nginx/passwisely.conf")]);
  assert.match(route, /downloadResponse/);
  assert.ok(tracking.indexOf('if (response.status !== 307)') < tracking.indexOf('await adminRest'));
  assert.doesNotMatch(nginx, /return 30[27] https:\/\/passwisely-releases/);
});

test("both landing download locations consume the same version and digest owner", async () => {
  const site = await read("../app/LandingPage.tsx");
  assert.match(site, /DOWNLOAD_ARTIFACTS/); assert.match(site, /artifact.sha256/);
  assert.match(site, /旧版（不含实时音频）/); assert.match(site, /no live audio/);
  assert.match(site, /aria-disabled/);
});


test("Windows download notice preserves unsigned/native-acceptance scope in both locales", () => {
  const app = application(verified());
  assert.match(app.downloadArtifact("windows-x64").notice.zh, /未签名.*实机验证/);
  assert.match(app.downloadArtifact("windows-x64").notice.en, /Unsigned.*await testing/);
  assert.throws(() => app.versionedArtifact("windows-x64", { ...verified().artifacts["windows-x64"], notice: "invalid" }), /notice/);
});


test("an earlier immutable revision remains addressable without an r1 suffix", () => {
  const app = application();
  const old = app.versionedArtifact("mac-arm64", { ...verified().artifacts["mac-arm64"], revision: 1 });
  assert.equal(old.url, `${app.OSS_RELEASE_ORIGIN}/releases/v2.0.0/${old.filename}`);
  const current = app.versionedArtifact("mac-arm64", { ...verified().artifacts["mac-arm64"], revision: 2 });
  assert.equal(current.url, `${app.OSS_RELEASE_ORIGIN}/releases/v2.0.0/r2/${old.filename}`);
});
