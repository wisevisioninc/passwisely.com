# PassWisely

PassWisely is an Electron desktop assistant for live conversation transcription, screenshots, text questions, and streaming AI answers. Programming solutions and the resume workspace remain available. Recall audio capture supports Apple Silicon macOS 14.2+ and Windows x64; Intel Mac and Linux can use the other workspaces but cannot start Recall capture.

## Live conversation workspace

The default workspace provides explicit **Start / Pause / Resume / End** controls. Starting requests microphone, system-audio and accessibility permissions on supported Macs, obtains a short-lived upload token from the authenticated website, then initializes `@recallai/desktop-sdk` 2.0.39. Recording is shown as active only after the SDK confirms it. Audio is sent and stored in your Recall project for real-time ASR; no audio starts automatically. SDK diagnostic telemetry is explicitly disabled (`telemetryMode: "off"`).

Speech recognition is selected independently from the AI answer language in Settings → AI Settings · Language → Speech. The default remains Recall's built-in English low-latency ASR (`recall-en`). Chinese real-time transcription uses Deepgram Nova-3 with `language: zh` (`deepgram-zh`). Save the speech preference separately; it applies to the next new session, while pause/resume preserves the current session's configuration. A Chinese failure never silently falls back to English. Recall's built-in Chinese accuracy profile (`recall-zh`) is a minute-scale experimental option whose Desktop runtime output has not been verified. System audio and microphone transcripts have separate source labels. Interim text updates in place, final text replaces it, and unknown sources remain unknown. Labels describe the audio source, not verified speaker identity. Pause retains the session; End retains its text for follow-up questions. A failed native shutdown retains ownership and offers cleanup retry instead of starting another capture process.

Ask AI combines a snapshot of final transcripts, the current typed question, selected queued screenshots, and up to four completed answer turns. Any of text, screenshots, or final transcript is sufficient. Responses stream as ordinary text and can include code; they do not require the programming workspace's JSON format. Stop generation preserves its preview and does not stop audio. New sessions reject late events from previous recordings or answers. Screenshot attachments remain queued until explicitly removed and can be reused.

The transcript retains at most 500 segments / 128 KiB of serialized data; text context is limited to 64 KiB before images. Older content can be omitted with an explicit notice. Partial, cancelled, failed and incomplete answers are not treated as completed history. Session text and answers are held in memory; they are not a durable local recording archive. The website's existing model usage/credit accounting applies to answers; Recall charges are billed to the configured Recall project, with no new duration-based PassWisely ASR credit policy in this change.

Configure the website **on the server only**:

```dotenv
RECALL_API_KEY=your-own-recall-project-key
RECALL_API_REGION=ap-northeast-1
```

Supported region values are `us-west-2`, `us-east-1`, `eu-central-1`, and `ap-northeast-1`. The region must match the key's project. The authenticated `POST /api/desktop/recall/upload-token` accepts a session UUID and an optional `transcriptionProfile` chosen from `recall-en`, `deepgram-zh`, or `recall-zh`. Omission preserves the English default. Clients cannot supply arbitrary provider options, server keys, or URLs. The response echoes the profile, and Chinese sessions reject an omitted or mismatched profile before native capture. Reusing the same user/session with a different configuration conflicts within the cache lifetime. Upload creation is bounded and retries for the same user/session reuse a short-lived result within one worker; this cache is not shared across instances or restarts.

For Chinese realtime ASR, add a Deepgram API Key and matching Project ID to the transcription dashboard of the **same Recall region and workspace** as the server key, and mark the saved credential as Default. Use a Member, Admin, or Owner key; leaving Host blank uses Recall's default Deepgram service. Merely placing `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` in a Wise environment file does not register them with Recall. See [Recall Deepgram setup](https://docs.recall.ai/docs/deepgram).

Audio travels from the native SDK to Recall and transcripts return through its callback; Wise does not proxy raw audio. Wise's authenticated route requests a short-lived upload token from Recall, which issues the token. Wise continues to relay model requests when using its default model key. A personal Kimi key retains direct model requests.

In the conversation workspace `Command/Ctrl + Enter` asks AI using the current draft, and `Command/Ctrl + R` clears only answers. Screenshot and visibility shortcuts remain available. Switching to Programming restores the existing solve/debug workflow. The interface follows observed SystemContainer session interactions using an independent implementation; no SystemContainer code, credentials, or binaries are included.

Official integration references: [audio-only](https://docs.recall.ai/docs/audio-only), [supported platforms](https://docs.recall.ai/docs/dsdk-supported-platforms), [real-time transcription](https://docs.recall.ai/docs/dsdk-realtime-transcription).

## Requirements

- Node.js 20.9 or newer
- npm 10 or newer
- An API key for at least one supported AI provider
- macOS: Screen Recording permission for PassWisely

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
# Run on macOS; produces x64 and arm64 DMG/ZIP artifacts.
export APPLE_TEAM_ID=VFF94RK9TN
export APPLE_KEYCHAIN_PROFILE=passwisely-notary
export CSC_NAME="<installed Developer ID Application certificate SHA-1>"
export MACOS_SIGNING_IDENTITY="$CSC_NAME"
npm run dist:mac -- --publish never -c.forceCodeSigning=true -c.dmg.writeUpdateInfo=false

# Run on Windows; produces the x64 NSIS installer.
npm run dist:win
```

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
3. Build the Windows x64 installer and both macOS architectures.
4. Sign macOS artifacts with Developer ID, notarize them, staple the Apple
   tickets, and verify them with `codesign`, `spctl`, and `stapler`.
5. Upload the three installers to
   `oss://passwisely-releases-prod/releases/<version>/` and set only those
   installer objects to `public-read`.
6. Update both the application download route and the Nginx fallback redirects
   to the new immutable OSS version path.
7. Synchronize local, GitHub, and wise, deploy the website, then verify each
   public download URL, checksum, size, and installer signature.

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
