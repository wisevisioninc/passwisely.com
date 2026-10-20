# PassWisely v2.0.0 release verification

## Scope

Mac Apple silicon and Windows x64 share Recall V2 system/microphone capture, real-time transcription, interim/final source labels, pause/resume, transcript/screenshot/manual-question context, streaming answers, language catalogs and overlay UI. Windows shortcut labels use Ctrl/Alt. Intel Mac remains v1.2.6 without live audio because the installed Recall native Mac binary is arm64-only.

## Source checks

- Node 24 source regression: 324/324 passed (desktop-api tests plus Recall upload-token and OSS download tests).
- Renderer and Electron TypeScript checks passed.
- Windows mock tests verify production call paths only, not native device or foreground behavior.

## Pending release evidence

Package source commit, artifact digests, macOS signature/notarization, native Windows CI package imports, public download verification and production activation will be recorded after execution.

## Native verification limits

Mac audio, Chinese ASR, controls, language persistence and body click-through have prior recorded tests. In one user-operated Feishu whole-screen-share configuration both the previous PassWisely build and SystemContainer were absent at the receiving device while the underlying clock updated. This does not establish universal capture exclusion.

Windows device capture/ASR, actual mouse forwarding, ordinary toolbar foreground activation and meeting capture behavior require interactive Windows verification. Packaged Electron import checks do not prove these behaviors. No Windows publisher certificate is currently confirmed; an unsigned installer must be identified as such.
