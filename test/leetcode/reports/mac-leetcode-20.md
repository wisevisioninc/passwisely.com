# Mac 新版 LeetCode 20题回归记录

本轮20题均由已登录的原生 Mac App 手输提交，界面显示模型 `kimi-k3`；原生流式回答完成20/20，完整复制并粘贴取回20/20。未重试模型或替换错误答案。

固定种子20261020，从4474条公开目录筛选3300个免费数字算法候选，分层随机抽8简单/8中等/4困难。所有题面为独立中文改写，冻结169个自编正常/边界用例。

Python3.12.14隔离判题：基础19/20题通过，166/169例通过；加3个已保存反例后17/20题通过，166/172例通过。系统Python3.9的一份兼容性诊断另存，不把其不支持现代类型注解算作算法错误。

|题号|题目|基础用例|补充边界|
|---|---|---|---|
|1326|[灌溉花园的最少水龙头数目](https://leetcode.cn/problems/minimum-number-of-taps-to-open-to-water-a-garden/)|9/9|—|
|2582|[递枕头](https://leetcode.cn/problems/pass-the-pillow/)|8/8|—|
|1402|[做菜顺序](https://leetcode.cn/problems/reducing-dishes/)|9/9|—|
|3274|[检查棋盘方格颜色是否相同](https://leetcode.cn/problems/check-if-two-chessboard-squares-have-the-same-color/)|8/8|—|
|2770|[达到末尾下标所需的最大跳跃次数](https://leetcode.cn/problems/maximum-number-of-jumps-to-reach-the-last-index/)|9/9|—|
|740|[删除并获得点数](https://leetcode.cn/problems/delete-and-earn/)|9/9|—|
|1221|[分割平衡字符串](https://leetcode.cn/problems/split-a-string-in-balanced-strings/)|9/9|—|
|1925|[统计平方和三元组的数目](https://leetcode.cn/problems/count-square-sum-triples/)|9/9|—|
|1372|[二叉树中的最长交错路径](https://leetcode.cn/problems/longest-zigzag-path-in-a-binary-tree/)|9/9|失败|
|2472|[不重叠回文子字符串的最大数目](https://leetcode.cn/problems/maximum-number-of-non-overlapping-palindrome-substrings/)|7/10|失败|
|2699|[修改图中的边权](https://leetcode.cn/problems/modify-graph-edge-weights/)|8/8|—|
|3644|[排序排列](https://leetcode.cn/problems/maximum-k-to-sort-a-permutation/)|8/8|—|
|1443|[收集树上所有苹果的最少时间](https://leetcode.cn/problems/minimum-time-to-collect-all-apples-in-a-tree/)|8/8|失败|
|1249|[移除无效的括号](https://leetcode.cn/problems/minimum-remove-to-make-valid-parentheses/)|8/8|—|
|721|[账户合并](https://leetcode.cn/problems/accounts-merge/)|8/8|—|
|2595|[奇偶位数](https://leetcode.cn/problems/number-of-even-and-odd-bits/)|8/8|—|
|2124|[检查是否所有 A 都在 B 之前](https://leetcode.cn/problems/check-if-all-as-appears-before-all-bs/)|8/8|—|
|3092|[最高频率的 ID](https://leetcode.cn/problems/most-frequent-ids/)|8/8|—|
|169|[多数元素](https://leetcode.cn/problems/majority-element/)|8/8|—|
|3033|[修改矩阵](https://leetcode.cn/problems/modify-the-matrix/)|8/8|—|

## 已复现问题

- **2472 回文子串**：保留最小左端点会丢失较短回文对应的最优前缀。基础三个失败：`abbaabba,k=4`输出1/应2，`aaaaa,k=2`输出1/应2，`abacdcaba,k=3`输出2/应3。最小新增反例`aa,k=1`输出1/应2。这是模型答案错误，原始回答已保留。
- **1372、1443**：2000节点深树在本地默认1000层递归限制下抛出`RecursionError`，分别应得1999、3998。输入均在题目约束内；该现象不证明LeetCode服务使用相同递归配置。
- **原生复制按钮**：旧实现真实点击失败，已通过受信主进程窄IPC修复。4项权限/UTF8/失败回归通过，20题实际复制通过。

## 验证与范围

- 桌面与测试工具回归172/172通过，无skip；renderer/electron类型检查和编译通过。
- 20题离线页面切换、题意、接口和来源显示均通过；两个oracle套件固定种子交叉核验通过。
- Python沙箱自测确认网络、外部哨兵文件读写和子进程被拒绝。模型子进程不获得期望答案。
- 20次模型问答只覆盖手输→生产Live流式→原生展示/复制；本轮未重测ASR和截图提交AI。
- UI采样耗时包含工具操作及一次锁屏等待，不用来宣称网络首字或模型延迟。
- 最终完整Recall包与文字实测包的42项编译资源哈希一致；恢复107个Recall原生Mach-O，总132代码目标DeveloperID签名/strict校验通过，音频未重跑。
- 最终包：`release/1.3.0-mac-leetcode-native/PassWisely.app`。开发签名，无可信时间戳/公证，依赖3014测试SSH隧道。

## 复跑

```sh
npm run test:leetcode
npm run test:leetcode:oracles
python3.12 test/leetcode/scripts/sandbox_selftest.py
python3.12 test/leetcode/scripts/judge.py --results test/leetcode/results/mac-leetcode-20 --allow-execution --boundary
npm run test:leetcode:fixtures
```

判定结果拒绝覆盖；结果目录已含本轮verdicts，复跑判定请复制原始`*.answer.json`到新的结果目录。真实模型脚本见主README，需要显式`--live`、有效令牌和新输出目录。原始20份答案和各次判定保存在`results/mac-leetcode-20/`（默认Git忽略）；本报告、样本、oracle、边界生成器和工具可随源码保留。
