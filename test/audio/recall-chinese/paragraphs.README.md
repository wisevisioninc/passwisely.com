# 转录展示归段回归

`paragraphs.synthetic.json` 是人工编写的 post-normalizer 输入快照，调用生产 `projectTranscriptParagraphs()`；不是真实厂商事件、录音或识别质量证据。raw segment 的 id、文字、来源、participant、临时/最终状态和时间仍由原会话 owner 保留。

展示采用相邻同 normalizer-owned channelId/capture epoch、音频间隔不超过 2500ms、合并后不超过 100 个 Unicode 字符的阅读策略。channelId 基于未截断的原始来源/参与者身份；显示名称和缩短后的 participantId 不参与重建身份。旧样本缺 channelId，或未知来源且没有参与者身份时，保守分段。缺时间、重叠/倒退、身份或来源切换、暂停恢复边界均分开；长 ASR 片段不会被截断。partial 立即显示，后续更新按原 id 替换，不等待 2500ms 后再显示。标点本身不强制断段。

```sh
node --test desktop-api/tests/transcript-paragraphs.test.mjs desktop-api/tests/recall-capture.test.mjs desktop-api/tests/live-session.test.mjs desktop-api/tests/conversation-context.test.mjs
```

覆盖连续短 final、提前句号、静音、来源切换、时间缺失/冲突、未知来源、partial 更新、旧 final 迟到修订、暂停恢复 epoch、100 字符/2500ms 边界和长 Unicode 原段。另覆盖显示名称截断/participantId 编码碰撞、缺 owner channelId 保守分段、恢复前尚未 final 的临时行不会被恢复后的新语音借用 ID，以及 native resume 同步回调。LiveSession 测试还确认问答仍使用原始 final 快照，不把展示 partial 发送给模型。

真实 Mac 回归使用现有 `transcripts.zh-CN.json` 的 5 句合成朗读音频，按 README 的播放器方法逐句播放。期望同一来源的连续碎片在满足条件时组成更少气泡、文字立即出现、partial 原位更新、来源切换仍独立、暂停恢复后另起段。保留原始片段与段落 memberIds/起止以便比较。播放到测试目录的内容之外不收集环境语音。

这不应写成“识别准确率提升”。ASR 漏字、错字和术语仍可能存在；endpointing:500 是另一项上游配置变化，需要新会话真实验证。模拟测试不证明 Recall 接受/转发该选项或 SystemContainer 当前 V2 的运行行为。
