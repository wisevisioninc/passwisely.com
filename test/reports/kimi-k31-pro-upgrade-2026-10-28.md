# Kimi K3.1 Pro 升级 — 2026-10-28

状态：**已上线并通过原生客户端实测**。Wise 共享默认已从 `kimi-k3` 切换为 `kimi-k3.1-pro`；现有 v2.0.0 r5 客户端已显示新模型并返回正确合成测试答案。

## 实现与范围

`shared/kimi.ts` 统一默认 `kimi-k3.1-pro`、K3 系列标识及请求参数。客户端、Wise 聊天转发和简历生成均使用同一个参数 owner。按 [Kimi 官方参数文档](https://platform.kimi.com/docs/api/models-overview)，K3/K3.1 始终推理，改为 `reasoning_effort=low`（保留显式 effort），移除旧 `thinking` 和固定采样参数，避免旧安装包传入温度 0.2/0.3/0.6 导致不兼容。

旧 K3、K2.5 选项保留；不覆盖用户已保存的个人模型与环境覆盖。共享 Wise 请求的实际型号由后台配置决定，因此已安装的 r5 客户端可通过服务端切换使用新型号，无须仅为共享模型重新发安装包。源码中新客户端默认项、示例配置和测试入口已同步。历史实测回答和 migration 保留原值。

保持既有 K3 token 预算积分策略，Pro 不会落入固定 1 积分分支。此举没有变更套餐价格或声称策略系数等于当前供应商价格。真实请求不会因模型升级自动重复发送。

## 已执行验证

- 切换前只读核对真实配置 owner：当时共享配置为 Supabase 的 `kimi / kimi-k3`，有 Key，官方 `.cn` API；Key 未输出或复制。
- 官方 `/v1/models` HTTP 200，含 `kimi-k3.1-pro`。
- 单次公开合成提示 `Reply with exactly OK.`，`max_tokens=256`、`reasoning_effort=low`：HTTP 200，实际型号 `kimi-k3.1-pro`，`finish_reason=stop`，正文 `OK`，115 tokens。耗时 3,089ms，仅此单次请求，不代表速度分布或质量提升。没有重试、用户会话访问或配置写入。见 [原始探测回执](releases/2.0.0/r5/kimi-k31-pro-probe.json)。
- 客户端对话、参数 owner、真实服务端聊天/流式/个人 Key/简历及相关回归 **20/20**。
- 默认/endpoint/历史 runner 验证 **17/17**，包含 **20/20** 历史纯文本 loopback SSE；属于合成传输回放，不是 20 次新模型调用或判题。
- renderer、Electron、website TypeScript `--noEmit --incremental false` 均通过。
- 部署隔离源：完整网站 **244/244**、部署 owner **18/18**；Wise Linux **81/81** 相关测试、owner **18/18**。Linux 未跑完整 244 项。

首轮本地策略测试的通用 TypeScript loader 不能执行 ESM `.mjs`；测试夹具改为导入原始 SSE 模块并传给加载器后 20/20 通过，没有替换或改写生产 SSE 解析器。完整网站测试首轮的 3 项本机监听被沙箱拒绝，获得 loopback 执行权限后 244/244 通过。

## 已发布身份与配置范围

canonical 源码提交 `f91caed` 保留 Claude 和待发布的微信修改；生产候选基于升级前的 `a087b33` 独立分支，仅包含 6 个模型源码/测试路径及 2 个部署路径，提交 `f96b17787d9c8c97ba1b8bf30326f43c1ef3c406`。**不部署 canonical checkout**。

候选 49 编译文件、5,353,026 字节；树指纹 `813c15d59e2ac9a3357bd461a7304a2e1971fdc5c953f640e0b88e660599d633`，manifest `7e23eaf556a8d41273b592ce15df6ca08f763c379f0fe4e0c99a85121e7b00cd`。见 [准备回执](releases/2.0.0/r5/kimi-k31-pro-prepared.json)。

已先激活兼容新模型参数的服务端，再通过现有 admin settings owner 将 `ai_default_model` 改为 `kimi-k3.1-pro`。只改这一字段；保留 provider、Key、Base URL、运行绑定、环境文件、数据库 schema 和待发布微信配置。模型配置变化与运行包回滚分别记录，不声称联合原子回滚。

用户本人完成了 Wise 交互式 sudo 激活。后续独立只读核验、原生共享模型问答及公网路由验证均已完成；本轮未重测 ASR、付款、Intel/Windows 实机。

## 已审阅的最终入口

远端组合入口：
`/home/jerry/.passwisely-private/release-incoming/v2.0.0-kimi-k31-pro-f96b177/activate-model-reviewed.sh`

SHA256 `6d9b09bdb3a076c867e9050c80c54d6c2d571dd9cd7e33631cf6e0fd9eee330b`。入口本机及 Wise Bash 语法检查通过，并核对其依赖：部署 wrapper `5f83362733d1099162ba519b0dbd3653bec67b39e79ca0bd44185616cce215ee`，模型设置 helper `18c5d5c8611c24502de7134f4efba20a5b523b3fe7ab0dd013352e0500725183`。

模型 helper 的真实 HTTP fixture 在 Mac 和 Wise Node 22.15.0 各 **11/11** 通过，覆盖精确部分 PUT、原标量私有备份、幂等零写、wrong-provider 拒绝、写前后漂移、丢失响应后的 uncertain 状态与不重试。切换前生产 [只读计划](releases/2.0.0/r5/kimi-k31-pro-model-plan.json) 确认当时仍是 K3，0 数据库写入。之后用户已执行 apply，回执与独立核验见下文。原始 helper、fixture、计划和最终入口已保留在本地忽略目录 `release/v2.0.0/r5/verification/kimi-k31-pro-switch/`，附逐文件指纹。

最终入口先运行设置只读计划，再执行已审阅部署并检查健康，最后以 jerry 身份通过已有管理 API 只 PUT `ai_default_model`。写后核对其余所有 masked settings 未变；已有目标时设置 helper 零写。环境默认等显式覆盖保持原值。现有管理 API 没有原子条件写入（CAS），采用写前复查和写后校验，明确保留该限制；写后异常不会自动回滚并误报成功。

## 上线后验收

- 用户执行最终入口后，运行包回执为 `active`，源码 `f96b17787d9c8c97ba1b8bf30326f43c1ef3c406`、49 文件及树指纹匹配。事务 SHA256 `e69b20200f5fea22d1d6b7e56de7d5cad5a0f19135f5b135161162e440d00582`。
- 模型设置回执 `64c010b7-4e8f-40cd-8379-4dcb39f7e0a5` 确认 `kimi-k3 → kimi-k3.1-pro`，仅 1 次数据库设置写入；其他 masked settings 未变，Key 未返回、环境写入为 0。双标量备份保留在 Wise 私有目录。
- 独立 SSH 只读核验确认 web 与 desktop API 正常运行；运行绑定 6742 字节、SHA `826c8bbf9a147091d525000d3f1da2bc9a2252732194cdc35f8a88f27eb0a0b8` 原样保留；Nginx、服务单元及含待发布微信变更的 checkout 未动。核验本身无写入、重启或 provider 调用。
- 公网 HTTPS、鉴权、TLS gRPC 与三平台 r5 下载 **12/12** 通过，无 provider 请求。
- 现有 `/Applications/PassWisely.app` v2.0.0 r5 发起一次合成纯文本问题 `17 + 25`，原生响应标签为 **`kimi-k3.1-pro`**，正文 **`42`**。无须重装即可使用新的 Wise 共享默认。
- 原生发送按钮调用后，桌面工具报告 ScreenCaptureKit 采集错误；没有再次点击发送。随后新的 AX 状态确认原请求已经回答，不把工具采集错误算作 App 网络失败，也不为此重复模型请求。原生未采集服务端 finish reason、token 用量或模型延迟；Copy 可用本身不代表完整结束，本次验收仅确认新模型标签与合成答案。

保存的公开证据：

- [运行包事务](releases/2.0.0/r5/kimi-k31-pro-runtime-transaction.json)
- [模型切换回执](releases/2.0.0/r5/kimi-k31-pro-model-switch.json)
- [只读运行状态核验](releases/2.0.0/r5/kimi-k31-pro-active-verification.json)
- [公网 12 项检查](releases/2.0.0/r5/kimi-k31-pro-public-verification.json)
- [原生客户端合成测试](releases/2.0.0/r5/kimi-k31-pro-native-smoke.json)

这次没有重新发布三平台安装包，也没有覆盖用户个人 Key 下保存的旧型号；源码默认值用于后续构建，已有客户端的共享请求由已上线服务端选择新型号。本次单条算术问答不建立新模型的编程答案准确率或速度提升结论。
