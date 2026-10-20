# LeetCode 固定回归样本（Mac）

20题由 leetcode.cn 公开目录（4474条）按种子 `20261020` 分层随机抽取：8 Easy、8 Medium、4 Hard。范围是免费、非隐藏、数字题号且支持普通 Python3 单方法接口的算法题；不代表 SQL/Pandas、付费或交互题的随机覆盖。`manifest.json` 保存获取时间、筛选规则、原文哈希和每个样本文件哈希；`selection-pool.json` 保存3300个候选的最小元数据，离线可以重现抽样顺序。

`cases/` 包含独立中文改写题面、原始接口模板、169个自编正常/边界用例和期望值。测试输入及期望值不进入模型提示。所有来源链接在各题JSON中。未复制完整原文、题解或用户账户数据。

## 离线测试（不访问模型）

在仓库根目录执行：

```sh
npm run test:leetcode
npm run test:leetcode:oracles
```

前者核对20题、抽样顺序、哈希和169个固定期望值，并测试真实会话代码的加载与合成临时转录排除。后者使用独立穷举/随机小输入交叉核验参考实现。Python3、Node>=22及仓库现有依赖即可，不新增依赖。参考实现有意偏重可核验性，不能把其速度当模型性能标准。

## Mac 截图题面和原生测试

```sh
npm run test:leetcode:fixtures
```

打开 `http://127.0.0.1:8771/fixtures/`，用下拉框/上一题/下一题切换；URL hash可直达某一题。服务只监听本机，仅允许题面、manifest和样本JSON，不能访问结果或账户文件。

原生回归步骤：

1. 打开待测 Mac 包，核对版本及模型，保持音频关闭。
2. 每题使用 Start Over 开始独立测试，粘贴题面和接口，请求完整 Python3 Solution、简短思路与复杂度。
3. 检查 Thinking → 流式内容 → 完成；确认代码不截断、复制能取回完整Markdown、切换标签和滚动不丢回答。
4. 截图测试时先让题面全屏，点击 Take Screenshot，确认预览仅有测试内容，再选择 Include screenshots + Solve。
5. 记录每次成功/失败和原始回答，不选择最好一次或静默重试。原生UI采样时延仅是观察上界，不能当网络首字时延。

真实系统音频/麦克风和ASR另测；这些静态算法题及合成文本不能证明真实ASR准确率。

## 可复用真实问答脚本（会消耗模型额度）

```sh
node test/leetcode/scripts/run-live.mjs --dry-run
node test/leetcode/scripts/run-live.mjs --live --transport http-stream \
  --base-url http://127.0.0.1:3014/api \
  --token-file /private/tmp/passwisely-test-token.json \
  --out /private/tmp/passwisely-test-run-NEW
```

令牌文件需为显式提供的0600 JSON文件 `{"token":"..."}`，也可提供 `PASSWISELY_BENCH_TOKEN` 环境变量；不要提交或贴出令牌。脚本不读取App账户缓存，不解密钥匙串。`--help` 提供gRPC及题目过滤参数。结果目录必须不存在；串行执行，无应用层自动重试或换模型。

脚本复用生产 `ConversationContext → LiveSessionService → ProcessingHelper`。HTTP流式模式显式关闭尚未发请求的gRPC通道；gRPC模式显式指定目标，避免混用测试和生产服务。按题号交替覆盖纯文本与标明的合成系统/麦克风最终文本，并验证临时文本不进入模型。这些是合成转录回放，不启动Recall或真实采集，也不覆盖原生渲染。

保存完整答案、实际模型、请求ID、样本哈希、首内容及总耗时、可获得的usage、失败原因。生成完成不等于答案正确；报告必须分开模型可用率和代码判定。

## 保存代码的隔离判定

每个结果命名 `*.answer.json`，至少含 `slug` 与 `answer`（完整Markdown）或 `fullAnswer`。执行前阅读代码及脚本：

```sh
python3.12 test/leetcode/scripts/sandbox_selftest.py
python3.12 test/leetcode/scripts/judge.py \
  --results /private/tmp/passwisely-test-run-NEW --allow-execution --boundary
```

仅在macOS `sandbox-exec` 可用时运行生成代码：拒绝默认权限、网络及任意文件访问，限制CPU/文件大小/文件描述符，8秒强制结束；模型子进程只得到输入，不得到期望输出。隔离不可用会标记 `unverified`，不会退回本机裸执行。此判定只证明固定功能用例，不证明全部输入或复杂度。2699/1249/721使用性质校验，允许不同合法解。原始结果保留，判定结果拒绝覆盖。

结果默认保存在 `results/` 的新子目录且被忽略；审阅后可另存脱敏报告。不得放入账户、API Key、私有截图或原始真实音频。

判题使用 Python≥3.10（本轮使用3.12.14），以支持现代Python类型注解；低版本标记未验证，不能当作模型算法失败。`--boundary` 额外启用三个已保存反例生成器：两棵2000节点深树和最短回文反例，冻结的169个用例保持不变。本地driver不提高默认递归限制，深树失败不代表LeetCode服务使用相同配置。

本轮实测报告见 [reports/mac-leetcode-20.md](reports/mac-leetcode-20.md)。20次模型调用采用原生Mac手输链路，未在本轮重测真实ASR或截图提交AI。
