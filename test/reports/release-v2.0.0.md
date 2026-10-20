# PassWisely v2.0.0 release verification

## Scope

Mac Apple silicon and Windows x64 share Recall V2 system/microphone capture, real-time transcription, interim/final source labels, pause/resume, transcript/screenshot/manual-question context, streaming answers, language catalogs and overlay UI. Windows shortcut labels use Ctrl/Alt. Intel Mac remains v1.2.6 without live audio because the installed Recall native Mac binary is arm64-only.

## Source checks

- Node 24 source regression: 324/324 passed (desktop-api tests plus Recall upload-token and OSS download tests).
- Renderer and Electron TypeScript checks passed.
- Windows mock tests verify production call paths only, not native device or foreground behavior.

## Package evidence

- Mac app source: `b0fccf06c82cf18258e08509642e8298fac88b25`; subsequent Windows workflow and website-only changes do not change app source.
- Mac ARM64: Developer ID team `VFF94RK9TN`; 132 code targets with trusted timestamps/hardened runtime; App and DMG notarized/stapled; mounted App accepted by Gatekeeper and ASAR matches the build.
- Mac DMG: 159715773 bytes, SHA-256 `dcff124dcbf13c9e8583cae138185bb9f44261987e42d820ca8684f3ec08ead7`.
- Windows x64 source: `23d2c68592ed88d9d944056af0623572e4f29943`; [native CI run](https://github.com/yejinchen-ai/passwisely/actions/runs/39412354088) succeeded in 4m51s. Real NSIS per-user installation, installed Electron/Recall dependency import, uninstallation and payload removal passed. App and installer Authenticode statuses are NotSigned.
- Windows EXE: 123193124 bytes, SHA-256 `0623c1728224396c84c5d05276ebfa07233924c983c290ec07b16f468fdc211a`.
- GitHub artifact archive SHA-256 matched the UI digest; every listed artifact digest/size matched the downloaded files.
- Download notice targeted tests: 7/7 passed after adding the Windows limitation notice.

Detailed bounded evidence: [Mac bundle](releases/2.0.0/mac-bundle.json), [Mac installers](releases/2.0.0/mac-artifacts.json), [Windows CI](releases/2.0.0/windows-ci.json).

## Publication status

Final installers are built and verified. OSS uploads, public full-content hash verification and production activation are pending the publishing credentials. The existing website/downloads have not been switched. Publish only final installers; the unused DMG update sidecars were generated before final signing/stapling and must not be distributed.

## Native verification limits

Mac audio, Chinese ASR, controls, language persistence and body click-through have prior recorded tests. In one user-operated Feishu whole-screen-share configuration both the previous PassWisely build and SystemContainer were absent at the receiving device while the underlying clock updated. This does not establish universal capture exclusion.

Windows device capture/ASR, actual mouse forwarding, ordinary toolbar foreground activation and meeting capture behavior require interactive Windows verification. Packaged Electron import checks do not prove these behaviors. No Windows publisher certificate is currently confirmed; an unsigned installer must be identified as such.
