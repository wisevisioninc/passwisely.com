import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

/** Load production TypeScript/TSX and its relative dependencies. The caller
 * chooses the source entry; no substitute normalizer/projector is supplied.
 * CSS is a non-executable browser asset; these controller tests do not render it.
 */
export function createProductionTsLoader({ mocks = {}, console: consoleOverride = console, env } = {}) {
  const modules = new Map();
  const processBoundary = env === undefined ? process : { ...process, env };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    modules.set(filename, module);
    const require = createRequire(filename);
    new Function("require", "module", "exports", "console", "process", javascript)(id => {
      if (id in mocks) return mocks[id];
      if (id.endsWith(".css")) return {};
      if (!id.startsWith(".")) return require(id);
      const base = path.resolve(path.dirname(filename), id);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      if (!dependency) throw new Error(`Production dependency not found: ${base}`);
      return load(dependency);
    }, module, module.exports, consoleOverride, processBoundary);
    return module.exports;
  }
  return load;
}
