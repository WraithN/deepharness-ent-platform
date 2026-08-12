# 2026-08-11 comet 决策点提问无弹层：decision-point.md 引用了 opencode 不存在的工具名

## 现象

智能会话走 comet classic 流程进入 design/brainstorming 阶段后，agent 的决策点提问以**纯文本**（"A. xxx / B. xxx / C. xxx"）形式出现在消息流中，前端提问弹层（模态遮罩 + 内联提问卡片）不弹出，用户只能手动打字回答。

影响范围：所有带 cometTemplate 的指令在 comet 流程中由 `comet/reference/decision-point.md` 主导的决策点（设计确认、方案选择等）。

## 根因

前端提问弹层的唯一触发源是 `agent.question` 事件（`apps/dh-frontend/src/pages/Chat.tsx` 的 `pendingQuestion`），该事件只在模型调用 opencode 的 **`question`** 工具时由 gatewayd relay loop 转换发出。

而 comet 决策点协议 `~/.config/opencode/skills/comet/reference/decision-point.md`（上游 `@rpamis/comet` npm 包模板）写的是：

> 存在 `AskUserQuestion` 时，使用它展示选项；若无法使用 `AskUserQuestion`，则判定本会话结构化提问不可用，后续决策点不得反复重试，直接使用文本选项降级模式。

`AskUserQuestion` 是 Claude Code 风格的工具名，**opencode 中不存在**（其结构化提问工具叫 `question`）。模型按协议字面执行 → 判定"本会话结构化提问不可用" → 文本降级，且**会话内粘滞**（后续决策点不再尝试工具调用）。实测证据：

- 问题 run 的 42 次工具调用只有 bash/read/skill/glob，无一次 `question`；
- dh-backend 日志中 `agent.question` 事件出现次数为 0；
- 同一会话昨天（需求澄清阶段，由点名 `question` 工具的模板/skill 主导）正常调用过 177 次 `question` 工具。

即：弹层链路（gatewayd 检测 → agent.question → 前端弹层）本身完好，是协议文档的工具名与环境不匹配导致模型主动放弃了工具调用。

## 解决方案

### 1. personal-stub 自动补丁（平台层根治）

`apps/personal-stub/main.go` 新增 `ensureCometQuestionToolName`，与现有 `ensureCometClassicLanguage` 同一模式：

- 将已安装的 `decision-point.md` 中所有 `AskUserQuestion` 字面量替换为 `question`；
- 幂等：不含旧工具名时不重写文件；文件不存在（未安装）直接跳过；
- personal-stub **每次启动**都执行（`initCometGlobal` 前置路径），`comet update` 覆盖后自动重打；新装路径（`comet init` 成功后）同步补调；
- 读/写失败仅告警不阻塞。

路径、工具名等字面量均提取为常量（`cometDecisionPointDocRel`、`cometLegacyQuestionToolName`、`cometOpencodeQuestionToolName`）。

### 2. 存量环境即时修复

对当前已安装的 `~/.config/opencode/skills/comet/reference/decision-point.md` 直接执行了同等替换（4 处），无需等待 personal-stub 重启。

### 验证

- 临时单测 3 用例（替换生效 / 幂等不重写 / 文件缺失静默跳过）全部通过；按仓库惯例测试文件验收后已删除。
- `apps/personal-stub`：`go build ./... && go vet ./...` 通过，0 warning。
- `scripts/restart-dev.sh` 重启全链路，personal-stub 已用新代码重新构建，dh-backend/frontend/crawler 正常。

### 注意事项

- **旧会话可能仍在文本降级模式**：协议规定"本会话结构化提问不可用"的判定会话内粘滞，该结论已存在于长会话的对话历史中。验证修复请**新开会话**。
- `comet update` 升级包后会重新覆盖 skill 文件，personal-stub 启动时的幂等补丁会自动重打；若上游改写该文档导致替换无匹配，补丁静默跳过（不硬改），届时需重新评估。
- 上游根治：建议给 `@rpamis/comet` 提 issue——decision-point.md 应按 harness 映射工具名（opencode=`question`，claude=`AskUserQuestion`）。

## 相关代码

- `apps/personal-stub/main.go` — `initCometGlobal`、`ensureCometQuestionToolName`。
- `apps/dh-frontend/src/pages/Chat.tsx` — 提问弹层渲染（`pendingQuestion` 驱动，本次未改动）。
- `docs/bugs/2026-08-11-comet-question-format-fixes.md` — 提问格式约束（commands.yaml/continueReminder 侧，互补）。
