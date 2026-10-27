# 官网下载菜单 — 2026-10-28

状态：**已实现、本地浏览器验收完成，发布候选准备中，尚未激活生产**。

首页与页尾复用同一下载组件，主入口改为并排的 `Get for Windows` 和 `Get for Mac`。点击 Mac 展开 Apple Silicon、Intel 芯片两项；已可靠检测的芯片标为推荐并正常显示，另一项置灰但仍可手动下载。浏览器不提供芯片信息时两项均保留正常选择，不将 `MacIntel` 兼容字符串误判为 Intel。

保留原下载目录、版本、音频能力和系统要求。三平台仍是 v2.0.0 r5，Intel 包支持实时音频（macOS 13+），不显示过期的“不含实时音频”。未重打安装包。

菜单使用原生 details/summary，无脚本时仍可展开。支持 Escape 收起并还原焦点、点击外部收起、键盘访问两项；窗口 resize 或滚动时根据可用空间调整方向和最大高度，内容可滚动，不让菜单超出视口。

## 已执行检查

- canonical 相关下载/支付展示回归 **73/73**，website TypeScript noEmit 及 diff check 通过。
- 隔离发布源完整 website **248/248**、部署 owner **18/18**、website TypeScript noEmit 通过；干净构建 3.56 秒，49 编译文件、5,361,054 字节。
- 对最终编译首页进行浏览器检查：1280×720 桌面、390×844 手机尺寸，两个主按钮同排、无横向溢出，展开菜单不会被后续演示遮挡。桌面菜单底部 707.8，保留至少 12px 视口边距；缩放后重新计算布局。
- 当前真实 Mac 浏览器返回 arm 芯片信息，Apple 显示推荐、Intel 置灰。英文 Intel、中文 unknown 通过组件夹具模拟验证；不声称 Intel 实机浏览器已运行。
- Escape、外部点击、Enter 和 Tab 均完成浏览器验证，灰色 Intel 项仍有正确下载 href。最终编译首页控制台 error/warn 为 0；未实际导航安装包下载端点，不生成下载计数。

## 源码与范围

canonical 提交 `8be1759` 保留现有代码及未发布微信修改。生产候选基于当前已上线 `f96b177` 单独选择本次三个路径的改动，候选提交 `8be985357bd3596dbb4fc62d478e5225fc93800a`；不直接部署 canonical checkout。生产的支付宝回归保持不变，未混入 canonical 的待发布微信测试。

候选 manifest SHA256 `697c846a361f765a1e069c8e30bf72a9993d2c98d88958183f130ebca80379d4`，编译树指纹 `8ab6d1af258135c5e9effbf913b6818eb3deed2ce1b3ac8603832153649a4ce0`。

本次无模型、密钥、数据库、支付或安装包配置修改。Wise 服务切换需要用户本人完成交互式 sudo；激活后还需核验公网与前端镜像，不把本地通过算作线上完成。

[准备回执与证据指纹](releases/2.0.0/r5/download-menu-prepared.json)。完整浏览器记录、测试日志和最终截图保存在本地忽略目录 `release/v2.0.0/r5/verification/download-menu/`。
