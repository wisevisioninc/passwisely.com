# 官网下载菜单 — 2026-10-28

状态：**下载区改版已同步上线两台服务器；线上补验发现的固定导航遮挡问题已修复，补丁通过 Mac 与 Wise Linux 各 249 项测试及浏览器验收，等待用户执行最终发布切换**。

首页与页尾复用同一下载组件，主入口改为并排的 `Get for Windows` 和 `Get for Mac`。点击 Mac 展开 Apple Silicon、Intel 芯片两项；已可靠检测的芯片标为推荐并正常显示，另一项置灰但仍可手动下载。浏览器不提供芯片信息时两项均保留正常选择，不将 `MacIntel` 兼容字符串误判为 Intel。

保留原下载目录、版本、音频能力和系统要求。三平台仍是 v2.0.0 r5，Intel 包支持实时音频（macOS 13+），不显示过期的“不含实时音频”。未重打安装包。

菜单使用原生 details/summary，无脚本时仍可展开。支持 Escape 收起并还原焦点、点击外部收起、键盘访问两项；窗口 resize 或滚动时根据可用空间调整方向和最大高度，内容可滚动，不让菜单超出视口。

## 已执行检查

- canonical 相关下载/支付展示回归 **73/73**，website TypeScript noEmit 及 diff check 通过。
- 隔离发布源完整 website **248/248**、部署 owner **18/18**、website TypeScript noEmit 通过；干净构建 3.56 秒，49 编译文件、5,361,054 字节。
- Wise 真实 Linux 完整网站 **248/248**、部署 owner **18/18**、TypeScript noEmit 通过。首次两份 SQL 测试启动因生产依赖目录没有 PGlite 而失败（其余 224 项通过）；按锁文件与官方 registry integrity 验证 `@electric-sql/pglite@0.3.14` 后，仅在候选私有测试目录解包并链接。完整重跑通过，生产依赖目录未修改，原始失败日志独立保存。
- 前端服务器同一产物已私有准备，Linux owner **19/19**、只读计划和当前基线资源 **24** 项检查通过，尚未激活。
- 对最终编译首页进行浏览器检查：1280×720 桌面、390×844 手机尺寸，两个主按钮同排、无横向溢出，展开菜单不会被后续演示遮挡。桌面菜单底部 707.8，保留至少 12px 视口边距；缩放后重新计算布局。
- 当前真实 Mac 浏览器返回 arm 芯片信息，Apple 显示推荐、Intel 置灰。英文 Intel、中文 unknown 通过组件夹具模拟验证；不声称 Intel 实机浏览器已运行。
- Escape、外部点击、Enter 和 Tab 均完成浏览器验证，灰色 Intel 项仍有正确下载 href。最终编译首页控制台 error/warn 为 0；未实际导航安装包下载端点，不生成下载计数。

## 源码与范围

canonical 提交 `8be1759` 保留现有代码及未发布微信修改。生产候选基于当前已上线 `f96b177` 单独选择本次三个路径的改动，候选提交 `8be985357bd3596dbb4fc62d478e5225fc93800a`；不直接部署 canonical checkout。生产的支付宝回归保持不变，未混入 canonical 的待发布微信测试。

候选 manifest SHA256 `697c846a361f765a1e069c8e30bf72a9993d2c98d88958183f130ebca80379d4`，编译树指纹 `8ab6d1af258135c5e9effbf913b6818eb3deed2ce1b3ac8603832153649a4ce0`。

本次无模型、密钥、数据库、支付或安装包配置修改。Wise 服务切换需要用户本人完成交互式 sudo；激活后还需核验公网与前端镜像，不把本地通过算作线上完成。

[准备回执与证据指纹](releases/2.0.0/r5/download-menu-prepared.json)。完整浏览器记录、测试日志和最终截图保存在本地忽略目录 `release/v2.0.0/r5/verification/download-menu/`。

## 已审阅的激活入口

`/home/jerry/.passwisely-private/release-incoming/v2.0.0-download-ui-8be9853/activate-reviewed.sh`

