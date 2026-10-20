# Mac 设置、会话控件与语言目录验证（2026-10-20）

本轮源码为 `4ed1b2e553bec9d6206a16764fbdc76fa4b0ab3d`。修复普通设置点击的多余原生 blur，移除会话内部 Collapse / Expand，并补齐 SystemContainer 的 22 项 Output 与 16 项 Code 目录及实际请求传递。保留 PassWisely logo、正文穿透和现有三种 ASR profile。

## 静态依据与修复

使用 REA 既有 Evidence `ev_f0579ae07d723777fecc7a1fd7bf0fe355941fbfab0cec305d744cf259ddb0c1`，复核已安装 SystemContainer 3.0.1 的 ASAR 与选定成员摘要相符。原 ASAR SHA-256 为 `528ea903d8dc6a1b42331ae7658689ab39e37fe63c09eef242475b2fa978fd78`。[35 条字节范围事实](systemcontainer-controls-languages-evidence-2026-10-20.json)保留成员摘要、范围摘要和来源；[独立语言样本](../languages/systemcontainer-catalog.json)保留原始 ID、标签和顺序。未执行解出的目标代码，未复制目标实现进入产品。

- 齿轮直接消费者只开关设置；手输控件另有焦点获取／释放。PassWisely 原来每次收到 false 都原生 blur，即使普通按钮没有取得键盘 lease。修复由 OverlayWindow 统一持有 lease：成功获取后才归还；已经原生聚焦不重复 focus，外部已失焦只清 lease，失败的 blur 保留清理所有权。稳态及 mock 不能证明逐帧无闪烁。
- 所检查的截图式会话路径在进入会话时打开内容，暂停时仍保留内容；UI 暂停／恢复与 Done 分开。PassWisely 用单一 contentOpened 意图保留正文，开始后不再内部收起；Start Over 只清内容，Show/Hide 仍控制整体。目标另有 insightsV3 的 Open/Close Chat 路径，本轮不宣称整个目标无收起能力。默认录音快捷键静态契约是开始／停止，因而保留 PassWisely 对应行为，不将它改成暂停／恢复。
- 一个共享语言目录供紧凑／高级设置、编程选择器和请求 prompt 消费。修复旧三语言白名单、旧强制中文 prompt；Live ask 在异步图片准备前冻结 Output/Code。旧 en 读取归一为 en-US 而不重写原文件。未知代码偏好明确要求选择，不静默生成 Python；Code 首次保存备份旧 UI 配置且保留未知字段。Output/Code 与音频识别语言分离。

REA 原覆盖为选定 14 个第一方文件、8 个 JS、585805 AST 节点、0 解析失败；语义图 partial（window/global worker heap 和 main 结果预算限制）。本文是有界静态观测与 PassWisely 源码推导，不能代替目标全包或当前远端行为验证。

## 自动化与构建

实际执行：

- `node --test desktop-api/tests/*.test.mjs website/tests/recall-upload.test.mjs`：**293/293**，0 失败／跳过，21.73 秒。包括焦点幂等、无 lease 不 blur、原生失败所有权、持久会话面板、独立 22/16 目录、全部高亮 grammar、旧 ID、无效／不可读偏好、保存备份、语言快照与非中文 prompt 等生产边界回归。
- `tsc --noEmit -p tsconfig.json`、`npm run build:assets`、`git diff --check`：通过。没有执行会删除 release 的 clean/full-build。
- arm64 本地调试包：`release/1.3.0-mac-controls-languages/PassWisely.app`。构建时已提交且 trackedSourceDirty=false；41 个编译资源与 ASAR 逐项摘要一致，ASAR SHA-256：`6a58469a6d68ddb1ae691a36c92cf5d567bbd9454ccd3ced48f7bea10d61e4ae`。
- Developer ID / Team VFF94RK9TN；122 个 Mach-O leaves（含 107 个 Recall）、10 个 bundles，共 132 个目标通过签名与 hardened-runtime 检查，复制后 deep/strict 验签通过；Recall runtime verifier 返回 RECALL_RUNTIME_OK。
- 调试包 timestamp=none，未公证、未 staple、未上传或发布。使用现有本机 3014 → Wise 隔离测试 API 隧道；依赖该隧道。未更改线上网站、Windows 或生产安装包。

## 原生 Mac 观测

实际打开上述新包，确认 URL 指向其 app.asar。以下不是 IPC mock：

- 空闲开始仅显示浮条；连续 5 次关闭／打开 Settings，10 次检查均保留 Start Interview，设置面板按预期交替。App 截图保护使正文截图为空白，未关闭保护；这一项只证明可访问树中的稳态，不证明肉眼没有瞬时闪烁。
- 原生 Output 下拉改为 Japanese 后出现 Saved；Code 改为 Rust。未开始音频、未包含截图或旧会话，将不指定语言的固定题 `Write a function that returns the sum of two integers and briefly explain its time complexity.` 提交给实际 kimi-k3，界面返回 Rust `fn sum(a: i32, b: i32) -> i32 { a + b }` 与日语复杂度说明。该结果支持两项偏好贯通，不是 22 种自然语言／16 种代码质量验收；没有执行生成代码或评测其整数溢出语义。
- 原生 Start 立即切 Transcripts，随后进入 Listening；Pause 显示 Resume、Done 并保留正文；Resume 回到 Listening，Done 消失；再次 Pause → Done 结束。过程未出现 Collapse 或 Expand。

可复用操作步骤与固定题保存在 [overlay 样本说明](../overlay/README.md)。本轮未重新统计 ASR 准确率、延迟、跨应用穿透或全部语言模型质量。

## 最终复验

- Done 后恢复 Start Interview，正文仍在；原生进程检查确认 PassWisely 的 Recall SDK 子进程已退出。SystemContainer 自己的 SDK 进程保持原状。
- 恢复原偏好 Mandarin (普通话) / C++ / 中文 · Deepgram 实时 / Icon。通过 App 的 Quit 正常退出，再打开同一新包，Settings 确认这四项保持；未启动新的录音。
- 用户在这个新包上连续点击设置后明确反馈：**“已不闪隐藏”**。这提供本机本轮的实际视觉验收；不扩大为所有 macOS/显示器/Spaces 的保证。

代码变更、目录 fixture 和回归在源码提交 4ed1b2e 中；本报告随后单独提交，不改变已验签包的编译资源。最终 App 保持打开，音频未在采集。
