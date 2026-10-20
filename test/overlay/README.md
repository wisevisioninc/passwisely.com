# Mac 浮层穿透样本

`click-through.html` 只含合成文字和本页输入控件，无网络调用、账号或自动录音。用浏览器打开，令 PassWisely 的半透明正文覆盖测试区，验证底层拖选／双击、文本框输入和按钮；再验证浮条、设置、复制及 resize 控件仍可操作。

必须使用原生鼠标／键盘测试跨窗口命中；仅用 DOM click、Playwright locator 或 IPC mock 不能证明鼠标真实穿透。记录底层页面的 selection、输入和按钮计数，以及浮层关闭设置后焦点能否返回。测试结束清空或关闭此临时页面即可。

可只服务本目录：`python3 -m http.server 8773 --bind 127.0.0.1 --directory test/overlay`。测试源文件可以保留，运行日志不含个人输入。
