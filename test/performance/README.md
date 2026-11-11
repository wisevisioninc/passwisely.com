# PassWisely 性能测试

复用 `test/leetcode` 的冻结 20 题及沙箱判题；本目录新增当前网络探测、三张公开题面截图的生产管线测试和离线汇总。测试不切换 VPN、不更改共享模型、生产配置或价格。真实问答与合成语音识别会消耗测试账号积分及供应商额度。

使用仓库已有依赖和现有 Node。账户令牌由正常登录取得，保存在显式提供的 `0600` JSON 文件 `{"token":"..."}`；不得放入 Git、命令参数值或聊天。脚本不读取应用账户缓存或钥匙串。输出使用全新路径，保留失败记录，不选择最好一次。

```sh
node test/performance/network.mjs --token-file /private/tmp/private-token.json --out /private/tmp/network-NEW.json
node test/leetcode/scripts/run-live.mjs --live --transport grpc --context text --token-file /private/tmp/private-token.json --out /private/tmp/text-NEW
# 正式判题前先运行已有 sandbox_selftest.py，再阅读并按其 README 使用 judge.py。
python3.12 test/leetcode/scripts/judge.py --results /private/tmp/text-NEW --allow-execution
python3.12 test/leetcode/scripts/judge.py --results /private/tmp/text-NEW --allow-execution --boundary
```

`network.mjs` 对 `.cn` 与 `.com` 各测新建连接、复用连接、主页、账户接口及 gRPC Health。每项 3 次新连接、7 次复用连接，合计 60 次。它测量 HTTP 首字节和 gRPC 总耗时，不代表网页渲染或模型首字。

截图测试先用已有本地题面服务为 `pass-the-pillow`、`delete-and-earn`、`minimum-number-of-taps-to-open-to-water-a-garden` 分别保存同名 PNG。仅发送这些公开合成题面；不要混入真实桌面内容。图片必须小于生产单图预算。运行：

```sh
node test/performance/vision.mjs --live yes --token-file /private/tmp/private-token.json --images-dir /private/tmp/public-question-images --out /private/tmp/vision-NEW
```

该脚本调用原生产 `ProcessingHelper` 的截图识题与解题路径，仅用合成窗口提供 Python 语言偏好并观察进度事件。它不测试 macOS 屏幕捕获、图片压缩、快捷键、GUI 绘制或 TCC。`firstParseableProgressMs` 是生产解析器发布进度的时间，不是用户看到屏幕的时间。所有正式结果先保存原文，再进行沙箱判题。

为使用与安装包相同的 Node 版本，可以在 Mac 将上面 `node` 换为：

```sh
env ELECTRON_RUN_AS_NODE=1 /Applications/PassWisely.app/Contents/MacOS/PassWisely
```

这使用已安装 Electron 的 Node 运行时，并加载当前仓库的生产 TypeScript；它不启动 Electron GUI。比较安装包时仍需保存 ASAR SHA256，并核对仓库代码与该版本冻结源代码一致。可用 `/usr/bin/time -l` 记录该测试进程的 elapsed/CPU/峰值 RSS；不能将它冒充完整 GUI 的资源占用。

语音测试复用 `test/audio/native-intel/direct-deepgram-smoke.mjs` 和其 README，仅发送本地合成 WAV。首结果计时从开始发送 PCM 算起，包括说话时间；不能直接称为说完后的识别延迟。它不证明 Apple Silicon Recall 全链路、真实麦克风/系统音频来源或真人识别准确率。

离线汇总：保存一个 `run-manifest.json`，显式指向本次各结果目录、资源日志、语音期望文本及环境/局限，再运行 `python3.12 test/performance/analyze.py --run NEW_RUN_DIRECTORY --out NEW_SUMMARY.json`。中文普通句使用 NFKC、大小写折叠、去空白标点后的 CER；英语按词计算 WER。日期/金额/代码术语单独保留原始结果，不通过自定义数字改写掩盖错误。每个 final row 以 ID 的最后一次修订为准，避免把修订重复拼接。

已执行结果和范围见 [2026-11-12 报告](../reports/performance/2026-11-12.md)。原始公开题面回答、语音输出和资源日志保存在 `results/`，被 Git 忽略。不要将令牌、服务器环境文件或账户标识复制进去。
