# 本地登录 fetch failed — 2026-10-28

状态：**用户已确认使用现有安装包重新登录成功；Wise → Supabase 当前正常。**

北京时间 14:32 实测：Wise Web、desktop API 正常；Supabase DNS 10ms、Auth health HTTP200/101ms、真实 REST 数据库 limit0 只读查询 HTTP200/122ms，严格 TLS 校验正常。近15分钟服务日志没有相关记录，不能据此证明先前的登录请求到达或没有到达服务端。

已安装 `/Applications/PassWisely.app` 为 v2.0.0。REA 对8个选定的已发布登录模块做静态分析，默认域名为 `https://passwisely.cn`，启动环境未见三个 endpoint 覆盖。该包自身 Electron29.4.6 / Node20.9.0 无账号探测 `.cn/api/account` 返回401（正常鉴权边界，1506ms），www401（3960ms）。旧 `.com` 返回 `fetch failed / ECONNREFUSED`，但不能把这一旧域故障推定为本次包的实际请求目标。

原生 App 当时处于找回密码页并显示 fetch failed。仅切回登录页并保留邮箱，未发送重置邮件。用户自行重试后确认登录成功；没有清除 token、改密码、重启服务器或重装 App。

原始错误未保留 transport cause code；当前无法复现，**无法精确归因于当时的 DNS、TLS、代理或瞬时连接问题**，不能声称 Supabase 故障或已修复某个未经证实的网络根因。

另发现开发模板 `.env.example` 仍显式覆盖为 `.com/api`，已改为 `.cn/api`，并增加真实模板到生产 endpoint owner 的登录/账户/AI/gRPC 一致性回归。相关测试16/16、diff check通过。这是预防新开发配置选错旧域的确定修复，不声称解释当前已安装 App 的原始错误；不涉及服务器或安装包发布。

REA Evidence `ev_046abd47859291163c731bdbaf8c334c6a2b06fc5a0afeb92c6906c53f41a32b`。范围仅8个选定模块；主 bundle semantic 分析触及512MiB堆上限，图不完整。完整本地 Evidence、选取清单及原包SHA保存在忽略目录 `release/v2.0.0/r5/verification/login-fetch-20261028/`。

[结构化诊断回执](releases/2.0.0/r5/login-fetch-20261028.json)。未尝试用户密码、未读取或输出Key/Token、未调用模型/支付、无数据库写入。
