# Mac 隐私与共享兼容测试

`matrix.template.json` 是目录与空记录模板。没有 run、字段为 null 或证据不足均表示 **unknown**，不能推定通过。每个 run 只记录一个平台、明确模式、维度、变体与重复次数；不预生成空结果。官方来源见模板 `sources`，它们说明能力或限制，不代表本机实测。

## 三组对比

1. 固定实际 App 绝对路径、版本、ASAR 摘要、OS、显示器布局缩放、平台模式和客户端/浏览器版本。PW 与 SC 分开测试；依次运行无浮层基线、PassWisely、SystemContainer，采用同一设置与合成内容。只使用有权验证的会议/练习会话。
2. 使用本目录 `capture-target.html` 的合成内容、输入/选择和递增时钟；可运行 `python3 -m http.server 8774 --bind 127.0.0.1 --directory test/privacy`，打开 `http://127.0.0.1:8774/capture-target.html`。页面计数/时钟确认画面新鲜，避免把黑屏、冻结或选错源算作排除成功。无需真实资料或录音。
3. 分别选择窗口、整屏、应用、标签等实际提供的模式；记录单/全部应用窗口、捕获设置与平台配置。每组执行内容显示→设置开关→输入/拖动→显式隐藏/显示；拟每配置重复 3 次。全屏、Spaces、多屏为独立子配置。
4. 保存时间线、接收端短片/帧与 SHA-256、底层可读性、新鲜度和瞬态；本机录屏、平台本地录制与云端录制分别记录实际产物。未知捕获引擎保留 null，不猜测。测试后正常结束录制/音频、退出临时会话并恢复设置。

## 结果边界

- 远端分享结果必须由第二设备或独立接收端确认；发送端预览、本机截图、AX 稳态与 IPC mock 不能替代远端画面。本机录屏只支持其具体录制管线。
- `observed_excluded` 只表示所检查的新鲜捕获帧中浮层未出现且底层正常；`observed_visible` / `partially_visible` 如实记录可见或瞬态。焦点、选择器/系统身份用 `observed_behavior` 记录事实。`not_offered` 需要实际所选版本/配置的证据；前提受阻用 `blocked`。
- `setContentProtection(true)` 不能保证 ScreenCaptureKit 排除。画面排除、正常焦点/粘贴报告、原生进程检查和隐私指示器是不同维度；任何结果都不能证明平台“不可检测”。不伪装身份、抑制事件或绕过监控。
- HackerRank Secure/Proctor/Desktop App，CoderPad Interview/Screen，Codility Screen/Interview/Device Integrity 必须记录具体模式。Chime 传统服务结束支持，特殊加入与 Chime SDK 路线需先确定。
- 缺失/旧版本结果不继承为当前通过；OS、Electron、平台/浏览器、监控模式或窗口实现变化后重测。记录不包含 Token、Cookie、密钥或私人内容。运行证据建议置于忽略目录，人工审核后的有界报告另存。

## 已记录的现场结果

[飞书整屏共享记录](results/feishu-display-share-2026-10-20.json)区分发送端工具确认与接收端人工反馈。用户肉眼反馈可记录为 `observed_excluded` 等观测，但必须标注 `evidenceLevel: human_report_only` 并保存原话；没有原始接收端帧／录像时，artifact 路径、SHA 和帧范围保持 null，不视作独立逐帧验收。不要把保存反馈文件本身的摘要冒充接收画面的摘要。
