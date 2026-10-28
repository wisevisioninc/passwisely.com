# 官网兼容性主副标题 — 2026-10-28

状态：**Wise 与官网镜像均已上线，线上桌面和手机验收通过。**

主标题“每日实测”，副标题“覆盖主流面试软件, 确保不可检测性”（按用户文本保留ASCII逗号）；英文同步为“Tested daily”及“Covering leading interview platforms to ensure undetectability.”。位置仍为 `privacy → compatibility → how`，九款软件、图标、布局和测试时间逻辑未改。本轮只更换文案，不产生新的软件兼容性实测记录。

Canonical代码提交 `2ee0cc383450652f3121063750be0a3aba557d12`。隔离发布源 `dadd41f9646609d7a2dfa1b76c836dcb1683dbb2` 从f218a2d仅应用LandingPage四个文案值及已有SSR测试断言，未包含其他未发布改动。产物57文件/5,511,157字节；manifest SHA256 `d2da7057d75e2f7986eb00b4268533281fe9c02e5ed52d0878663947b507ec4c`，tree `d29d6cba35f5a5df47d8949b6c64b2bb835856d6fe3ded396caeb75e6123bd6e`。

现有canonical页面测试58/58；隔离本地及Wise Linux各253/253、TypeScript、owner19/19通过；镜像owner19/19及只读计划通过。真实浏览器本地中英文切换和390px手机排版通过；线上中文主副标题精确匹配、9行完整、相邻模块顺序正确，390px手机无横向溢出。浏览器尺寸已恢复，临时预览页及服务器已关闭。

Wise事务SHA `93d6f27cb716c8ee97738fbf789ec1d66208988344501138c1f91314296611ab`；镜像事务SHA `aa4ece27a5b7b868038f9aeb57fe510107a426943eed7d1f0242a711bff4462a`。两机运行文件全量指纹一致，绑定、Nginx、服务单元和旧版本备份保持；镜像loopback首页HTTP200，经HTMLParser核对精确主副标题、唯一兼容性模块及九行，3首页/24资源健康检查通过。无数据库写入或模型、支付调用，未重复上轮12项路由测试。

构建时发现多轮shared clone累积的Git alternates链触及深度上限，已将本轮隔离源码改为自包含 `--no-local` clone，无alternates；保留初始失败记录，未修改旧对象库及历史回滚依赖。构建只有最终一次，无生产影响。

[上线回执](releases/2.0.0/r5/compatibility-copy-active.json)，[准备回执](releases/2.0.0/r5/compatibility-copy-prepared.json)。原始回执、检查日志、预览及线上截图在忽略目录 `release/v2.0.0/r5/verification/compatibility-copy-20261028/`。
