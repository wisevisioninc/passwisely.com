# PassWisely

PassWisely is an Electron desktop assistant for live conversation transcription, screenshots, text questions, and streaming AI answers. Programming solutions and the resume workspace remain available. Recall audio capture supports Apple Silicon macOS 14.2+ and Windows x64. Intel macOS 13+ uses a separate native ScreenCaptureKit / AVAudioEngine capture path with Deepgram realtime ASR; the Recall runtime itself remains unsupported on Intel. Linux has no live audio capture.

## Live conversation workspace

The default workspace provides explicit **Start / Pause / Resume / End** controls. Start immediately opens the conversation panel; pause, resume, end and Start Over retain it. There is no internal Collapse or Expand control; Show/Hide controls visibility of the whole overlay. On the Recall path, starting requests microphone, system-audio and accessibility permissions on supported Macs, obtains a short-lived upload token from the authenticated website, then initializes `@recallai/desktop-sdk` 2.0.39. Recording is shown as active only after the SDK confirms it. Audio is sent and stored in your Recall project for real-time ASR; no audio starts automatically. SDK diagnostic telemetry is explicitly disabled (`telemetryMode: "off"`).

Speech recognition is selected independently from the AI answer language in Settings → Meeting Audio Language (or AI Models & Settings → Speech). The default remains Recall's built-in English low-latency ASR (`recall-en`). Chinese real-time transcription uses Deepgram Nova-3 with `language: zh` (`deepgram-zh`). Save the speech preference separately; it applies to the next new session, while pause/resume preserves the current session's configuration. A Chinese failure never silently falls back to English. Recall's built-in Chinese accuracy profile (`recall-zh`) is a minute-scale experimental option whose Desktop runtime output has not been verified. System audio and microphone transcripts have separate source labels. Interim text updates in place, final text replaces it, and unknown sources remain unknown. Labels describe the audio source, not verified speaker identity. Pause retains the session; End retains its text for follow-up questions. A failed native shutdown retains ownership and offers cleanup retry instead of starting another capture process.

