import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { DeferredViewBoundary } from "../../app/DeferredViewBoundary";

const query = new URLSearchParams(window.location.search);
const kind = query.get("kind") === "qr" ? "qr" : "dashboard";
const locale = query.get("locale") === "en" ? "en" : "zh";
const key = `lazy-failure:${kind}:${locale}`;
const reloading = sessionStorage.getItem(key) === "reloading";
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Timed out waiting for React rendering."); await new Promise(resolve => setTimeout(resolve, 20)); }
}
let calls = 0;
let rejectImport: (error: Error) => void;
const Lazy = React.lazy(() => {
  calls++;
  return reloading ? Promise.resolve({ default: () => <p data-loaded="true">View loaded after document reload</p> }) : new Promise<never>((_, reject) => { rejectImport = reject; });
});
const root = createRoot(document.getElementById("root")!);
const render = (boundaryKey: number) => flushSync(() => root.render(<DeferredViewBoundary key={boundaryKey} kind={kind} locale={locale}><React.Suspense fallback={<p role="status">Loading view</p>}><Lazy /></React.Suspense></DeferredViewBoundary>));
let outsideClicks = 0;
document.getElementById("outside")!.addEventListener("click", () => { outsideClicks++; });
const unexpectedRejections: string[] = [];
window.addEventListener("unhandledrejection", event => { unexpectedRejections.push(String(event.reason)); event.preventDefault(); });

async function verify() {
  render(0);
  if (reloading) {
    await until(() => !!document.querySelector("[data-loaded]"));
    assert(calls === 1, "A new document must invoke a fresh lazy factory.");
    assert(!document.querySelector('[role="alert"]'), "Successful document reload must recover the view.");
    sessionStorage.removeItem(key);
    console.log("PW_LAZY_RESULT:" + JSON.stringify({ ok: true, kind, locale, pendingObserved: true, rejectionCaught: true, repeatedMountRetried: false, surroundingControlOperable: true, documentReloadRecovered: true, unexpectedRejections }));
    return;
  }
  await until(() => !!document.querySelector('[role="status"]'));
  rejectImport!(new Error("Synthetic lazy import rejection; no network request was sent."));
  await until(() => !!document.querySelector('[role="alert"]'));
  const checkRecovery = () => {
    const alert = document.querySelector('[role="alert"]')!;
    const button = alert.querySelector("button")!;
    assert(button.textContent === (locale === "zh" ? "重新加载页面" : "Reload page"), "Recovery must explicitly reload the document.");
    assert(alert.querySelector("a")?.getAttribute("href") === (kind === "qr" ? "/dashboard" : "/"), "Recovery needs a usable account/home link.");
    assert(!alert.textContent?.includes("Synthetic"), "Import diagnostics must not become user-facing copy.");
    if (kind === "qr") assert(alert.textContent?.includes(locale === "zh" ? "避免重复付款" : "before paying again"), "QR recovery must prevent a misleading repeated purchase.");
    else assert(document.querySelectorAll("main").length === 1, "Dashboard error recovery must own one main landmark.");
  };
  checkRecovery();
  document.getElementById("outside")!.click();
  assert(outsideClicks === 1, "Other page controls must survive a local view failure.");
  flushSync(() => root.render(null));
  render(1);
  await until(() => !!document.querySelector('[role="alert"]'));
  checkRecovery();
  assert(calls === 1, "Remounting a rejected React.lazy must not pretend to retry its cached import promise.");
  assert(unexpectedRejections.length === 0, "Rejected imports must stay inside React recovery.");
  sessionStorage.setItem(key, "reloading");
  (document.querySelector('[role="alert"] button') as HTMLButtonElement).click();
}
verify().catch(error => console.log("PW_LAZY_RESULT:" + JSON.stringify({ ok: false, kind, locale, error: error.message })));
