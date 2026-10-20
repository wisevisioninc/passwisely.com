# 中文转录回放样本

`transcripts.zh-CN.json` 是合成的 Recall SDK 事件样本，共 4 组场景、5 句完整话语；不是实际采集或厂商转录结果，不含用户录音或 Key。

覆盖日期、小数、普通话、中英技术词、独立标点、连续汉字，以及同时间戳下系统声音与麦克风的来源隔离。临时文本与最终文本使用同一话语标识；重复 final 和迟到 partial 应被丢弃。系统声源对应左侧气泡，麦克风对应右侧气泡，但来源不证明说话者身份。

运行回归：

```sh
node --test desktop-api/tests/recall-chinese-fixtures.test.mjs
```

测试调用生产 `createRecallTranscriptNormalizer()`，按 `receivedAt` 顺序逐个传入 `replay[].event`，与 `expected` 对照；`expected: null` 表示应忽略。每组使用新的 normalizer，组内话语的 `id` 必须从 partial 延续到 final。

`expectedFinalCharacters` 是显示文本的字符级标准：连续汉字和数字日期之间不硬插空格，独立 Latin 技术词保留可读间隔，标点前不增加空格。它不要求真实 ASR 厂商将口述数字、大小写和标点格式化得完全相同。

真实采集时可朗读 `spokenScript` / `spokenScripts`，另存独立运行记录，记录版本、选择的识别 profile、实际 partial/final 文本与时间戳、音源及明确失败。不覆盖本固定样本，不把回放通过记成识别准确率、来源识别或延迟实测。中文 Deepgram 模式需要先在 Recall 日本项目配置自己的 Deepgram Key、Project ID 及默认凭据；不要把 Key 写入测试目录。

Recall 内置中文是分钟级实验模式；这些离线样本不证明该模式在 Desktop SDK 上已能真实工作，也不证明 Nova-3 支持中英自动切换。

## 准备 Mac 中文合成音频

在源码根目录执行（仅生成文件，不播放、不录音、不调用网络服务）：

```sh
python3 test/audio/recall-chinese/prepare_audio.py
```

脚本只读取固定样本的 `spokenScript` / `spokenScripts`，使用本机 `/usr/bin/say -v Tingting -r 150` 合成 AIFF，再以 `/usr/bin/afconvert` 转为 PCM WAV。需要本机已有 Tingting 声音；脚本不下载声音、不安装软件。每句独立保存，生成 `manifest.json`、`diagnostics.jsonl` 和含独立音频控件的 `player.html`，页面不会自动播放。

默认输出 `test/audio/recall-chinese/generated/`。若目录已存在，脚本拒绝覆盖；重新准备时指定一个新的输出目录。失败时保留已生成文件、中间文件和诊断，不能把失败运行记成已完成：

```sh
python3 test/audio/recall-chinese/prepare_audio.py --output /private/tmp/passwisely-chinese-audio-run2
```

需要浏览器访问时，只服务生成目录（端口按需选择）：

```sh
python3 -m http.server 8772 --bind 127.0.0.1 --directory test/audio/recall-chinese/generated
```

打开 `http://127.0.0.1:8772/player.html` 后由测试者明确点击各句播放。不要把服务根目录设为整个源码仓库。`generated/` 与 `results/` 已忽略，避免提交音频和实测结果；`--output` 指向其他位置时由调用者管理。合成音频的语调不等于真人录音，只有完成实际采集、转录与对照后才能报告 ASR 结果。

播放器中的所有 WAV 都是系统音频输入；文件名里的 `microphone` 只是原始回放场景标签，播放该文件不能证明麦克风采集正确。验证麦克风时应停止播放器，再对着 Mac 麦克风朗读固定话语，并单独记录结果。

Deepgram 凭据需要在与服务端 Recall Key 相同的日本区 workspace 中登记并保存为 default；仅向 Wise 的环境文件添加 `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` 不会自动配置 Recall。Host 留空使用默认 Deepgram 服务；修改区域需另外验证 Recall 的兼容性。参见 [Recall Deepgram 配置](https://docs.recall.ai/docs/deepgram)。

## Mac 实测记录

[2026-10-20 Mac 中文实时转录验证](reports/mac-2026-10-20.md) 保留本轮系统声音、默认 AirPods 麦克风、临时文本替换和暂停恢复的实际结果。金额、中英技术词及真人标准句仍有错误；该记录不等于准确率验收通过。
