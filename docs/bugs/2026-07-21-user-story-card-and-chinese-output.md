# /user-story 指令未返回卡片且输出英文

## 现象

1. 在聊天中使用 `/user-story` 指令后，模型返回的是纯文本或英文内容，没有渲染用户故事卡片。
2. 模型输出中偶尔暴露内部工作目录（如 `/home/.../workspace/...` 的绝对路径）。
3. 模型有时会使用 `/workflows`、`/commit` 等后台 slash command 引导用户去其他工作流查看结果。
4. 其他指令（如 `/prd-write`、`/code`）也存在同样的问题：前端的通用规则在后端被指令模板替换后丢失，导致模型不遵守中文输出、隐藏目录、禁用后台工作流等约束。

## 根因

1. **通用提示词规则在指令路径丢失**：前端 `use-ag-ui-chat.ts` 会在用户输入前包装一段通用规则（要求中文、禁止后台工作流、隐藏内部目录等）。但后端 `interceptCommands` 在识别到斜杠指令后，会直接用指令模板**替换整条用户消息**，导致前端的通用规则被覆盖，模型仅看到指令模板内容。
2. **指令模板缺少强制中文约束**：`/user-story` 等模板本身没有明确要求“所有回复必须使用中文”，模型在缺少约束时容易输出英文。
3. **模板文件路径存在中文占位符**：`/user-story` 模板原先使用 `需求名称-user-stories.md` 这种中文占位符，模型经常原样输出，导致文件路径被前端 `hasUnresolvedPlaceholders` 过滤，既无法生成文件也无法展示文件卡片。
4. **内嵌默认模板与外部 YAML 不一致**：`command_config_defaults.go` 中的 `/user-story` 内嵌模板没有包含 `[[CARD:user_story]]` 标记，当 `config/commands.yaml` 缺失时，指令无法触发用户故事卡片渲染。

## 解决方案

1. **后端统一注入通用提示词规则**：在 `apps/dh-backend/gateway/handler/command.go` 的 `renderTemplate` 中，为每个指令模板自动追加 `commonPromptRules`，确保所有指令都强制遵循：
   - 全部使用中文回复
   - 不暴露内部工作目录
   - 禁止使用 `/workflows`、`/commit`、`/pr`、`/review` 等后台 slash command
   - 正确使用 `[[FILE:...]]`、`[[PROJECT:...]]`、`[[CARD:...]]` 标记
2. **修复 `/user-story` 模板**：
   - 明确要求标题、正文、验收标准、标记全部使用中文。
   - 将文件命名占位符从 `需求名称` 改为 `{需求关键词}`，并说明使用英文或拼音（如 `login-user-stories.md`），避免中文占位符被原样输出。
   - 保留 `[[CARD:user_story]]` 标记，确保前端能检测到卡片并渲染 `UserStoryCard`。
3. **同步内嵌默认模板**：在 `command_config_defaults.go` 中同步 `/user-story` 模板，保证外部 YAML 缺失时行为一致。

## 修改文件

- `apps/dh-backend/gateway/handler/command.go`
- `apps/dh-backend/config/commands.yaml`
- `apps/dh-backend/gateway/handler/command_config_defaults.go`

## 验证结果

- `go vet ./...`：0 warnings
- `go build ./...`：成功
- `pnpm check-types`：全部通过
- `pnpm lint`：全部通过（ast-grep 环境缺失警告与代码无关）
- `pnpm build`：全部通过
- `bash scripts/restart-dev.sh`：前后端服务正常启动
- `curl http://localhost:8080/health`：返回 `{"status":"ok"}`
- `curl http://localhost:8888`：返回 200
- `GET /api/v1/commands`：`/user-story` 模板已更新为包含中文约束和卡片标记的版本
