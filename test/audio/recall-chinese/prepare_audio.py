#!/usr/bin/env python3
"""Prepare local macOS TTS clips; never plays, records, or requests a network service."""

import argparse
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import wave


HERE = Path(__file__).resolve().parent


def write_new(path, text):
    with path.open('x', encoding='utf-8') as handle:
        handle.write(text)


def utterances(fixture):
    result = []
    identities = set()
    for case in fixture['cases']:
        scripts = case.get('spokenScripts') or [{'text': case['spokenScript']}]
        for script in scripts:
            identifier = case['id'] + ('-' + script['source'] if script.get('source') else '')
            if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', identifier) or identifier in identities:
                raise ValueError('invalid or duplicate utterance ID: ' + identifier)
            text = script['text']
            if not isinstance(text, str) or not text.strip():
                raise ValueError('empty spoken script: ' + identifier)
            identities.add(identifier)
            result.append({'id': identifier, 'text': text, 'source': script.get('source')})
    return result


def prepare(output):
    clips = utterances(json.loads((HERE / 'transcripts.zh-CN.json').read_text(encoding='utf-8')))
    output.mkdir(mode=0o700)  # Existing directories are rejected, including failed runs.
    work = Path(tempfile.mkdtemp(prefix='.prepare-', dir=output))
    log_path = output / 'diagnostics.jsonl'
    with log_path.open('x', encoding='utf-8') as diagnostics:
        def run(command):
            result = subprocess.run(command, capture_output=True, text=True, timeout=60)
            diagnostics.write(json.dumps({'command': command, 'exitCode': result.returncode,
                                           'stdout': result.stdout, 'stderr': result.stderr}, ensure_ascii=False) + '\n')
            diagnostics.flush()
            if result.returncode:
                raise RuntimeError('command failed; see diagnostics.jsonl: ' + command[0])
        try:
            for index, clip in enumerate(clips, 1):
                text_file = work / ('%02d.txt' % index)
                aiff_file = work / ('%02d.aiff' % index)
                wav_name = '%02d-%s.wav' % (index, clip['id'])
                wav_file = output / wav_name
                write_new(text_file, clip['text'] + '\n')
                if wav_file.exists():
                    raise FileExistsError(str(wav_file))
                run(['/usr/bin/say', '-v', 'Tingting', '-r', '150', '-o', str(aiff_file), '-f', str(text_file)])
                run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16', str(aiff_file), str(wav_file)])
                with wave.open(str(wav_file), 'rb') as audio:
                    if audio.getnframes() == 0:
                        raise ValueError('empty WAV: ' + wav_name)
                    clip.update({'file': wav_name, 'durationSeconds': audio.getnframes() / audio.getframerate(),
                                 'sampleRate': audio.getframerate(), 'channels': audio.getnchannels()})
                print('[%d/%d] %s' % (index, len(clips), wav_name), flush=True)
            manifest = {'schemaVersion': 1, 'kind': 'synthetic-macos-tts', 'voice': 'Tingting', 'rate': 150,
                        'createdAt': datetime.now(timezone.utc).isoformat(), 'realASRVerified': False, 'clips': clips}
            write_new(output / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            rows = []
            for clip in clips:
                rows.append('<section><h2>%s</h2><p>%s</p><audio controls preload="none" src="%s"></audio></section>' %
                            (html.escape(clip['id']), html.escape(clip['text']), html.escape(clip['file'], quote=True)))
            page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PassWisely 中文合成音频</title><style>body{max-width:900px;margin:32px auto;padding:0 24px;font:18px/1.6 system-ui}section{margin:24px 0;padding:16px;border:1px solid #ccc;border-radius:12px}h2{font-size:16px}audio{width:100%}</style>
<h1>中文合成音频样本</h1><p>Tingting · 语速 150；每句独立播放。此页不会自动播放，不代表真实 ASR 验证结果。</p>''' + '\n'.join(rows) + '</html>\n'
            write_new(output / 'player.html', page)
        except Exception as error:
            diagnostics.write(json.dumps({'errorType': type(error).__name__, 'error': str(error),
                                           'workingDirectoryRetained': str(work)}, ensure_ascii=False) + '\n')
            diagnostics.flush()
            raise
    shutil.rmtree(work)  # Remove only this run's private intermediate files on success.
    return output / 'player.html'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HERE / 'generated', help='new output directory; an existing path is never overwritten')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    try:
        player = prepare(output)
    except Exception as error:
        print('Audio preparation failed: %s\nExisting output was preserved. Use a new --output path for another run.' % error, file=sys.stderr)
        return 1
    print('Prepared without playback: ' + str(player))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
