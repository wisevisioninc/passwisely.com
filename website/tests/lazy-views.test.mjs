import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToPipeableStream } = require("react-dom/server");
const website = new URL("../", import.meta.url);
async function render(Component, props) {
  return await new Promise((resolve, reject) => {
    const body = new PassThrough(); const chunks = [];
    body.on("data", chunk => chunks.push(chunk));
    body.once("end", () => { clearTimeout(deadline); resolve(Buffer.concat(chunks).toString()); });
    body.once("error", reject);
    let stream;
    const deadline = setTimeout(() => { stream?.abort(); reject(new Error("SSR did not resolve its lazy views.")); }, 5000);
    stream = renderToPipeableStream(React.createElement(Component, props), {
      onAllReady() { stream.pipe(body); }, onError(error) { clearTimeout(deadline); reject(error); },
    });
  });
}

for (const initialDashboard of [false, true]) test(`real React streaming SSR resolves the ${initialDashboard ? "Dashboard" : "public homepage"} without client-only content`, async () => {
  const load = createProductionTsLoader({ mocks: { "./download-artifacts.json": JSON.parse(readFileSync(new URL("lib/download-artifacts.json", website), "utf8")) } });
  const { PassWiselySite } = load(fileURLToPath(new URL("app/PassWiselySite.tsx", website)));
  const html = await render(PassWiselySite, { initialDashboard });
  assert.equal([...html.matchAll(/<main(?:\s|>)/g)].length, 1);
  assert.doesNotMatch(html, /正在加载控制台|Loading dashboard|Switched to client rendering/);
  if (initialDashboard) {
    assert.match(html, /Dashboard/);
    assert.match(html, /aria-label="统计期间"/);
    assert.match(html, /\/api\/download\/mac-x64/);
  } else {
    assert.match(html, /每一场面试，都机灵地通过/);
    assert.match(html, /隐身 AI，助力你拿下/);
    assert.match(html, /捕捉问题/);
    assert.match(html, /购买月包/);
  }
});

test("the compiled anonymous homepage omits Dashboard/QR JS while retaining SSR styles", () => {
  const manifest = JSON.parse(readFileSync(new URL("dist/client/.vite/manifest.json", website), "utf8"));
  const closure = new Set();
  function visit(key) { if (closure.has(key)) return; closure.add(key); for (const dependency of manifest[key].imports || []) visit(dependency); }
  visit("virtual:vinext-app-browser-entry"); visit("app/PassWiselySite.tsx");
  const dashboard = "app/dashboard/Dashboard.tsx";
  const qr = Object.keys(manifest).find(key => key.includes("qrcode.react") && key.endsWith("/index.js"));
  assert.ok(manifest[dashboard]?.isDynamicEntry); assert.ok(qr);
  assert.ok(manifest["app/PassWiselySite.tsx"].dynamicImports.includes(dashboard));
  assert.ok(manifest["app/PassWiselySite.tsx"].dynamicImports.includes(qr));
  assert.ok(!closure.has(dashboard)); assert.ok(!closure.has(qr));
  const eagerCss = new Set([...closure].flatMap(key => manifest[key].css || []));
  const styles = [...eagerCss].map(css => readFileSync(new URL(`dist/client/${css}`, website), "utf8")).join("\n");
  assert.match(styles, /\.pd-app/);
});
