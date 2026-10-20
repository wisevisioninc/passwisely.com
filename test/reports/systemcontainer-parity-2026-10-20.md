# SystemContainer 对齐与 Mac 验证（2026-10-20）

本轮补齐了浮层鼠标穿透、紧凑设置入口和转录展示归段。用户已明确反馈：新版在同一底层页面的穿透选字与输入都正常。中文实时采集能输出结果，但仍有来源串入、漏字和金额格式错误，不能判为识别准确率通过。

最终源码已提交为 `3887c2f5ba0f13044d736d027d2ef8945403398c`。复审发现的高级／紧凑设置保存覆盖与按钮点击后丢失 Escape 焦点均已修复；最终自动化回归 276/276 通过。原生观察的具体包与范围分别记录，避免把早先检查点当成所有最终行为的证据。

## 范围与证据类型

- **静态观测**：读取本机 SystemContainer 3.0.1 的选定第一方包成员，以及 PassWisely 源码；未执行解出的目标代码。
- **源码推断**：根据这些成员的数据流说明归段、事件转发和界面消费关系，不等同于观察到当前运行路径。
- **自动化回归**：调用生产模块、组件 SSR／hook-controller 或带模拟 SDK／IPC 的边界测试；不证明真实供应商识别质量或原生跨窗口命中。
- **真实观测**：本轮 Mac 页面交互的用户反馈，以及固定合成 WAV 播放后的实际界面文本。
- **未知／未验证**：当前 SystemContainer 的远端转录参数、实际 feature flag 状态、统计准确率、多屏原生切换和所有底层应用兼容性。

本轮只验证 Mac 及其必需的 Wise 隔离 stage。App 经本机 `localhost:3014` 访问该测试 API；没有发布网站、Windows 版本或生产安装包。

## SystemContainer 静态依据

REA Evidence：`ev_f0579ae07d723777fecc7a1fd7bf0fe355941fbfab0cec305d744cf259ddb0c1`。

原 ASAR SHA-256：`528ea903d8dc6a1b42331ae7658689ab39e37fe63c09eef242475b2fa978fd78`。
选定目录摘要：`30b25caa314c48e8c78dab1c37a0ff13b1fd167ea2f65db7eb0ed0179f699f26`；它与原 ASAR 摘要含义不同。

选取 14 个第一方文件；REA 解析 8 个 JavaScript、遍历 585805 个 AST 节点，解析失败数为 0。语义图覆盖为 **partial**：globals／window 分析受 worker heap 限制，main 的语义图受父结果预算限制，已保留静态和模块事实。不能声称完整应用或依赖／原生代码均已覆盖，未找到的事实也不能据此判为不存在。

以下是原成员的零起点 UTF-8 字节范围，右端不含；完整成员摘要、偏移与来源限定保存在[静态证据索引](systemcontainer-static-evidence-2026-10-20.json)；原代码摘录留在本机临时证据中。

| 原成员 | byte range | 静态观测及限制 |
| --- | --- | --- |
| `window-DsQ9GEov.js` | `[704692,706040)` | 旧上下文按 mic／system 分别累积；超过 100 字符或显式 break 后形成段落。 |
| 同上 | `[848401,848901)`、`[704189,704197)` | 旧音频路径使用 2500ms 的 buffer inactivity 标记段落结束。 |
| 同上 | `[855793,856114)` | V2 默认配置含 `paragraphTimeoutMs:2500`、`paragraphLengthThreshold:100`。 |
| 同上 | `[884970,889669)` | V2 仍逐条保存 final 和当前 partial，另有段落 buffer／完成事件。 |
| 同上 | `[850761,851442)` | V2 adapter 的 `audioTranscriptions` 来自原条目，段落上下文是另一入口。 |
| `main-CLCIkAdW.js` | `[995085,996499)` | 新浮层直接逐条渲染 `audioTranscriptions`，不是该处统一归段。 |
| 同上 | `[507217,509017)` | 同包另有消费 `paragraphTranscripts` 的界面。 |
| `window-DsQ9GEov.js` | `[860260,860576)` | Recall V2 上传默认 provider 为 Deepgram，传入的 provider config 默认为空；远端最终配置未知。 |
| `out/main/index.js` | `[65497,67178)` | main 转发 Recall final／partial；该回调没有段落聚合。 |

