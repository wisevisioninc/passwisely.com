# Windows x64 构建与验收

现有 GitHub Actions `.github/workflows/build-windows.yml` 使用原生 `windows-latest`，在 Windows 上 `npm ci`，让 Recall SDK 2.0.39 的安装脚本下载 Windows 原生资源，再构建 NSIS。不要将 Mac/Linux 上安装的 `node_modules` 同步给 Windows 构建。

```powershell
npm ci
node --test desktop-api/tests/windows-package.test.mjs
npm run dist:win -- --x64 --publish never -c.win.signAndEditExecutable=true
node scripts/verify-windows-runtime.cjs release/win-unpacked
Get-AuthenticodeSignature release/PassWisely-Windows-x64.exe
```

工作流不会发布 GitHub Release 或上传网站；它只产生安装包与校验报告。`signed_build=false` 是明确的未签名构建，不能描述为已通过 Windows 发布者验证。请求签名构建前，在所选 GitHub 仓库 Secrets 配置 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`（证书允许空密码时可为空）；不要把值提交或贴到聊天。该分支强制签名并检查 App／安装包 Authenticode 为 Valid。

`verify-windows-runtime.cjs` 只在 Windows 上执行所选已打包 Electron 的 Node 模式，检查包内 SDK／uuid 的完整导入闭包，拒绝从宿主安装借依赖；检查解包的 agent-windows.exe 的 x64 PE 头及 GStreamer DLL 资源。它不调用 SDK init，不启动原生 agent，不采集、上传或转录，也不证明麦克风／系统声音／ASR 功能完成。Mac 上的合成资源和 mock 测试只能证明检查器合同。

真实交互 Windows x64 机器仍需完成以下验收，并将 OS、App 版本、包 SHA256、状态／结果存入本目录的独立 results 子目录。不得把未运行项目标为通过：

| 项目 | 可复用样本／判定 |
|---|---|
| 安装与启动 | 标准用户安装 NSIS；登录；版本为待发布版本；Logo、字号、设置与 Mac 版一致。 |
| 系统音频 | 播放 `test/audio/recall-chinese/generated` 的固定 WAV；检查来源标签、完整最终文本、partial 更新。不要用 UI mock 替代真实采集。 |
| 麦克风 | 使用同一 README 的固定话术真人朗读；记录当前默认输入设备；不能将播放器声源测试当麦克风通过。 |
| 暂停／恢复 | 暂停不再新增采集；恢复后的话语具有新 epoch；旧 final 修订不合并到新 partial。 |
| 组合问答 | 使用 `test/leetcode` 已保存题面，截图＋手输＋最终转录生成回答；分别验证 Output／Code Language，流式显示、取消和复制。 |
| 截图与隐藏 | 截图期间手动隐藏，完成后保持隐藏；并发截图、截图失败恢复、旧窗口 lease 不显示新窗口。 |
| 快捷键 | `Ctrl+H`、`Ctrl+Enter`、`Ctrl+B`、`Ctrl+Shift+\` 与当前动作契约一致；窗口隐藏时维持既有快捷键策略。 |
| 退出与资源 | 录音中退出先清理；无法确认停止时保留资源并显示错误；退出后无遗留采集子进程。 |

CI hosted runner 没有本次用户的 Windows 音频设备／登录状态；包导入通过后仍须以上交互验收。现有其它测试包含 `file://` URL `.pathname` 等 Mac 路径假设，本工作流只运行新 Windows 检查器合同测试，并不声称全套现有测试已在 Windows 通过。
