# Capture permission acceptance cases

Run these against the exact installed candidate and record OS, CPU, version, artifact SHA-256, initial permission state and observed result. These are manual acceptance instructions, not claims that they passed. Source regression lives in `desktop-api/tests/capture-permissions.test.mjs`, `permission-*-ui.test.mjs`, screenshot, visibility, live-session and capture-owner tests.

Use an authored local page and synthetic audio only. Never reset another app's permissions. The installer cannot consent for the user; system prompts are handled by the user after first launch.

| Case | Action | Expected behavior |
| --- | --- | --- |
| Fresh install / first launch | Launch without a guide acknowledgement; do not click any permission action | Guide appears before login, with actual OS facts / unknown / unsupported clearly distinguished. No recording starts. Pure text use remains available. |
| Intel Big Sur screenshot (reported failure) | On macOS 11.7.10, click Screen “测试并申请”; authorize PassWisely in System Preferences → Security & Privacy → Privacy → Screen Recording; quit/reopen if needed. Open a synthetic page and press ⌘H | A selected-display screenshot appears. On failure, preserve backend reason, stage and actual screen status. Big Sur audio unsupported must not disable this screenshot path. Record the entire error if still failing. |
| macOS denied / return | Deny a screen or microphone request, open the provided system settings, change it manually, return via Dock; repeat guide open/close and maximize | Opening settings or dismissing a prompt never means granted. Fresh screen/mic state is re-read. Guide remains compact, workspace geometry remains intact. |
| Apple Silicon audio | Explicitly request audio preparation; approve required microphone, system audio and accessibility prompts; then close guide | Permission preparation alone does not start a recording session or upload audio. System-audio observations carry the last-check time; no SDK acknowledgement is displayed as a grant. |
| Intel audio | On macOS 13+, explicitly check system-audio permissions, then start/pause/resume/end a synthetic bilingual audio session | Real helper permission result is shown. On macOS 11/12 show the macOS 13+ audio requirement while retaining screenshot and text use. |
| Windows x64 | Open guide, test screenshot, open microphone and sound settings; switch the desktop-app microphone privacy setting, return and start a synthetic session | No macOS settings or macOS SDK permission prompts. Windows privacy/device limits remain explicit; screenshot probe never invents a macOS screen grant. |
| Busy / cleanup | While recording, or with a retained cleanup failure, try permission preparation and restart; stop/release before retrying | No competing capture owner; restart and new preparation remain blocked until cleanup. Existing stop/release path stays available. |
| Upgrade / subsequent launch | Continue from guide, quit and launch again; open “截图与语音权限” from Settings | The guide acknowledgement is reused, but is never a permission grant. Guide can be reopened. Screenshot/button/⌘H failures with a confirmed screen denial reopen recovery. |

Record receiver-side sharing separately; these cases do not establish screen-sharing invisibility. Do not claim physical Intel or Windows device acceptance from simulated tests or Mac cross-builds.
