# Intel native audio: direct Deepgram synthetic smoke

`direct-deepgram-smoke.mjs` replays two synthetic speech WAV files to two independent official Deepgram WSS connections. It loads the production `createDeepgramOptions` and `createDeepgramTranscriptNormalizer` through the existing TypeScript test loader and resolves the pinned `ws` 8.22.0 from the repository root. The profile and language come from the validated `NativeCaptureSession` (`deepgram-en`/English or `deepgram-zh`/Chinese), never from filenames; the report records those public session facts.

This does **not** start Electron or a native helper, record a microphone, capture system sound, play audio, request macOS permissions, or verify a packaged Intel app. `synthetic-system-route` and `synthetic-microphone-route` are file-routing labels assigned by the harness. They cannot establish physical source attribution.

Each route sends the whole fixture at media speed, sends `Finalize`, pauses PCM transmission for 12 seconds while sending text `KeepAlive` messages every 3 seconds, begins a new normalizer epoch, replays the same file, finalizes, and sends `CloseStream`. A successful run requires nonempty interim and final output on both routes, no PCM bytes during the pause, both sockets open across the pause, and close code 1000. `from_finalize` is recorded but is not required: Deepgram documents that it may be absent when no significant audio remains buffered. The complete WSS run has a 55-second deadline and bounded cleanup below 60 seconds.

The existing Chinese source fixtures were synthesized locally with macOS Tingting; no user audio is included:

- `03-simultaneous-system-and-microphone-system.wav`: “面试官问：数组可以包含负数吗？”
- `04-simultaneous-system-and-microphone-microphone.wav`: “可以。先处理空数组，再检查左右边界。”

## Run

Use existing runtimes; do not install or upgrade dependencies. Set `NODE_BIN` to the approved Node executable and create a **new** private working directory. Do not place credentials in this repository or print the token file. `mktemp` output is only the directory path.

```sh
SMOKE_DIR=$(mktemp -d /private/tmp/passwisely-native-intel-smoke.XXXXXX)
chmod 700 "$SMOKE_DIR"
umask 077
/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 test/audio/recall-chinese/generated/03-simultaneous-system-and-microphone-system.wav "$SMOKE_DIR/system-16k.wav"
/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 test/audio/recall-chinese/generated/04-simultaneous-system-and-microphone-microphone.wav "$SMOKE_DIR/microphone-16k.wav"
```

For an English run, first inspect the installed voice list with `/usr/bin/say -v '?'` and use an already available Samantha or Alex voice. Do not download a voice. In a new private working directory, generate files without playback and convert them to the same input format:

```sh
/usr/bin/say -v Samantha -r 150 -o "$SMOKE_DIR/system.aiff" 'The blue notebook costs twenty dollars.'
/usr/bin/say -v Samantha -r 150 -o "$SMOKE_DIR/microphone.aiff" 'Use binary search and check both boundaries.'
/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 "$SMOKE_DIR/system.aiff" "$SMOKE_DIR/system-16k.wav"
/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 "$SMOKE_DIR/microphone.aiff" "$SMOKE_DIR/microphone-16k.wav"
```

Verify both WAVs contain nonzero frames before requesting a token. For these English files, change the mint command's final profile argument below to **`deepgram-en`**. The harness does not infer or change the language itself.

With explicit authorization for the credential-owning Wise host, run the mint script through SSH stdin. It reads the existing server `.env.production` using that project's `dotenv` parser, makes one fixed `/v1/auth/grant` request for a 30-second JWT, and writes only the short-lived `NativeCaptureSession` JSON to SSH stdout. The permanent key stays on Wise. The script changes no server files, configuration or deployments; it requires the existing Node and dependencies. Discover the server Node path with a read-only `command -v node` first. Replace both absolute-path placeholders below with the verified paths on the authorized credential owner; no server account names or credential paths are prescribed here. Run the harness immediately after minting, in the same shell command, to avoid expiry during approval or tool delays:

```sh
set -e
umask 077
ssh -o BatchMode=yes -o ControlMaster=no -o ControlPath=none -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 wise \
  'env -i PATH=/usr/bin:/bin /absolute/path/to/node --input-type=module - /absolute/path/to/website/.env.production deepgram-zh' \
  < test/audio/native-intel/mint-wise-token.mjs > "$SMOKE_DIR/token.json"
"$NODE_BIN" test/audio/native-intel/direct-deepgram-smoke.mjs \
  --token-file "$SMOKE_DIR/token.json" \
  --system-wav "$SMOKE_DIR/system-16k.wav" \
  --microphone-wav "$SMOKE_DIR/microphone-16k.wav" \
  --output "$SMOKE_DIR/report.json"
```

The harness requires a regular token file owned by the current user, mode `0600`, in an owned `0700` directory. It unlinks the validated token file immediately after reading it and attempts cleanup on every exit. If minting itself fails or the process is killed before reading, remove only this run's owned token file. Do not retry upstream or approval failures by switching accounts, hosts or credentials.

Only sanitized counters are printed. The private report includes synthetic transcripts, media hashes, normalized row/source identities, control counts, first-result timings from initial PCM transmission, and provider word-entry counts. These counts are **not** billing tokens; timing is fixture-specific and is not an end-to-end hardware capture measurement. Reports and converted WAVs belong in the temporary directory, not Git.

The JWT has Deepgram `usage::write` access to core voice APIs and cannot access Manage APIs; it is not STT/model/session-only authorization. This harness fixes the endpoint and options itself. An open WSS connection may outlive token expiry because Deepgram validates the JWT at connection establishment.

Official protocol references: [token auth](https://developers.deepgram.com/reference/auth/tokens/grant), [streaming STT](https://developers.deepgram.com/reference/speech-to-text/listen-streaming), [KeepAlive](https://developers.deepgram.com/docs/audio-keep-alive), [Finalize](https://developers.deepgram.com/docs/finalize).

## Recorded runs

- [Chinese synthetic WSS result](reports/2026-10-27-direct-deepgram-synthetic.md) records the actual two-route protocol smoke, observed transcripts and timing. The protocol passed; transcription contained errors.
- [English synthetic attempt](reports/2026-10-27-direct-deepgram-english-synthetic.md) records locally synthesized Samantha fixtures and the single connection attempt, blocked by SSH timeout before token minting or WSS; English ASR remains unverified.

Neither run establishes physical capture or a general recognition accuracy claim.
