import { readFile } from "node:fs/promises";
import ts from "typescript";

// Production uses Node 22, which does not load TypeScript by default. Read the
// dependency-free owner instead of maintaining another live-test model string.
const source = await readFile(new URL("../../../shared/kimi.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const owner = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
export const KIMI_DEFAULT_MODEL = owner.KIMI_DEFAULT_MODEL;
export const KIMI_MODEL_IDS = owner.KIMI_MODEL_IDS;