因此，“SystemContainer 包内存在短段聚合能力”有静态证据；“当前 V2 新浮层所有气泡都已归句”不成立为已验证结论。本轮没有确定其识别质量优于 PassWisely 的具体根因，也没有将目标代码复制进产品。

鼠标静态边界：main `7903` 默认 ignore、`10486` 启用 forward、`74229` owner-checked handler；window `908158` 交互 lease、`908536` 局部区域、`909085` 玻璃正文默认不捕获；main renderer `1011895` 设置明确捕获。现代 Settings `1011748–1015059` 是 224px 外层／192px 内层紧凑菜单，包含三个语言选择、条件显示器、快捷键显示及账户入口。PassWisely 用真实 AI Models & Settings 替代其 Manage Prompts 位置，未虚构模板管理能力。

本机临时证据：`/private/tmp/passwisely-rea-analysis/selection-manifest.json`、`evidence-index.json`；补充精确片段为 `/private/tmp/passwisely-segmentation-analysis/systemcontainer-source-fragments.json`。这些临时文件不是随源码交付的完整证据归档。

## PassWisely 归段与所有权

- [normalizer](../../electron/live/recallTranscript.ts) 保留 ASR 原始片段身份、临时／最终状态和时间；`channelId` 由未截断的原始来源／参与者身份产生。
- [展示投影](../../electron/live/TranscriptParagraphs.ts) 只消费 owner 的 `channelId` 和采集 epoch；不从截断显示名称或缩短后的 participantId 重新判断身份，缺 owner ID 时保守分段。
- 展示仅合并相邻、同 channel／epoch、音频间隔不超过 2500ms、合计不超过 100 个 Unicode 字符的片段。保留 member IDs／起止时间，按原数组顺序重算；不补词、不删字，不把段落称为新的 ASR utterance。
- partial 即时显示，无需等 2500ms。旧 final 修订更新原行，不根据修改后的 `receivedAt` 把旧行排到新句后面。
- [Capture](../../electron/live/RecallCapture.ts) 在 native resume 可能同步回调前退役未完成的临时 ID，保留 final 去重／修订记录；[Session](../../electron/live/LiveSessionService.ts) 保留旧未确认 partial，不将它冒充 final。
- 跨 epoch 的迟到 final 若无匹配显式 utterance ID，且有效完整时间区间严格早于当前 active 的缓存时间范围，则独立成行并保留当前 active；这不证明它属于某个旧 partial。
- 缺失、非有限或倒置时间不能成为上述排除证据；无法确定的迟到事件归属仍是限制。显式同 ID 及已存在的 final owner 优先。
- [问答上下文](../../electron/live/ConversationContext.ts) 继续使用原始 final 快照，不发送展示 partial；本轮未改其既有排序与容量策略，也未重新评测回答质量。

