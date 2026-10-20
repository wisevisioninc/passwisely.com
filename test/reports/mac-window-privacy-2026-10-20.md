# Mac 窗口隐私与共享兼容性（2026-10-20）

本轮补齐了可以从 SystemContainer 静态证据确认的窗口内容保护生命周期，并修复 PassWisely 截图完成时覆盖手动隐藏的缺陷。**这不等于已证明对 Zoom、Meet、Chime、Webex、飞书、HackerRank、CoderPad、Codility 不可检测。** 屏幕画面排除、平台焦点报告、进程／应用识别和系统隐私指示器应分别验证。

## REA 输入与事实

复用 REA 6.4.0 Evidence `ev_f0579ae07d723777fecc7a1fd7bf0fe355941fbfab0cec305d744cf259ddb0c1`，重新匹配本机 `/Applications/systemcontainer.app/Contents/Resources/app.asar` 与选定成员摘要；没有重复全量分析、执行目标代码或修改目标包。

- SystemContainer 3.0.1，ASAR 206100163 bytes；SHA-256 `528ea903d8dc6a1b42331ae7658689ab39e37fe63c09eef242475b2fa978fd78`。
- 本轮主进程成员 `out/main/index.js` 86342 bytes；SHA-256 `b882aee1309a72c2557e7ced39e5337e26abf7225cfd3b9819e5c6cfb742b742`。[23 条原字节／摘要证据](systemcontainer-window-privacy-evidence-2026-10-20.json)保留范围、摘要和有界说明，不包含目标实现源码。
- 既有 REA 范围为 14 个第一方文件、8 个 JS、585805 AST 节点，语义图 partial：window/global worker heap 与 main 父结果预算限制。依赖和原生代码不在完整覆盖内。

| 原主进程字节范围（零起点，右端不含） | 静态观测 | 可支持的结论 |
| --- | --- | --- |
| `[6304,7950)`、`[12140,12344)` | 自有 BrowserWindow 在 show／restore／focus 重新调用内容保护 owner | 窗口生命周期重申保护请求 |
| `[17278,17308)`、`[15222,15758)` | 普通浮层 callback 恒 true，onboarding callback 恒 false | 两种窗口角色的策略不同；未读取当前 onboarding 状态 |
| `[15081,15219)`、`[10638,10813)` | 普通浮层隐藏 Dock；focus／blur 和 Mac showInactive 分别处理 | 本地呈现和焦点行为，不是进程隐身 |
| `[67227,67430)`、`[70626,71266)` | 自有截图前后设置保护，desktopCapturer 选择屏幕源 | 自身截图流程，不是改写会议软件采集结果 |
| `[38175,39792)`、`[50092,51757)`、`[51759,53935)` | Zoom／Meet 名称用于麦克风活动日志映射，消费者发 mic-used／unhide-window | 未获得两平台专属检测绕过适配的证据 |

保护直接消费者调用 Electron 窗口 API，未定位额外可达本地保护 helper。所见随包 audiotee 的直接消费者用于系统 PCM 采集；未反编译其二进制、Recall SDK 或 screenshot-desktop。不能将这个有界结果扩大为整个目标无其他机制。

## 平台与原生边界

