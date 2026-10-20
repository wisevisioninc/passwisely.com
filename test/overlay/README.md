# Mac 浮层穿透样本

`click-through.html` 只含合成文字和本页输入控件，无网络调用、账号或自动录音。用浏览器打开，令 PassWisely 的半透明正文覆盖测试区，验证底层拖选／双击、文本框输入和按钮；再验证浮条、设置、复制及 resize 控件仍可操作。

必须使用原生鼠标／键盘测试跨窗口命中；仅用 DOM click、Playwright locator 或 IPC mock 不能证明鼠标真实穿透。记录底层页面的 selection、输入和按钮计数，以及浮层关闭设置后焦点能否返回。测试结束清空或关闭此临时页面即可。

可只服务本目录：`python3 -m http.server 8773 --bind 127.0.0.1 --directory test/overlay`。测试源文件可以保留，运行日志不含个人输入。

## 设置与音频控制回归

使用新构建的 Mac App，先记下当前 Output / Code / Speech 与 Key Display，测试后恢复；不清除截图或真实会话内容。

1. **设置稳定性**：空闲浮条直接点击齿轮，关闭后再开，重复 5 次；再用键盘 Enter 打开、Escape 关闭。观察主浮条是否短暂消失、跳位或改变尺寸；hover 打开不应抢走底层输入焦点。该视觉项目需要真人观察，AX 稳态和 mock 不证明没有闪烁。
2. **会话面板**：明确开始一次合成音频测试。Start 后正文应立即出现；Pause / Resume / Done 不收起正文，也不出现 Collapse 或 Expand。Start Over 只清当前内容，面板仍保留。Show/Hide 与其快捷键保持对整个浮层的显式控制；结束时确认音频已释放。
3. **语言选择**：Output 22 项、Code 16 项应与 `test/languages/systemcontainer-catalog.json` 的目录逐项一致；音频语言仍独立使用当前已支持的 Recall profiles。选择 Japanese 与 Rust，提交下面的合成问题，检查日语说明和 Rust 实现；该问题不明确指定回答或代码语言，避免掩盖设置失效。完成后恢复原偏好并重开 App，检查 Code 偏好保存。不要把单次模型回答算作所有语言质量验收。

合成手输题：`Write a function that returns the sum of two integers and briefly explain its time complexity.`

测试样本不包含用户资料。模型与 Recall 的真实调用需要自己的已配置服务；不要把未启动供应商的离线回归写成原生采集／识别／延迟验证。
