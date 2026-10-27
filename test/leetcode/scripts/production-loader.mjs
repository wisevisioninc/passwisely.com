import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

/** Load the desktop TypeScript verbatim; only Electron app metadata is stubbed.
 * The owning empty cwd prevents ProcessingHelper's dotenv.config() from reading
 * a developer's repository .env. It is removed after synchronous module loading.
 */
export function loadProduction(root, log = () => {}) {
  const require = createRequire(path.join(root, "package.json"));
  const ts = require("typescript");
  const modules = new Map();
  const electronRoot = fs.realpathSync(path.join(root, "electron"));
  const sharedRoot = fs.realpathSync(path.join(root, "shared"));
  const appVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const safeConsole = Object.fromEntries(["log", "warn", "error", "info", "debug"].map(level => [level,
    (...items) => log(level, items.map(item => typeof item === "string" ? item : item instanceof Error ? `${item.name}: ${item.message}` : "[structured log omitted]").join(" "))]));
  const load = candidate => {
    const filename = fs.realpathSync(candidate.endsWith(".ts") ? candidate : candidate + ".ts");
    if (![electronRoot, sharedRoot].some(directory => filename.startsWith(directory + path.sep))) throw new Error("Production loader import escaped desktop/shared source directories.");
    if (modules.has(filename)) return modules.get(filename).exports;
    const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    modules.set(filename, module);
    new Function("require", "module", "exports", "__filename", "__dirname", "console", js)(id => {
      if (id === "electron") return { app: { getAppPath: () => root, getVersion: () => appVersion } };
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id));
      return require(id);
    }, module, module.exports, filename, path.dirname(filename), safeConsole);
    return module.exports;
  };
  const previousCwd = process.cwd();
  const neutralCwd = fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-benchmark-loader-"));
  fs.chmodSync(neutralCwd, 0o700);
  try {
    process.chdir(neutralCwd);
    return {
      ...load(path.join(electronRoot, "aiProviders.ts")),
      ...load(path.join(electronRoot, "live", "ConversationContext.ts")),
      ...load(path.join(electronRoot, "ProcessingHelper.ts")),
      ...load(path.join(electronRoot, "live", "LiveSessionService.ts")),
      appVersion,
    };
  } finally {
    process.chdir(previousCwd);
    fs.rmdirSync(neutralCwd);
  }
}
