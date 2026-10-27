/** Optional real Chromium regression: node website/tests/verify-lazy-failures.mjs
 * Uses the existing Electron binary with a temporary isolated profile and a hidden
 * window. All lazy failures are synthetic; network access is denied in Chromium.
 * No installation, production bindings, providers, payment, or audio is involved.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const website = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "passwisely-lazy-rejection-browser-"));
await build({ entryPoints: [path.join(website, "tests/fixtures/lazy-import-failure.tsx")], outfile: path.join(temporary, "test.js"), absWorkingDir: website, bundle: true, format: "iife", platform: "browser", jsx: "automatic", target: "es2022", define: { "process.env.NODE_ENV": '"production"' } });
await writeFile(path.join(temporary, "test.html"), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'unsafe-inline\'; connect-src \'none\'"></head><body><button id="outside">Existing page control</button><div id="root"></div><script src="./test.js"></script></body></html>');
const main = `const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL } = require('node:url');
app.setPath('userData', path.join(__dirname, 'profile')); app.setName('PassWiselyLazyViewVerification');
const results = []; let deadline;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') }));
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  for (const kind of ['dashboard', 'qr']) for (const locale of ['zh', 'en']) {
    const result = await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Browser verification timeout')), 15000);
      const listener = (_event, _level, message) => {
        if (!message.startsWith('PW_LAZY_RESULT:')) return;
        clearTimeout(deadline); window.webContents.removeListener('console-message', listener); resolve(JSON.parse(message.slice('PW_LAZY_RESULT:'.length)));
      };
      window.webContents.on('console-message', listener);
      const url = pathToFileURL(path.join(__dirname, 'test.html')); url.searchParams.set('kind', kind); url.searchParams.set('locale', locale);
      window.loadURL(url.href).catch(reject);
    });
    results.push(result); if (!result.ok) throw new Error(result.error);
  }
  fs.writeFileSync(path.join(__dirname, 'receipt.json'), JSON.stringify({ realReactDOM: true, realChromium: true, hiddenWindow: true, isolatedProfile: true, networkDenied: true, results }, null, 2)+'\\n');
  app.exit(0);
}).catch(error => { clearTimeout(deadline); fs.writeFileSync(path.join(__dirname, 'failure.json'), JSON.stringify({ error: error.message, results }, null, 2)); app.exit(1); });`;
await writeFile(path.join(temporary, "main.cjs"), main);
const electron = require("electron");
const result = await new Promise(resolve => {
  const child = spawn(electron, [path.join(temporary, "main.cjs")], { cwd: temporary, env: { PATH: process.env.PATH || "/usr/bin:/bin", TMPDIR: temporary, LANG: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); }); child.stdout.resume();
  const deadline = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2000).unref(); }, 75000);
  child.once("error", error => { clearTimeout(deadline); resolve({ exitCode: null, error: error.message }); });
  child.once("exit", (exitCode, signal) => { clearTimeout(deadline); resolve({ exitCode, signal, ...(exitCode === 0 ? {} : { stderr }) }); });
});
const receipt = path.join(temporary, result.exitCode === 0 ? "receipt.json" : "failure.json");
console.log(JSON.stringify({ temporary, receipt, ...result }));
if (result.exitCode !== 0) process.exitCode = 1;
else {
  try { console.log(await readFile(receipt, "utf8")); }
  catch { console.log(await readFile(path.join(temporary, "failure.json"), "utf8")); process.exitCode = 1; }
}