The transcript view groups adjacent snippets from the same owned audio channel and pause/resume epoch when their audio gap is at most 2500ms and their combined length is at most 100 Unicode characters. Partial text still appears immediately. Raw ASR segments remain unchanged for answer context; grouping does not correct recognition errors. The Chinese Deepgram profile requests `endpointing: 500`; see [Deepgram endpointing](https://developers.deepgram.com/docs/endpointing).

On macOS, the translucent transcript/answer body passes mouse input to the app below. Toolbar buttons, tabs, links, copy controls, attachments, resize handles, typed questions and settings retain interaction. Use the [native click-through fixture](test/overlay/README.md) to verify selection and input; DOM-only tests cannot establish cross-window behavior.

Output Language offers the same 22 choices and Code Language the same 16 choices as the inspected SystemContainer 3.0.1 catalog. They affect model instructions independently of the available audio profiles. Code Language is remembered locally and shared by conversation and programming workspaces. Ordinary toolbar actions no longer blur a native panel without an owned keyboard-focus request. See the [controls and language verification report](test/reports/mac-controls-languages-2026-10-20.md) for the native Mac results and reusable regression scope.

The compact gear menu follows the observed SystemContainer layout: output, code and meeting-audio languages, key display mode, conditional multi-display selection, shortcut references and account actions. Keep the PassWisely logo. Output and speech preferences save independently; speech changes apply to the next session and are locked during capture/pause/cleanup. AI Models & Settings opens the existing provider configuration. Compact and advanced editors share one write owner to prevent stale saves across panel changes. See the [comparison and Mac verification report](test/reports/systemcontainer-parity-2026-10-20.md) for evidence and limits.

Ask AI combines a snapshot of final transcripts, the current typed question, selected queued screenshots, and up to four completed answer turns. Any of text, screenshots, or final transcript is sufficient. Responses stream as ordinary text and can include code; they do not require the programming workspace's JSON format. Stop generation preserves its preview and does not stop audio. New sessions reject late events from previous recordings or answers. Screenshot attachments remain queued until explicitly removed and can be reused.

The transcript retains at most 500 segments / 128 KiB of serialized data; text context is limited to 64 KiB before images. Older content can be omitted with an explicit notice. Partial, cancelled, failed and incomplete answers are not treated as completed history. Session text and answers are held in memory; they are not a durable local recording archive. The website's existing model usage/credit accounting applies to answers; Recall charges are billed to the configured Recall project, with no new duration-based PassWisely ASR credit policy in this change.

Configure the website **on the server only**:

```dotenv
RECALL_API_KEY=your-own-recall-project-key
RECALL_API_REGION=ap-northeast-1
```

Supported region values are `us-west-2`, `us-east-1`, `eu-central-1`, and `ap-northeast-1`. The region must match the key's project. The authenticated `POST /api/desktop/recall/upload-token` accepts a session UUID and an optional `transcriptionProfile` chosen from `recall-en`, `deepgram-en`, `deepgram-zh`, or `recall-zh`. Omission preserves the English default. Clients cannot supply arbitrary provider options, server keys, or URLs. The response echoes the profile, and Chinese sessions reject an omitted or mismatched profile before native capture. Reusing the same user/session with a different configuration conflicts within the cache lifetime. Upload creation is bounded and retries for the same user/session reuse a short-lived result within one worker; this cache is not shared across instances or restarts.

For Chinese realtime ASR, add a Deepgram API Key and matching Project ID to the transcription dashboard of the **same Recall region and workspace** as the server key, and mark the saved credential as Default. Use a Member, Admin, or Owner key; leaving Host blank uses Recall's default Deepgram service. Merely placing `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` in a Wise environment file does not register them with Recall. See [Recall Deepgram setup](https://docs.recall.ai/docs/deepgram).

On the Recall path, audio travels from the native SDK to Recall and transcripts return through its callback; Wise does not proxy raw audio. Wise's authenticated route requests a short-lived upload token from Recall, which issues the token. Wise continues to relay model requests when using its default model key. A personal Kimi key retains direct model requests.

### Intel Mac native audio

Intel uses an independently signed `Contents/Resources/audio/PassWiselyAudioHelper` built for x86_64 with the existing Apple Command Line Tools. It captures system audio through ScreenCaptureKit and the default microphone through AVAudioEngine, converts each source separately to 16 kHz mono signed 16-bit PCM, and sends the streams directly to Deepgram over two TLS WebSockets. No Recall native executable is used on this path. macOS 13 or newer and screen/audio plus microphone permissions are required.

The same owned helper completes permission requests and source discovery **before** the authenticated website issues a 30-second connection JWT. Preparation does not record audio. The server-only configuration is `DEEPGRAM_API_KEY`; use a key with Member or higher permissions for Deepgram's grant endpoint. No API key is shipped to the client, and Recall dashboard credentials are not used by this Intel path. `POST /api/desktop/deepgram/token` accepts only a session UUID and `deepgram-en` or `deepgram-zh`. It returns a short-lived usage token for Deepgram core voice APIs; Deepgram does not restrict it to one model, one session or STT alone. The process-local retry/throttle cache is not a durable quota.

Intel Settings exposes Deepgram realtime English and Chinese. Existing Chinese preferences resolve to Chinese without rewriting the saved preference. English uses Nova-3 `language: en`; Chinese uses `language: zh`. The Answer Language setting remains independent. Final/interim segments retain the actual system/microphone source; these labels do not identify the human speaker. Pause stops native input, drains admitted audio and converter tails, and finalizes both ASR streams. Resume keeps the language and separates the next transcript epoch. Stop waits for actual child/socket closure and retains cleanup ownership if that cannot be confirmed. Audio is not written to disk by this helper, and the server does not relay PCM. Deepgram usage is charged to the configured project, with no new PassWisely ASR credit policy.

Reusable native converter/permission/lifecycle tests live in `desktop-api/tests/`; synthetic upstream ASR checks are documented in `test/audio/native-intel/`. Source tests and Rosetta execution do not establish capture on physical Intel hardware. Release-specific capture evidence belongs in the Intel release report before changing the public download capability notice.

In the conversation workspace `Command/Ctrl + Enter` asks AI using the current draft, and `Command/Ctrl + R` clears only answers. Screenshot and visibility shortcuts remain available. Switching to Programming restores the existing solve/debug workflow. The interface follows observed SystemContainer session interactions using an independent implementation; no SystemContainer code, credentials, or binaries are included.

Official integration references: [audio-only](https://docs.recall.ai/docs/audio-only), [supported platforms](https://docs.recall.ai/docs/dsdk-supported-platforms), [real-time transcription](https://docs.recall.ai/docs/dsdk-realtime-transcription).

## Accounts and pricing

| Plan | Price | Credits |
| --- | --- | --- |
| New user trial | ¥0 | 20, once on registration |
| Pro | ¥99/month | 200 per purchase |
| Unlimited | ¥299/month | 1,000 per purchase |

Paid packs are purchased manually, without automatic renewal. Each purchase expires 30 days after its credits first arrive; a new purchase does not extend an earlier pack. “Unlimited” is the plan name, with a 1,000-credit limit per pack. Existing permanent balances and trial credits do not expire. The 20-credit welcome grant applies only to new accounts; existing accounts are not topped up.

The server consumes the earliest-expiring credits first, then permanent credits. Refunds restore the original credit bucket without extending its expiry. Historical pending orders retain the price and permanent-credit entitlement recorded when they were created. See [the website account and payment rules](website/README.md#credit-rules).

## Requirements

- Node.js 20.9 or newer
- npm 10 or newer
- An API key for at least one supported AI provider
- macOS: Screen Recording permission for PassWisely

## Mac window content protection

The native window starts hidden and requests Electron content protection before loading UI. A single owner reapplies it on show, restore and focus. Persistent Show/Hide intent is separate from temporary screenshot suppression: completing or failing a capture releases only its own hold and cannot reveal an explicitly hidden or replacement window. Native restoration failures retain their cleanup owner for retry.

This matches the bounded SystemContainer window-policy evidence; it is not a guarantee of undetectability. ScreenCaptureKit capture, platform focus reports and native application checks are separate behaviors. See [Electron’s documented limitation](https://github.com/electron/electron/issues/48258) and the [versioned privacy test matrix and synthetic fixture](test/privacy/README.md). Each remote platform/configuration requires its own receiver-side evidence.

## Development

```bash
npm ci
npm run dev
```

Use the committed `package-lock.json` and npm dependency layout for desktop packaging. Mixing a pnpm virtual-store installation with npm lockfile detection in electron-builder can omit transitive SDK dependencies from the app. A signed app can still fail before capture if its packaged JavaScript dependencies are incomplete. Chinese replay and generated audio samples are documented in [test/audio/recall-chinese](test/audio/recall-chinese/README.md).

The app opens as a transparent always-on-top window. Open the gear menu, select an AI provider, enter its API key, choose or type a model ID, and save. OpenAI, DeepSeek, Kimi/Moonshot, Doubao/Volcengine Ark, Qwen/DashScope, GLM/Zhipu, Google Gemini, and Anthropic Claude are included. Each provider keeps an independent API key, model, OpenAI-compatible Base URL, and vision setting.

On macOS and Windows, API keys are encrypted using the operating system credential protection API and stored in the app data directory. Existing OpenAI-only settings are migrated automatically. Preset model IDs and endpoints are editable so new models, private gateways, and deployment-specific IDs can be used without an application update.

Programming answers use concise Simplified Chinese in this order: a short approach, time and space complexity, complete runnable code with only key comments, and at most two brief alternative approaches. The model is instructed to check examples, imports, boundaries, and the complexity of its final implementation. Code syntax, identifiers, and necessary technical terms remain in their original language. Other assistant workflows retain the language preference in AI Settings.

Solutions stream from the model through the website SSE relay, desktop gRPC `ChatStream`, and Electron IPC into the answer view. Personal provider connections also stream. The old unary `Chat` RPC remains available for older clients. A newer client only falls back to HTTPS streaming when the server explicitly reports an unsupported RPC before any content; it never restarts a partially received request. Stop, timeout, truncation, and connection errors preserve the preview and mark the code as incomplete.

The 1.2.6 validation measurements and code regression results are recorded in `docs/releases/1.2.6-validation.json`. Public activation uses `website/scripts/activate-streaming-1.2.6.sh` after the signed installers have been uploaded. The script preserves TLS configuration, stages the web bundle, restarts both services, checks health, and retains a rollback copy.

`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_SUPPORTS_VISION`, and `AI_RESPONSE_LANGUAGE` can override the desktop settings for development or managed deployments. Provider-specific environment variables are also supported, including `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `KIMI_API_KEY`, `DOUBAO_API_KEY`, `QWEN_API_KEY`, `GLM_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`. See `.env.example` for a template.

Do not place a real key in source control. Copy `.env.example` to `.env` only for local development. `.env` is never bundled into release packages.

## Usage

- Take screenshot: `Command/Ctrl + H`
- Ask with the current draft/transcript/screenshots in Conversation, or solve/debug in Programming: `Command/Ctrl + Enter`
- Clear answers in Conversation; cancel processing and clear screenshot queues in Programming: `Command/Ctrl + R`
- Show/hide: `Command/Ctrl + B`
- Move window: `Command/Ctrl + Arrow`
- Language: `Alt + P` (Python), `Alt + C` (C++), `Alt + J` (Java)

You can submit a text-only query without taking a screenshot. Up to five screenshots are retained per queue in the application data directory and restored after an app restart.

Screenshot processing requires a vision-capable model. The bundled presets update the vision checkbox when selected; for custom model or deployment IDs, set the checkbox to match the model's actual capabilities. Text-only models such as the default DeepSeek models remain available for typed queries.

## Resume assistant

Open **简历** from the main toolbar to use the resume workspace. It supports:

- Word `.doc`/`.docx`, text-based PDF, HTML/HTM files, and public resume webpage URLs.
- Editable extracted text so PDF line breaks or table extraction can be corrected before analysis.
- Prioritized resume optimization advice with ATS, structure, impact, and rewrite examples.
- One-click generation of a complete optimized resume without inventing candidate facts.
- Targeted interview preparation based on an optional Job Description, including match gaps, likely questions, answer frameworks, review topics, and a seven-day plan.
- Copying the result or saving it as Markdown/text. Original resume files are never overwritten.

Web resume imports are restricted to HTTP/HTTPS public addresses. Localhost, private-network destinations, oversized responses, excessive redirects, and non-HTML/text responses are rejected.

PDF import extracts embedded text and intentionally disables PDF code evaluation. Image-only scanned PDFs should be OCR-processed before upload.

### macOS permission

The first screenshot request may prompt for Screen Recording access. If capture fails, open **System Settings → Privacy & Security → Screen & System Audio Recording**, enable PassWisely, then restart the app.

## Verification and builds

```bash
npm ci
npm run typecheck
npm run build:assets
npm run build:unpacked
```

After packaging a Mac app, check its JavaScript runtime using the packaged
Electron executable on a matching native macOS host:

```bash
node scripts/verify-recall-runtime.cjs "release/mac-arm64/PassWisely.app"
# Substitute the exact .app path being tested.
```

The check resolves the Recall SDK and its `uuid` dependency inside that app's
`app.asar` / `app.asar.unpacked`, rejects external dependency fallbacks, loads the
SDK and checks its init/prepare/start interface without calling those methods.
It uses a fresh minimal child environment, blocks network/native-process attempts
during import and prints only a bounded JSON verdict; SDK logs and ambient
credentials are not forwarded. A missing dependency returns a nonzero exit code.
This manual native-host check is separate from signing, permissions and actual
capture/ASR verification; it is not a cross-architecture afterPack hook.

Platform installers should be created on their native operating system:

```bash
# Run on Apple silicon macOS; Recall SDK 2.0.39 native runtime is arm64-only.
export APPLE_TEAM_ID=VFF94RK9TN
export APPLE_KEYCHAIN_PROFILE=passwisely-notary
export CSC_NAME="<installed Developer ID Application certificate SHA-1>"
export MACOS_SIGNING_IDENTITY="$CSC_NAME"
npm run dist:mac -- --arm64 --publish never -c.forceCodeSigning=true -c.dmg.writeUpdateInfo=false

# Run on Windows; produces the x64 NSIS installer.
npm run dist:win -- --x64 --publish never -c.win.signAndEditExecutable=true
```

Intel v2.0.0 uses `build/electron-builder.mac-x64.cjs`. Compile frontend/Electron
assets with the host development toolchain, then point `directories.app` at a
separate production install created with `npm ci --omit=dev --ignore-scripts
--cpu=x64 --os=darwin`. Copy the compiled assets into that app directory and
remove its `package.json` build field for electron-builder’s two-package mode.
Do not share the ARM development dependency directory with the shipped app.

```bash
npx electron-builder --mac --x64 --publish never \
  --config build/electron-builder.mac-x64.cjs \
  -c.directories.app=/absolute/path/to/isolated-x64-app \
  -c.directories.output=/absolute/path/to/intel-output
```

The profile excludes the ARM-only Recall runtime and checks every native binary
for x86_64, including the unpacked Canvas library used by PDF parsing. The
existing Developer ID and App/DMG notarization hooks remain mandatory. The
profile compiles the native x86_64 audio helper before signing and requires it
in the packaged architecture audit. Recall system/microphone capture remains
unavailable on Intel; native capture provides the separate audio path. See [Intel v2.0.0 release verification](test/reports/release-v2.0.0-intel.md).

macOS packaging normalizes all nested Mach-O signatures, including the Recall
SDK under Resources, before the normal Developer ID signing phase. An ad-hoc
structural signature alone does not establish that hardened-runtime library
validation permits launch. Runtime validation and public distribution use a
Developer ID Application certificate; public artifacts also require notarization.

The release pipeline automatically notarizes and staples the app after a real
Developer ID signature is applied. Configure one of the supported notarytool
credential sets before building:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`
- `APPLE_KEYCHAIN_PROFILE`, plus optional `APPLE_KEYCHAIN`

The DMG hook signs and staples the completed image after electron-builder's
blockmap stage, so the command above disables DMG update metadata. Publish the
final installers only; do not distribute stale DMG blockmaps or update feeds.
The packaged ZIP contains the already notarized and stapled application.

For a manual notarization diagnostic, run:

```bash
APPLE_TEAM_ID=VFF94RK9TN APPLE_KEYCHAIN_PROFILE=passwisely-notary \
  npm run notarize:mac -- release/mac-arm64/PassWisely.app
# For Intel, use release/mac/PassWisely.app.
```

This command requires all application code to have the expected Developer ID,
hardened runtime, and trusted timestamp; it exits unsuccessfully if signature,
notarization, stapling, or ticket validation fails.

Automatic updates are disabled unless `PASSWISELY_UPDATE_URL` points to a generic electron-updater feed.

### Required production release closure

Every user-facing desktop change must complete the entire release chain before
it is considered finished:

1. Run desktop, website, and live account regression tests.
2. Increment the desktop version; never overwrite an existing release path.
3. Build Windows x64, Mac ARM64 and Mac Intel x64 installers with the same desktop version. Use the Intel-specific packaging profile; Intel uses native capture rather than Recall.
4. Sign macOS artifacts with Developer ID, notarize them, staple the Apple
   tickets, and verify them with `codesign`, `spctl`, and `stapler`.
5. Upload the verified platform installers to
   `oss://passwisely-releases-prod/releases/<version>/` and set only those
   installer objects to `public-read`.
6. Update the shared artifact catalog with each verified version, size and SHA-256. Website links and API routes must consume the same owner, including each platform’s live-audio limitation; immutable revisions may differ while the desktop version remains the same.
7. Synchronize local, GitHub, and wise, deploy the website, then verify each
   public download URL, checksum, size, and installer signature.

Windows signing requires its own Authenticode certificate; Mac Developer ID does not sign Windows. See [Windows native validation](test/windows/README.zh-CN.md) and [v2.0.0 release evidence](test/reports/release-v2.0.0.md).

A source change without the packaged artifacts, OSS upload, download mapping,
and production verification is not a completed PassWisely release.

## Supabase Free project health check

The production server runs `website/scripts/supabase-healthcheck.mjs` once per
day from Jerry's crontab. It makes three small authenticated, read-only queries
against existing application tables. This produces real database activity and
checks availability without creating test users or changing business data.

The cron task loads Supabase credentials from `website/.env.production`;
credentials must never be embedded in the crontab or committed. Successful and
failed runs are sent to syslog with the tag `passwisely-supabase-health`.
Supabase only guarantees that paid projects will not be paused for inactivity,
so production should move to Pro when continuous availability is required.

## Operations dashboard

The private operations console is served from
`https://admin.passwisely.com/admin`. Production requires explicit
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` values. The
dashboard combines Beijing-time growth, engagement, AI usage, credit, resume,
revenue, and payment-conversion metrics with live checks for Supabase, the
website, desktop gRPC API, payment configuration, and all three installer
downloads.

Application requests are aggregated into one-minute buckets to report current
and peak QPS, response latency, route volume, and HTTP 5xx rate without storing
IP addresses or request bodies. Website installer clicks are counted per
platform. An hourly bounded-range probe downloads only 256 KB from each OSS
artifact to measure response latency and throughput and estimate completion
time without repeatedly transferring full installers.

The desktop API exposes host resource data only on the loopback-only
`127.0.0.1:3013/health` endpoint. It must not be proxied publicly. Dashboard
data refreshes every 60 seconds while the page is visible.

## Security notes

- Renderer isolation is enabled and Node integration is disabled.
- External navigation is blocked inside the app and HTTP(S) links open in the system browser.
- Screenshot deletion is restricted to PassWisely-owned screenshot directories.
- Resume files are read only after explicit selection, are size-limited, and are converted to plain text before AI processing.
- Public resume URL imports block local and private-network addresses and cap downloaded content at 5 MB.
- Release packages do not contain `.env` files or API keys.
