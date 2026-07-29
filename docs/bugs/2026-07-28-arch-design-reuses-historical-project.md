# /arch-design 未指定工程时复用历史会话工程

## 现象

用户先使用 `/code` 指令并选择了代码库 `my-app`，完成一轮会话后，再在同一会话中使用
`/arch-design` 指令且**未选择任何工程代码库**。预期行为是系统询问用户设计方式（基于已有工程
还是从零设计），但实际系统直接复用了上一轮 `/code` 的 `my-app` 工程，默默基于该工程生成技术
设计文档，未做任何确认。

## 根因

### 1. `/arch-design` 模板缺少询问步骤

`/arch-design` 模板（`apps/dh-backend/config/commands.yaml` line 663-698 与内嵌默认
`command_config_defaults.go` line 291）只有两个静默分支：
- "若已选择工程代码库" -> 基于工程设计
- "若未选择工程代码库（仅提供需求）" -> 从零设计

**没有 `question` 工具调用步骤**，不会触发前端工程确认弹窗。对比 `/code` 模板在未选库时明确要求
agent 调用 `question` 工具向用户确认工程选择。

### 2. 历史会话上下文污染

前端 `wrapUserPrompt`（`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts:140-146`）在用户选择代码库
时，会把 `当前关联代码库: my-app` 注入用户消息文本并**存入会话历史**。后端 `buildRepoBlock`
（`command.go:114-122`）还会追加 `【关联代码库】\n1. my-app` 到模板。

当用户下一轮发 `/arch-design` 且未选库时：
- 前端 `selectedRepos=[]` -> 后端 `hasRepos=false` -> **不注入** `buildRepoBlock`（正确）
- 但 agent 仍能看到完整会话历史（上一轮 `/code` 的用户消息含 `当前关联代码库: my-app`，以及
  助手对 `my-app` 的回复）

由于 `/arch-design` 模板既不强制选库（`requireRepos: false`），也不要求询问，LLM 倾向于沿用
历史上下文中的 `my-app`，**默默复用而非询问**。

注：前端 `selectedRepos` 在每次发送后清空（`Chat.tsx:1712`），无 localStorage 持久化，因此
"复用"并非前端状态记忆，而是 LLM 对会话历史的上下文推断。

## 解决方案

在 `/arch-design` 模板中增加【工程选择规则（重要）】段落，明确：

1. 是否基于工程代码库设计，**仅以本次指令是否选择了关联代码库为准**；
2. **严禁复用历史会话中出现过的代码库**，历史"关联代码库"信息不得作为本次工程依据；
3. 本次未选库时，必须调用 `question` 工具向用户确认设计方式（输入已有工程名 / 从零设计），
   给出与 `/code` 一致的 `question` 调用 JSON 格式；
4. 根据用户响应分流到"基于工程代码库"或"基于需求从零设计"流程。

同步更新两处配置（外部 YAML 优先加载，Go 内嵌为兜底）：
- `apps/dh-backend/config/commands.yaml` `/arch-design` 模板
- `apps/dh-backend/gateway/handler/command_config_defaults.go` `/arch-design` Template 字段

### 验证

- `go vet ./...`（dh-backend）：0 warnings
- `pnpm build`：6/6 successful
- 后端 `/api/v1/commands` 端点确认 `/arch-design` 模板含 `question` 步骤与"严禁复用历史会话"规则
- 全部服务启动正常（DH Backend HTTP 200）
