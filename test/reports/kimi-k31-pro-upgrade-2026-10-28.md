# Kimi K3.1 Pro 升级 — 2026-10-28

状态：源码及 Wise 隔离候选已验证，**尚未激活、尚未更改生产共享模型**。

## 实现与范围

`shared/kimi.ts` 统一默认 `kimi-k3.1-pro`、K3 系列标识及请求参数。客户端、Wise 聊天转发和简历生成均使用同一个参数 owner。按 [Kimi 官方参数文档](https://platform.kimi.com/docs/api/models-overview)，K3/K3.1 始终推理，改为 `reasoning_effort=low`（保留显式 effort），移除旧 `thinking` 和固定采样参数，避免旧安装包传入温度 0.2/0.3/0.6 导致不兼容。

旧 K3、K2.5 选项保留；不覆盖用户已保存的个人模型与环境覆盖。共享 Wise 请求的实际型号由后台配置决定，因此已安装的 r5 客户端可通过服务端切换使用新型号，无须仅为共享模型重新发安装包。源码中新客户端默认项、示例配置和测试入口已同步。历史实测回答和 migration 保留原值。

保持既有 K3 token 预算积分策略，Pro 不会落入固定 1 积分分支。此举没有变更套餐价格或声称策略系数等于当前供应商价格。真实请求不会因模型升级自动重复发送。

## 已执行验证

- 只读核对真实配置 owner：当前共享配置为 Supabase 的 `kimi / kimi-k3`，有 Key，官方 `.cn` API；Key 未输出或复制。
- 官方 `/v1/models` HTTP 200，含 `kimi-k3.1-pro`。
- 单次公开合成提示 `Reply with exactly OK.`，`max_tokens=256`、`reasoning_effort=low`：HTTP 200，实际型号 `kimi-k3.1-pro`，`finish_reason=stop`，正文 `OK`，115 tokens。耗时 3,089ms，仅此单次请求，不代表速度分布或质量提升。没有重试、用户会话访问或配置写入。见 [原始探测回执](releases/2.0.0/r5/kimi-k31-pro-probe.json)。
- 客户端对话、参数 owner、真实服务端聊天/流式/个人 Key/简历及相关回归 **20/20**。
- 默认/endpoint/历史 runner 验证 **17/17**，包含 **20/20** 历史纯文本 loopback SSE；属于合成传输回放，不是 20 次新模型调用或判题。
- renderer、Electron、website TypeScript `--noEmit --incremental false` 均通过。
- 部署隔离源：完整网站 **244/244**、部署 owner **18/18**；Wise Linux **81/81** 相关测试、owner **18/18**。Linux 未跑完整 244 项。

首轮本地策略测试的通用 TypeScript loader 不能执行 ESM `.mjs`；测试夹具改为导入原始 SSE 模块并传给加载器后 20/20 通过，没有替换或改写生产 SSE 解析器。完整网站测试首轮的 3 项本机监听被沙箱拒绝，获得 loopback 执行权限后 244/244 通过。

## 发布身份与待执行项

canonical 源码提交 `f91caed` 保留 Claude 和待发布的微信修改；生产候选基于当前 `a087b33` 独立分支，仅包含 6 个模型源码/测试路径及 2 个部署路径，提交 `f96b17787d9c8c97ba1b8bf30326f43c1ef3c406`。**不部署 canonical checkout**。

候选 49 编译文件、5,353,026 字节；树指纹 `813c15d59e2ac9a3357bd461a7304a2e1971fdc5c953f640e0b88e660599d633`，manifest `7e23eaf556a8d41273b592ce15df6ca08f763c379f0fe4e0c99a85121e7b00cd`。见 [准备回执](releases/2.0.0/r5/kimi-k31-pro-prepared.json)。

下一步需先激活兼容新模型参数的服务端，再通过现有 admin settings owner 将 `ai_default_model` 改为 `kimi-k3.1-pro`。只改这一字段；保留 provider、Key、Base URL、运行绑定、环境文件、数据库 schema 和待发布微信配置。模型配置变化与运行包回滚分别记录，不声称联合原子回滚。

Wise `sudo -n` 仍要求交互密码，因此最终激活需要用户本人执行已准备的 sudo 入口。执行前不将本报告标为已上线。上线后仍需核验共享请求的实际返回型号与公网路由；本轮未重测 ASR、付款、Intel/Windows 实机。

## 已审阅的最终入口

远端组合入口：
`/home/jerry/.passwisely-private/release-incoming/v2.0.0-kimi-k31-pro-f96b177/activate-model-reviewed.sh`

SHA256 `6d9b09bdb3a076c867e9050c80c54d6c2d571dd9cd7e33631cf6e0fd9eee330b`。入口本机及 Wise Bash 语法检查通过，并核对其依赖：部署 wrapper `5f83362733d1099162ba519b0dbd3653bec67b39e79ca0bd44185616cce215ee`，模型设置 helper `18c5d5c8611c24502de7134f4efba20a5b523b3fe7ab0dd013352e0500725183`。

模型 helper 的真实 HTTP fixture 在 Mac 和 Wise Node 22.15.0 各 **11/11** 通过，覆盖精确部分 PUT、原标量私有备份、幂等零写、wrong-provider 拒绝、写前后漂移、丢失响应后的 uncertain 状态与不重试。生产 [只读计划](releases/2.0.0/r5/kimi-k31-pro-model-plan.json) 确认当前仍是 K3，0 数据库写入；尚未执行 apply。原始 helper、fixture、计划和最终入口已保留在本地忽略目录 `release/v2.0.0/r5/verification/kimi-k31-pro-switch/`，附逐文件指纹。

最终入口先运行设置只读计划，再执行已审阅部署并检查健康，最后以 jerry 身份通过已有管理 API 只 PUT `ai_default_model`。写后核对其余所有 masked settings 未变；已有目标时设置 helper 零写。环境默认等显式覆盖保持原值。现有管理 API 没有原子条件写入（CAS），采用写前复查和写后校验，明确保留该限制；写后异常不会自动回滚并误报成功。
