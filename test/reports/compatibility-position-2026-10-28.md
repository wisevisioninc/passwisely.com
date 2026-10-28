# 官网兼容性模块位置 — 2026-10-28

状态：**Wise 与官网镜像均已上线，真实浏览器验收通过。**

仅移动 `LandingPage.tsx` 中已有的 `CompatibilitySection`，2行增加、2行删除。九款软件整体位于“如何做到隐身？”之后、“让每个问题，都有上下文。”之前；图标、文案、测试记录和时间计算均未修改。

Canonical 提交 `fca4fab0cb99a615fd085cadfdecf5c2a29083ea`。隔离候选 `f218a2dd04debdda6d66a2eed13edc4fc2533b7f` 从已发布 `bbdd842` 起，只包含这个文件的位置调整，未带入其他未发布改动。产物57文件/5,511,463字节，manifest SHA256 `b2cf0ef0e88db2f0cea0ffce42f2bdd596e033856d216da3dabdfc881fac2b9c`，tree `d21d3d6309e9ed3a2d7b44aa9450009c72231b52edc3f3cb864e91d035faf93d`。

现有canonical页面测试58/58；隔离本地与Wise Linux各253/253、TypeScript及部署owner19/19通过；镜像owner19/19及只读计划通过。未新增与布局移动等价的单元测试。真实浏览器桌面1280px及手机390px均确认相邻section依次为 `privacy → compatibility → how`，兼容性模块唯一且9行完整，手机无横向溢出。临时浏览器尺寸已恢复、本地预览已关闭。

用户执行Wise sudo入口后核对事务SHA `44777fbb2e8eb3db01325d03dec8c76984599dfac1e1970ff3b594086f78197e`；官网镜像同产物同步，事务SHA `34da5f669fc15a1b06f4ac93436de30d863cc36ed5618a586e4fe573c8340622`。完整运行文件指纹匹配，原绑定、Nginx及服务单元保持，旧版本备份保留。镜像loopback首页HTTP200，经HTMLParser确认相同模块顺序和九行；3首页/24资源健康检查通过。未重复上轮12项公网路由验证，也不将本次布局验证称为新的平台隐身实测。

[上线回执](releases/2.0.0/r5/compatibility-position-active.json)，[准备回执](releases/2.0.0/r5/compatibility-position-prepared.json)。原始双机回执、日志与截图保存于忽略目录 `release/v2.0.0/r5/verification/compatibility-position-20261028/`。本轮无模型、支付或数据库写入。