Deepgram 中文配置独立增加 `endpointing:500`，保留 Nova-3／zh／interim／punctuate，不开启 smart_format。它是供应商配置调优，不能等同于展示归段或承诺准确率提高；本轮新会话已产出真实转录；这证明配置下的会话可建立，不直接证明 Recall 最终向 Deepgram 转发或采用了该字段。参见 [Deepgram endpointing](https://developers.deepgram.com/docs/endpointing)。

## 鼠标与设置

[浮层窗口 owner](../../electron/live/OverlayWindow.ts) 与 [LiveWorkspace](../../src/components/Live/LiveWorkspace.tsx) 将正文背景和明确交互控件分开处理。正文区域可把鼠标交还底层页面；按钮、设置、复制和 resize 控件仍有自己的命中区域，控件消失或滚动后刷新命中状态。键盘焦点归还与鼠标穿透分别管理。

**真实结果**：用户明确反馈新版同页穿透选字与输入都正常。这支持本轮页面／窗口组合，不等于所有应用、多显示器、所有 Spaces 或所有输入控件均已验证。复用页见 [click-through 样本](../overlay/README.md)；SSR 或 IPC mock 不代替原生鼠标验证。

[紧凑设置](../../src/components/Live/LiveSettingsPopover.tsx) 提供回答语言、Meeting Audio Language、显示器、快捷键显示方式，以及高级模型设置、Resume／Programming／Quick Guide、账户、退出等入口。设置入口保留原 logo 与现有浮条／内容面板布局。

源码与 controller 回归覆盖独立加载／保存、失败提示、语音会话期间锁定、回答生成期间的语言保护、Esc 焦点归还、显示器选择确认及真实 owner 调用。它们不证明账户页面或每个原生显示器切换均已完整实测。

复审修复：高级与紧凑编辑器互斥；同一个 workspace gate 覆盖 Output／Speech／高级 AI Save／Clear key。保存寿命跨面板卸载保留，Back 可以离开，重开紧凑菜单须等旧写完成后再读取；旧 editor 回调不能越界写。dialog 中用户点击的按钮取得键盘焦点，hover 打开不抢焦点，离开或卸载再释放。仍连接且可见的原生 SELECT 遇到 null 焦点去向时保留已有所有权，不能把短暂未知当成离开并调用 win.blur；hover 关闭计时器也消费该所有权，明确移出、隐藏、卸载仍释放。

## 本轮固定音频真实结果

音频来自本机固定合成 WAV，经明确操作播放到系统输出；不是用户真人麦克风朗读。来源标签仅表示应用归类，不证明说话者身份。

| 固定样本 | 实际界面观测 | 判断 |
| --- | --- | --- |
| 日期／金额 WAV | 系统来源单段：`2026年10月2日订单金额是1 28 50元`；另有麦克风段：`今天是` | 日期漏字、金额格式错误，且出现来源串入；不能算准确率或完整来源分离通过。 |
| 04 WAV（边界处理） | 系统来源单段：`可以先处理空数组再检查左右边界` | 文字内容正确、标点省略；支持该固定输入的系统音频展示链路，不是真人 mic 通过。 |
| 技术词 WAV | 系统来源单段：`请用 python 实现 b ing re se ar ch。时间复杂度是 ol ive and` | 已归段，但 binary search 和 O log n 仍识别错误。 |

本轮看到系统来源文本以单段展示，但本文未提供同一轮 raw segment 数与段落数的完整配对统计，不能给出“碎片下降百分比”。单次文字正确也不能代替整套中文识别质量测试。

此前默认输入／输出为 AirPods Pro 的检查和旧包中文观测记录在 [早先 Mac 报告](../audio/recall-chinese/reports/mac-2026-10-20.md)。该报告属于早先检查点，不替代本轮包的最终证据。来源串入原因尚未确定，未据此自动更改声道映射或归因于物理回声。

Recall [ad-hoc 官方契约](https://docs.recall.ai/docs/adhoc-meetings-in-person-meetings) 说明 Host 为本机 mic 流、Guest 为其他流，开始录制时绑定默认设备；[通用 schema](https://docs.recall.ai/docs/download-schemas) 的 `is_host` 字段不单独证明本地麦克风来源。当前未保存足以判定本次原始 source／name／is_host 是否冲突的元数据。

## 已执行验证与包范围

最终源码的已执行结果：

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 桌面及 Recall 后端测试 | **276/276 通过** | 最终生产边界、组件／controller 和合同回归，21.772s；含两方向跨面板 pending 写入与旧 editor 回调。 |
| Renderer 类型检查与构建 | 通过 | 最终前端源码可检查、可构建；不是原生交互或 ASR 质量证据。 |
| 签名验证 | 132 个签名对象 strict 校验通过 | 最终包 122 个 Mach-O 与 10 个 bundle 的本地签名有效性，含 107 个 Recall 原生叶子。 |
| 包内资产 | 40 项 hash 匹配 | 最终编译资产与打包成员一致，打包过程未重建或改变资产。 |
| Recall runtime checker | 通过 | 包内可解析所需 SDK 运行时依赖；不初始化 SDK、采集或证明云服务可用。 |

测试入口：

```sh
node --test desktop-api/tests/*.test.mjs website/tests/recall-upload.test.mjs
```

重点回归见 [归段](../../desktop-api/tests/transcript-paragraphs.test.mjs)、[采集与恢复](../../desktop-api/tests/recall-capture.test.mjs)、[浮层](../../desktop-api/tests/overlay-window.test.mjs)、[组件](../../desktop-api/tests/live-ui.test.mjs) 和 [紧凑设置](../../desktop-api/tests/live-settings-popover.test.mjs)。fixture／复测方法见 [中文音频样本](../audio/recall-chinese/README.md) 与 [归段样本](../audio/recall-chinese/paragraphs.README.md)。

当前交付范围为 Developer ID 签名的本地 debug 包，**未公证、未发布**。本报告不记录 Key、Token、真实用户录音、完整环境转录或原包目标代码。

## 最终包与原生检查点

- 最终 App：`release/1.3.0-mac-rea-parity-verified/PassWisely.app`，ASAR SHA-256 `309973f69f8dbc021b99a6bc93365822aa18352f24e3c66bd39c9befa6cfb7c3`。构建时 tracked source clean，源提交为上述 `3887c2f`；本报告在其后保存。
- Developer ID team `VFF94RK9TN`，hardened runtime；本地测试使用 timestamp=none，未公证／staple／发布。包旁保留完整资产与签名验证 JSON。
- 用户同页穿透反馈、三条 WAV 与语言／代码／Key Display 保存观察来自早先 `1.3.0-mac-rea-parity` 包，ASAR `29086508a30ec45ccc8b25a0d50023bacc48ad5203b04dbed1a227d6391f9b58`；随后仅补设置写入所有权、dialog 焦点与原生 select 的未知焦点转移处理。它们不自动证明最终包已在所有应用上重复实测。
- 原生设置此前观察：回答语言 中文→English（Saved）→中文（Saved），关闭重开保持；代码 Python→C++，重开保持后恢复 Python；Key Display Text 重开保持后恢复 Icon。暂停时 Meeting Audio 禁用，结束后可用。语音选择持久化的真实原生保存本轮未确认，自动化 API 契约测试已覆盖。
- 固定音频会话已通过 Done 结束，界面返回 Start Interview；对应 PassWisely／SDK 进程随后正常退出。没有结束 SystemContainer 的 SDK 进程。
- `1.3.0-mac-rea-parity-final` 中间包原生验证：点击 Text mode 后焦点在该按钮，Escape 关闭菜单；重开仍是 Text，再恢复 Icon。进入高级设置时 gear 禁用，Back 后恢复。高级语言改 English／Save 成功（Settings saved），Back 后紧凑菜单读取 English；随后高级恢复中文／Save 成功，紧凑菜单读到中文。该包 ASAR `f2f700c24c136d2d58eed00474b3f8fc7f34eada62f3860522c3f05e12a1af00`。
- 最终 verified 包已启动并登录，确认中文／Python／Deepgram 中文实时／Icon，Start Interview 可用且未自动采集。macOS 原生下拉弹窗使自动化工具绑定失效；随后用户在此最终包手动完成 Output Language 中文→English→中文、确认 Saved、关闭重开，明确反馈“选择、保存和重开均正常”。这是用户提供的最终原生验证，不是自动化键盘动作成功的推定。

识别质量仍需按相同输入单独测 CER／WER、首字／最终延迟与来源分离；本轮没有这些统计或回答模型评分。截图保护使原生 App 截图为空白，本轮使用 AX 状态和用户反馈，没有关闭保护来制作视觉证据。

## REA 分析成本

单次选定树分析：wall 14.98s，user CPU 20.11s、system CPU 0.95s；macOS time 的 maximum RSS 为 1254064128 bytes、peak memory footprint 为 536863912 bytes。它们不是完整进程族的同时峰值；token 成本、冷／暖对照及完整包分析成本未测。
