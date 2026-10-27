# English synthetic Deepgram attempt — 2026-10-27

**Blocked before provider access.** One authorized formal attempt was made for `deepgram-en`; the SSH connection to the existing credential owner timed out at port 22 with exit code **255** and a 10-second connect timeout. The remote mint script did not execute. No temporary JWT was issued, no Deepgram WSS connection opened, and no audio was sent. No alternate route, account, credential or retry was used.

This report is a network-blocker record, not an English ASR result. The existing [Chinese synthetic WSS result](2026-10-27-direct-deepgram-synthetic.md) remains a separate successful protocol observation and does not establish this English case.

## Prepared synthetic input

A read-only local voice inventory listed the already installed **Samantha en_US** voice. The first sandboxed file-synthesis command returned empty output; it was rejected locally before any provider request. Running the explicitly authorized host TTS file operation produced nonempty AIFF files with `/usr/bin/say -v Samantha -r 150 -o ... -f ...`. `/usr/bin/afconvert` converted them to mono 16 kHz signed 16-bit little-endian WAV. No voice was downloaded. Audio was neither recorded nor played.

| Assigned synthetic route | Authored sentence | Duration | Converted WAV SHA-256 |
| --- | --- | ---: | --- |
| synthetic-system-route | The blue notebook costs twenty dollars. | 2.331 s | `565f65119f406ac14ef9210f6bd6e7aaaa02fc9e6a0cef0abc9a6afafa8c8619` |
| synthetic-microphone-route | Use binary search and check both boundaries. | 2.800 s | `389c12f36ee4ac130987518ec138b043572d8b3200691d4c441a66b705021d49` |

These labels describe the intended file routes only. They do not prove microphone or system-audio capture. The generated files and sanitized attempt JSON remain in a private temporary directory, not Git.

## Measurements

| Item | Observed result |
| --- | --- |
| Formal attempts | 1 |
| Remote grant requests executed | 0 |
| WSS connections opened | 0 |
| Audio bytes sent | 0 |
| Interim/final ASR text | Not observed |
| ASR word entries or latency | Not measured |
| Pause / KeepAlive / Finalize / CloseStream | Not exercised |
| WER or other error rate | Not measured |

The token output file was removed by the attempt's exit cleanup and was confirmed absent. No long-lived key left the credential owner; no credential value, real account or authorization header is included here. No server configuration, file, deployment or billing-item changes were made.

## Harness and next validation boundary

The reusable harness's protocol remains unchanged. Its safe report metadata now records the validated session's public `transcriptionProfile`, `language` and `model`, so an English session is not described as Mandarin. Syntax, scoped ESLint and diff checks passed for this metadata/documentation change. These checks do not substitute for the blocked live test.

A future English provider test requires renewed authorization after the network blocker clears. It should use the already prepared files, `deepgram-en`, the same fixed official endpoint and the same bounded pause/finalize procedure. This run does not verify native helper behavior, Electron, macOS permissions, signed/notarized Intel packaging, physical source attribution, English recognition quality or an actual WSS session.

Sanitized attempt JSON SHA-256: `133e07af12a459315bd5c667ab1a358a607847903053b49f1cb8a8edeb1b672f`.
