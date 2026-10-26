# Intel Mac v2.0.0 release verification

Verified on 2026-10-26. Desktop source commit: `28aa7abd4a65627f997f2f1f7e48f15b18e08a1a`.

- Installer: `PassWisely-macOS-x64.dmg`, 119,500,997 bytes.
- SHA-256: `e30dc451454880f4115ee25b6760dd7299f50f970e64061faa0bf59699325ae2`.
- Public immutable object: <https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v2.0.0/r3/PassWisely-macOS-x64.dmg>.
- OSS uploader verified the full public response length and SHA-256 after upload.
- App Info.plist short/build versions and packaged ASAR version: `2.0.0`.
- 16 Mach-O leaves: pure `x86_64`; all 25 code/bundle signature targets verified with Team `VFF94RK9TN`, Developer ID, hardened runtime and trusted timestamp.
- App and DMG: strict codesign verification, stapler validation and Gatekeeper acceptance as Notarized Developer ID passed. DMG `hdiutil verify` passed.
- The DMG was mounted read-only; all 214 contained App files/links matched the signed build. The owned image was detached successfully.

## Runtime scope

An actual Intel Electron process ran under Rosetta on Apple Silicon (`process.arch=x64`, Electron 29.4.6, Node 20.9.0). The packaged Canvas 0.1.100 x64 native library produced the expected RGBA pixel and PNG. Packaged PDF.js 4.10.38 extracted the exact text `Intel smoke PDF` from a synthetic one-page PDF. No Recall module, GUI or model request was started; network calls were disabled for this smoke test.

This does not establish physical Intel hardware acceptance or a complete GUI/AI workflow. PDF.js reported missing Node/graphics polyfill and standard-font warnings; PDF text extraction passed, rendering was not verified. Recall Desktop SDK 2.0.39 has no supported Intel Mac runtime; this installer explicitly excludes live system/microphone audio and advertises that limitation.

## Repeatable source checks

- `node --test desktop-api/tests/macos-intel-package.test.mjs`: 16 passed.
- Recall capture and macOS release regression: 46 passed.
- Canonical website regression: 237 passed.
- Download-only web release based on active `d48cc7d`: 217 passed; fixed source `ec04e55eed7ded9892849dd931eee68269a9d52f`. Only Alipay remains enabled for new checkouts.
- Browser preview on this Apple Silicon Mac recommended the Apple package while keeping fixed Intel/Windows links. Unknown hints retain both manual Mac choices. No physical Intel browser was available.

Raw local reports are retained under `/private/tmp/passwisely-intel-v2.0.0-20261026-k35xc5iv`, `/private/tmp/passwisely-intel-rosetta-smoke-49oIsm`, and `/private/tmp/passwisely-intel-dmg-verification-icpcz86b`. They are verification artifacts, not committed installers or credentials.
