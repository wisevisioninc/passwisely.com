# Startup permission check — 2026-11-01

Changed on top of `c482af5` without changing website, provider configuration or released installers.

## Behavior

- One query-only startup decision per main-process lifetime, cached as success or failure. A new process checks again. Renderer effect replay does not repeat the startup IPC.
- Prompt only for a current, known missing supported screen, microphone or required accessibility permission. Fully granted, unknown, unavailable and unsupported states alone stay silent. Retained system-audio results never stand in for a fresh OS query.
- Startup does not invoke screenshot probes, permission requests, audio preparation, recording, settings navigation or marker-file writes. Existing acknowledgement files are ignored and preserved.
- Settings and confirmed capture-denial recovery still open a fresh manual panel. Refresh on actual departure/return only while open; initial focus and paired focus/visibility events do not add duplicate reads. Dismissal cannot be undone by late startup or request results.
- A failed startup snapshot does not terminate the app or trigger repeated startup OS reads. Manual checks can recover independently. Known missing screen permission followed by a grant retains the restart recommendation.
- Shortened copy includes “需要授权”, “用于截图提问。”, “去授权”, “稍后设置”; manual management uses “权限设置” and “完成”. Historical audio grants remain labeled “上次已授权”.

## Executed validation

- Full local desktop regression: **431 passed, 0 failed, 0 skipped**, 22.25 seconds (one completed run). Command: `node --test desktop-api/tests/*.test.mjs` with Node 24.22.1. Includes 20 permission-owner/IPC tests and 22 production permission-component/App/Settings tests.
- Frontend and Electron TypeScript: `tsc --noEmit -p tsconfig.json` and `tsc --noEmit -p tsconfig.electron.json`, both passed.
- `git diff --check`, passed. Independent source review resolved startup-failure and screen-regrant findings.
- Actual production TSX rendered in a local browser with React StrictMode and a mocked Electron API. Missing permission opened the concise panel with startup count 1 and fresh-read count 0; granted and unknown startup cases remained closed with count 1. Manual reopening showed “权限设置/完成” and performed a fresh read. Inspected 600 × 720 and 360 × 720 layouts; the list scrolls and footer controls remain available.
- Native side effects were mocked in automated tests and browser checks. No new TCC grant/revocation, real screenshot, recording, provider session or physical Windows/Intel runtime acceptance was performed for this change. The earlier r6 Intel screenshot acceptance remains separately documented.

Reusable native acceptance instructions: `test/permissions/README.md`. At this source-validation checkpoint, the change had not yet been packaged or published. On 2026-11-02, all three v2.0.0 r7 installers were published and the website download routes were independently verified; see [r7 release verification](releases/2.0.0/r7/release-verification.json) for exact artifact identity, executed checks and limitations.