本机 macOS 26.6.2 / 25G83 / arm64。Info.plist 显示 SystemContainer 的 Electron Framework 为 38.0.0，PassWisely 为 29.4.6。上游 [29.4.6](https://github.com/electron/electron/blob/v29.4.6/shell/browser/native_window_mac.mm#L1185) 与 [38.0.0](https://github.com/electron/electron/blob/v38.0.0/shell/browser/native_window_mac.mm#L1085) 的该 API 均设置 NSWindowSharingNone；这是上游源码事实，不能证明目标自带框架没有本地补丁。本轮 REA doctor 确认 Hopper／Ghidra／IDA 不可用，未安装引擎或修改 REA 配置，框架原生实现仍未验证。

Electron 维护者确认，新 ScreenCaptureKit 路径可能忽略该设置；普通内容保护不能推导所有采集端排除。[官方问题与说明](https://github.com/electron/electron/issues/48258)。本轮据此保留捕获路径和远端结果未知，没有为满足宣传标签自动升级 Electron 或声称升级可解决。

HackerRank 的具体监考模式、Codility Device Integrity 等还涉及独立于画面共享的应用／设备检查；[HackerRank 模式](https://support.hackerrank.com/articles/1079706165-proctoring-hackerrank-tests)、[Codility 说明](https://support.codility.com/hc/en-us/articles/46432701207569-Introducing-Device-Integrity)不建立 PW 或 SC 实际是否被其识别的结论。图中的更新时间和 Undetectable 标签不含受测版本、共享源、接收画面或完整性报告，不能作为验收证据。

## PassWisely 结构修复

源码提交 `49a0145b9da093d2c4c4f57b023da6d7c3ffc633`：

1. 单一 WindowCaptureProtection owner：隐藏创建，在加载／发布窗口前请求保护；show／restore／focus 重申；closed 只清自己的监听。初始失败窗口不会被后续显示／重建误用；原生销毁失败时保留资源供重试。
2. 单一 WindowVisibilityController owner：用户 Show/Hide 意图和截图临时 suppression lease 分离，删除旧 isWindowVisible 混合状态。截图在排队前取得属于该窗口的 lease，finally 只释放；隐藏中截图、截图中 Hide、并发截图及旧窗口完成都不会擅自展开新／隐藏窗口。恢复失败保留 owner 与双错误，明确 Show/Hide 可重试。
3. 保留原 Dock／Mission Control 呈现、键盘焦点 lease 和鼠标穿透。纠正把隐藏 Mission Control、背景节流和帧率描述为防录屏的注释。没有增加伪装进程、伪造系统身份或抑制测评事件的代码。

## 已执行验证与调试包

- 全量 `node --test desktop-api/tests/*.test.mjs website/tests/recall-upload.test.mjs`：**306/306**，0 失败／跳过，21.73 秒；新增生产边界测试使用真实 main／ScreenshotHelper／Shortcuts 与 owner，仅替换原生窗口和合成 PNG，不等于真实平台采集。
- 前端与 Electron `tsc --noEmit`、`npm run build:assets`、`git diff --check`：通过；未运行会删除旧 release 的 clean。
- 新包：`release/1.3.0-mac-window-privacy/PassWisely.app`，arm64；编译源已提交且 trackedSourceDirty=false；43 个编译资源与 ASAR 逐项一致。
- ASAR SHA-256 `9f83d7a2309144d044db467bb81f9e3441c442749a15286559d07708fba01c06`。Developer ID / Team VFF94RK9TN，122 个 Mach-O leaves（含 107 Recall）、10 个 bundles，共 132 目标通过 hardened-runtime／签名验证；复制后 deep/strict 验签通过；Recall runtime verifier 返回 RECALL_RUNTIME_OK。
- 本地调试包 timestamp=none，未公证、未 staple、未上传／发布。通过本机 3014 → Wise 隔离测试 API 隧道使用保存的登录，依赖该隧道；未发布网站、Windows 或生产安装包。

## 可复用样本与飞书现场记录

[测试目录](../privacy/README.md)包含 8 平台、8 维度、3 变体的紧凑 [matrix.template.json](../privacy/matrix.template.json)，默认 unknown、空 runs 不算通过；合成 [capture-target.html](../privacy/capture-target.html) 含时钟、新鲜帧、输入与如实焦点事件。接收端需确认新鲜画面与底层可读，不能把冻结／黑屏误判排除。OS、框架、平台版本／模式变化后需重测。

本轮已由用户准备飞书双设备测试会议。桌面工具对会议只返回窗口容器，首次读取还发生长时间阻塞；Chrome 自动读取发生采集错误，故共享控件和接收端结果需要人工配合。已在本机浏览器打开合成测试页。最终运行包与现场结果在后续追加；此处尚不将八个平台填为通过。

现场进度：正常退出旧包后，工具已实际打开 `release/1.3.0-mac-window-privacy/PassWisely.app`，可访问树 URL 与该包的 app.asar 匹配；登录后浮条就绪。Chrome 原生窗口也已核对为 `127.0.0.1:8774/capture-target.html`。未启动新版录音或发送模型请求。接收端结果另行归因，不从发送端状态推定远端排除。

## 飞书整屏共享：PassWisely 接收端反馈

用户针对“整个屏幕”共享、发送端显示新版 PassWisely、接收端时钟持续前进的明确测试问题，回复：**“看不到 PassWisely，底层页面和时钟正常”**。据此记为本次 `display_share / passwisely` 的人工排除观测，支持该轮实际接收画面中未见浮层、底层正常；不扩大为所有帧、设置、版本、平台或应用识别不可检测。

[机器可复用记录](../privacy/results/feishu-display-share-2026-10-20.json)明确 `evidenceLevel: human_report_only`；未取得原始接收帧／录像，不虚构 SHA、时间范围、飞书产品版本、屏幕 ID、接收设备元数据或实际捕获引擎。独立无浮层基线与其他共享／录制模式未测。

## 飞书同配置对照结果

用户保持同一会议、接收设备和整个屏幕共享设置，隐藏 PassWisely、在发送端显示 SystemContainer 后，反馈：**“看不到 SystemContainer，底层页面和时钟正常”**。归档时重新读取安装包，3.0.1 的 ASAR 摘要仍与 REA 目标一致。

| 同配置人工接收端观察 | PassWisely 新包 1.3.0 | SystemContainer 3.0.1 |
| --- | --- | --- |
| 浮层 | 用户报告不可见 | 用户报告不可见 |
| 底层合成页面／时钟 | 用户报告正常 | 用户报告正常 |
| 原始接收端帧／录像独立审核 | 未取得 | 未取得 |

因此，**两者在本次飞书整屏共享的定性接收端结果一致**。每个变体仅一条用户现场反馈，不等于三次重复、逐帧零泄漏、所有飞书设置或其余七个平台均通过；焦点报告与应用检测未测。记录中未知产品版本、捕获引擎和设备字段仍为 null。没有为归档启动录音、模型请求或新会议，未自动结束用户正在使用的会议。
