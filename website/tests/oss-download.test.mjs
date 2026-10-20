import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(await read("../lib/download-artifacts.json"));
function application(data = manifest) {
  const load = createProductionTsLoader({ mocks: { "./download-artifacts.json": data } });
  return load(fileURLToPath(new URL("../lib/downloads.ts", import.meta.url)));
}
const verified = () => ({ ...manifest, artifacts: Object.fromEntries(Object.entries(manifest.artifacts).map(([platform, value]) =>
  [platform, value.legacy ? value : { ...value, sha256: "a".repeat(64), bytes: 1234 }])), });

test("verified v2 Mac ARM64 and Windows keep Intel on its honest legacy URL", () => {
  const app = application(verified());
  for (const platform of ["mac-arm64", "mac-x64", "windows-x64"]) {
    const artifact = app.downloadArtifact(platform), response = app.downloadResponse(platform);
    const version = platform === "mac-x64" ? "1.2.6" : "2.0.0";
    assert.equal(artifact.version, version); assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `${app.OSS_RELEASE_ORIGIN}/releases/v${version}/${artifact.filename}`);
    assert.equal(response.headers.get("x-passwisely-release-version"), version);
    assert.equal(response.headers.get("x-passwisely-artifact-sha256"), platform === "mac-x64" ? null : "a".repeat(64));
  }
  assert.equal(app.downloadArtifact("mac-x64").liveAudio, "not_included");
});

test("unverified new artifacts fail closed without silently selecting v1.2.6", () => {
  const pending = { ...manifest, artifacts: Object.fromEntries(Object.entries(manifest.artifacts).map(([platform, value]) => [platform, value.legacy ? value : { ...value, sha256: null, bytes: null }])) };
  const app = application(pending);
  for (const platform of ["mac-arm64", "windows-x64"]) {
    const response = app.downloadResponse(platform);
    assert.equal(response.status, 503); assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(app.downloadUrl(platform), null);
  }
  assert.equal(app.downloadResponse("mac-x64").status, 307);
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
  for (const patch of [{version:"../../2"}, {filename:"other.exe"}, {sha256:"invalid"}, {bytes:0}, {bytes:Infinity}, {legacy:true}]) {
    assert.throws(() => app.versionedArtifact("mac-arm64", { ...valid, ...patch }), /release artifact/);
  }
  assert.throws(() => app.versionedArtifact("unknown", valid), /release artifact/);
  assert.throws(() => app.versionedArtifact("mac-x64", {...manifest.artifacts["mac-x64"],liveAudio:"included"}), /legacy/);
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
  assert.equal(app.downloadArtifact("mac-x64").notice, null);
  assert.throws(() => app.versionedArtifact("windows-x64", { ...verified().artifacts["windows-x64"], notice: "invalid" }), /notice/);
});
