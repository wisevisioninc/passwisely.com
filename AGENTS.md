# PassWisely：AI 开发协作规则

本文件适用于所有参与本仓库开发的 AI 助手（Claude / Claude Code / Cowork、ChatGPT / Codex、Kimi 等）及人工开发者。`CLAUDE.md` 引用本文件，修改规则时只改这里。

## 1. 三端代码同步（必须）

| 端 | 位置 |
| --- | --- |
| 本地 Mac | `/Users/chenyejin/codebase/passwisely` |
| 远程 wise | `jerry@8.219.140.215:/home/jerry/codebase/passwisely`（ssh 别名 `wise`） |
| GitHub 个人账号 | `git@github.com:yejinchen-ai/passwisely.git` |
| GitHub 公司账号 | `git@github.com:wisevisioninc/passwisely.com.git` |

规则：

1. 每完成一项修改并提交后，**立即**同步到本地 Mac、wise 和两个 GitHub 仓库，不要攒到最后。
2. 同步后四处的分支必须指向同一个 commit SHA；完成后报告该 SHA。
3. 只做 fast-forward 同步，禁止 `--force` 推送、禁止改写已推送的历史。
4. 某一端有另外三端没有的提交（分叉）时，停止同步，说明差异，由负责人决定如何合并。
5. 首选使用 `scripts/sync-three-way.sh`（在本地 Mac 仓库内运行）。脚本会检查工作区是否干净，经 wise 推送到两个 GitHub 仓库，并核对四处 SHA。
6. 同步代码不等于部署：推送不会重启线上服务。部署按第 2 节单独执行。
7. 不提交任何密钥、`.env*`、证书、`.deploy/` 下的部署密钥或生产数据。

## 2. 部署目标

| 服务 | 服务器 |
| --- | --- |
| 官网 passwisely.com | `47.95.66.86` |
| 后端服务（桌面 gRPC API 等） | `8.219.140.215`（wise） |

- 部署前先完成三端同步，并在发布说明里写明部署的 commit SHA。
- 部署使用仓库里已审阅的激活脚本（如 `website/scripts/activate-website-ui.sh`），需要 sudo 的步骤由负责人执行或授权。
- 部署后验证线上页面与健康检查，失败时按脚本回滚。

## 3. 每次交付时说明

- 改了什么、测试结果（含未能运行的测试及原因）。
- 三端同步后的 commit SHA，以及是否已部署、部署到哪台服务器。
