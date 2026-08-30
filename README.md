# PassWisely

PassWisely is a transparent Electron desktop assistant for capturing a problem, adding a text query, and generating an AI-assisted solution. The same source supports macOS (Intel and Apple Silicon) and Windows (x64 and ARM64).

## Requirements

- Node.js 20.9 or newer
- npm 10 or newer
- An API key for at least one supported AI provider
- macOS: Screen Recording permission for PassWisely

## Development

```bash
npm install
npm run dev
```

The app opens as a transparent always-on-top window. Open the gear menu, select an AI provider, enter its API key, choose or type a model ID, and save. OpenAI, DeepSeek, Kimi/Moonshot, Doubao/Volcengine Ark, Qwen/DashScope, GLM/Zhipu, Google Gemini, and Anthropic Claude are included. Each provider keeps an independent API key, model, OpenAI-compatible Base URL, and vision setting.

On macOS and Windows, API keys are encrypted using the operating system credential protection API and stored in the app data directory. Existing OpenAI-only settings are migrated automatically. Preset model IDs and endpoints are editable so new models, private gateways, and deployment-specific IDs can be used without an application update.

The answer language defaults to Simplified Chinese and can be changed to English in AI Settings. In Chinese mode, explanatory prose and answers are requested in Chinese while code, identifiers, commands, API names, and necessary technical terms may remain in English.

`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_SUPPORTS_VISION`, and `AI_RESPONSE_LANGUAGE` can override the desktop settings for development or managed deployments. Provider-specific environment variables are also supported, including `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `KIMI_API_KEY`, `DOUBAO_API_KEY`, `QWEN_API_KEY`, `GLM_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`. See `.env.example` for a template.

Do not place a real key in source control. Copy `.env.example` to `.env` only for local development. `.env` is never bundled into release packages.

## Usage

- Take screenshot: `Command/Ctrl + H`
- Process screenshots or a text query: `Command/Ctrl + Enter`
- Reset: `Command/Ctrl + R`
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
npm run typecheck
npm run build:assets
npm run build:unpacked
```

Platform installers should be created on their native operating system:

```bash
# Run on macOS; produces x64 and arm64 DMG/ZIP artifacts.
npm run dist:mac

# Run on Windows; produces x64 and arm64 NSIS installers.
npm run dist:win
```

Unsigned macOS builds are ad-hoc signed as a complete bundle so local packages
cannot contain the inconsistent partial signature that macOS reports as
“damaged.” Public distribution still requires a Developer ID Application
certificate and Apple notarization.

The release pipeline automatically notarizes and staples the app after a real
Developer ID signature is applied. Configure one of the supported notarytool
credential sets before building:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`
- `APPLE_KEYCHAIN_PROFILE`, plus optional `APPLE_KEYCHAIN`

For a manual notarization diagnostic, run:

```bash
APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... \
  npm run notarize:mac -- release/mac/PassWisely.app
```

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

## Security notes

- Renderer isolation is enabled and Node integration is disabled.
- External navigation is blocked inside the app and HTTP(S) links open in the system browser.
- Screenshot deletion is restricted to PassWisely-owned screenshot directories.
- Resume files are read only after explicit selection, are size-limited, and are converted to plain text before AI processing.
- Public resume URL imports block local and private-network addresses and cap downloaded content at 5 MB.
- Release packages do not contain `.env` files or API keys.
