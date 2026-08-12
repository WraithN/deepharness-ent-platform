# 2026-08-11 comet 提问流程修复：一次多问、英文提问、无参考选项

## 现象

智能会话走 comet classic 流程时（opencode agent 加载 comet-open → openspec-explore skill），agent 在需求澄清阶段一次抛出 4 个英文编号问题，且不带参考选项。前端提问卡片本身支持选项按钮（`q.options`）与 "A./B." 文本选项解析（`apps/dh-frontend/src/pages/Chat.tsx` 的 `parseInlineOptions`），但因为模型输出不规范，UI 只能渲染纯文本，用户无法点选。

影响范围：所有带 `cometTemplate` 的指令（/code、/debug、/review、/unit-test、/refactor、/req-breakdown、/arch-design）走 comet 流程时的需求澄清交互。

## 根因

1. **cometTemplate 缺少提问约束**：`apps/dh-backend/config/commands.yaml` 各 cometTemplate 只有【语言要求】，没有提问规范。openspec-explore skill 是第三方 npm 包安装的（会被 `comet init` 重装覆盖），不能直接改 skill 文件，只能在模板与配置层约束。
2. **respond fallback 强指令错误**：`apps/dh-backend/gateway/handler/agui_respond.go` 的 `continueReminder` 硬编码"你当前处于 /grill-me 需求澄清流程"，且要求 `questions[0].options` 填空数组 `[]`，导致 question 工具调用不带选项，前端卡片没有按钮数据。
3. **comet 全局配置语言未保证**：`comet init` 生成的 `~/.comet/config.yaml` 未强制 `classic.language: zh-CN`，agent 可能用英文提问。

## 解决方案

1. **commands.yaml 追加【提问规范】**：7 个 cometTemplate 统一在【语言要求】之后插入【提问规范】块——每轮只提一个问题；每题附 2~3 个具体、互不相同的参考选项；调用 question 工具时 questions 数组只放一个问题且 options 禁止空数组；无法调用 question 工具时以纯文本提问（问题独占一段，选项按 "A. xxx" 独占一行）；提问与选项全程中文。普通 `template` 未改动。
2. **command_config_defaults.go 无需同步**：经确认该文件的内嵌 fallback 只含普通 `template`，没有任何 cometTemplate 内容，按既定方案不硬塞。
3. **agui_respond.go continueReminder 修正**：去掉 /grill-me 场景硬编码，改为通用"需求澄清流程"；`questions[0].options` 由"空数组"改为"必须填 2~3 个参考选项（与文本选项一致）"；补充"提问与选项全程使用中文，禁止英文提问"；注释说明该约束与前端提问卡片渲染约定的对齐关系。其余 fallback 行为不变。
4. **personal-stub 写入中文配置**：`apps/personal-stub/main.go` 新增 `ensureCometClassicLanguage`，在 `comet init` 成功后读-改-写 `~/.comet/config.yaml`：文件不存在则创建（仅含 `classic.language: zh-CN`）；已存在则保留其它所有配置仅更新该键；值已正确则不重写（幂等）；YAML 损坏时不覆盖仅告警。配置路径段、键名、语言值、权限位均提取为常量。

## 验证

- `python3 yaml.safe_load` + 结构断言：7/7 cometTemplate 均含【提问规范】，YAML 可正常解析。
- `apps/dh-backend`：`go build ./... && go vet ./...` 通过，0 warning。
- `apps/personal-stub`：`go build ./... && go vet ./...` 通过，`main.go` gofmt 干净。
- `ensureCometClassicLanguage` 临时单测 4 个用例（不存在则创建 / 保留其它配置仅更新 / 幂等不重写 / 损坏不覆盖）全部通过；按仓库惯例测试文件验收后已删除。

## 相关代码

- `apps/dh-backend/config/commands.yaml` — 7 处 cometTemplate 的【提问规范】。
- `apps/dh-backend/gateway/handler/agui_respond.go` — `fallbackRunForRespond` 的 `continueReminder`。
- `apps/personal-stub/main.go` — `initCometGlobal`、`ensureCometClassicLanguage`。
- `apps/dh-frontend/src/pages/Chat.tsx` — `parseInlineOptions`（前端解析侧，本次未改动）。