SHA256 `0126f7b7c0e8a069bef694a7de81525d8d91dd34c7f3ac072317c809418466fd`；Bash 语法检查通过，最新 `sudo -n` 返回 1，需用户交互式认证。入口严格检查当前 .cn HTTPS、owner 指纹、当前运行树及候选 manifest，先计划再激活，使用原部署 owner 的健康检查和运行包回滚；无数据库迁移或模型设置操作。Wise 当前运行绑定 6742 字节、SHA256 `826c8bbf9a147091d525000d3f1da2bc9a2252732194cdc35f8a88f27eb0a0b8` 经只读核验保持一致，值未输出。

用户执行后，应核验 Wise 运行包与公网 12 项路由，再使用已审阅的前端镜像 owner 同步另一官网服务器，并在实际线上页面复验菜单。两机准备回执明确为未激活；不得据此声称已上线。

## 首次上线与导航边界补丁

用户执行 `8be9853` 激活入口后，Wise 运行包事务 SHA256 `385a2cc9cbf58e0ffe0e3aed3e3a4c524b0c818f62b331b5860f72a6f18bdd0a` 匹配。独立核验 Wise 与前端镜像均运行 49 文件、树 `8ab6d1af258135c5e9effbf913b6818eb3deed2ce1b3ac8603832153649a4ce0`；镜像事务 SHA256 `a40d2dc1e658387cd16d9b8c2ea2508d36bced4a80e20922c816c74e20a28416`，24 项资源校验通过，原配置与路由保持。公网 `.cn` HTTPS、鉴权、gRPC 与三平台下载 **12/12** 通过，未访问下载追踪 GET 或发起模型/付款请求。见 [首次上线回执](releases/2.0.0/r5/download-menu-initial-active.json)。

实际线上 Mac 菜单成功识别 Apple 芯片并将 Intel 置灰，两项均为 v2.0.0、支持实时音频；390×844 无横溢。随后发现特定桌面布局中，菜单虽在视口内，但向上展开落入固定导航占用区，开头被遮挡。

修复 producing boundary：`fitMenu` 在自己的 `.pw-landing` 中读取 `.pw-header` 当前可视矩形，扣除导航实际占用高度和边距，再比较向上/向下可用空间。没有提高全局 z-index 或写死导航高度。canonical 补丁 `2448daa`，隔离候选 `b7d8a44930482bfe4fb0201a9ba99f3678a9b1cb`，仅新增两路径增量。相关 **74/74**；干净候选完整网站 **249/249**、owner **18/18**、TypeScript 通过。

候选浏览器验证 1280×720、390×844、1280×650。在矮屏案例，固定导航 bottom=92，菜单改为向下 240px 内滚动，实际 y397.8～637.8，首个选项 hit 属于菜单，error/warn 0。字体加载是否造成前述位置变化没有充分证据，本次未扩展字体监听或轮询。补丁 manifest `052b72b8fdd23f047b48e2914a85aa12b7cbc90f83fd60e6211b9c7005275fe3`、树 `8aecf4605ab3706238ee76b70b5af2a1203acdd8d2e6b4a4ef945b406c7f658d`，49 文件、5,361,547 字节。以上是本地候选验证，尚不代表补丁已经上线。


导航补丁 Wise Linux **249/249**、owner **18/18**、TypeScript 全部通过；运行绑定、模型与数据库保持不变。最终入口 `/home/jerry/.passwisely-private/release-incoming/v2.0.0-download-nav-b7d8a44/activate-reviewed.sh`，SHA256 `ebde432422946f3f4fd6c68fbb0814871f48300fbce5bd21c5454a5307b85d08`，Bash 语法核验通过。入口以首次已上线 `8ab6d1…` 树为基线，继续使用原隔离部署 owner，先计划再激活。已将准确命令交付用户；本回执明确为 prepared，不声称补丁已激活。见 [导航补丁准备回执](releases/2.0.0/r5/download-menu-header-fix-prepared.json)。

只读核查发现旧免密 UI 入口会 fast-forward/merge 主工作树，并使用旧 `.com` 健康检查，无法保持本次 pending WeChat 隔离与精确指纹约束。因此没有运行或改写该入口，也没有扩大 sudo 权限；仍由用户本人执行安全的隔离发布入口。
