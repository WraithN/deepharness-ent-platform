# 智能会话欢迎卡片按角色分类与指令补全

## 现象

智能会话首页的欢迎卡片（welcome cards）与 `/api/v1/commands` 指令列表存在以下问题：

1. 卡片仅按默认角色展示，未根据当前用户角色（研发、测试、设计、产品）分类展示。
2. 缺少用户期望的若干常用指令：
   - 研发：单元测试、代码评审已有，但缺少生成单测等更细粒度指令。
   - 测试：仅有 BUG 分析，缺少测试用例、自动化脚本、测试报告。
   - 设计：仅有制作原型，缺少 UI 规范、设计走查、Design Token。
   - 产品：缺少用户故事拆分、数据分析。
3. 部分卡片的文案与指令无法一一对应，导致点击卡片后无法正确插入指令。

## 根因

1. 后端 `apps/dh-backend/config/commands.yaml` 与 `apps/dh-backend/gateway/handler/command_config_defaults.go` 中只预置了 6 条指令，未覆盖测试、设计、产品等角色的全部高频场景。
2. 前端 `apps/dh-frontend/src/pages/Chat.tsx` 中的 `WELCOME_CARDS_BY_ROLE` 写死了较少的卡片，且角色映射与后端指令不同步；`COMMAND_ICON_MAP` 也未包含新指令的图标，导致新增指令无法渲染。

## 解决方案

### 后端

在 `apps/dh-backend/config/commands.yaml` 与 `apps/dh-backend/gateway/handler/command_config_defaults.go` 中追加 10 条新指令，覆盖：

- 研发：`/unit-test`（生成单测）
- 测试：`/test-case`（生成测试用例）、`/auto-test`（自动化脚本）、`/bug-analysis`（BUG 分析）、`/test-report`（测试报告）
- 设计：`/ui-spec`（UI 规范）、`/design-review`（设计走查）、`/design-token`（Design Token）
- 产品：`/user-story`（用户故事拆分）、`/data-analysis`（数据分析）

最终 `/api/v1/commands` 返回 16 条指令（6 旧 + 10 新）。

### 前端

在 `apps/dh-frontend/src/pages/Chat.tsx` 中：

1. 从 `lucide-react` 导入新图标：`BarChart3`、`ClipboardList`、`Eye`、`FileBarChart`、`Layout`、`ListChecks`、`Palette`。
2. 更新 `COMMAND_ICON_MAP`，将 10 条新指令映射到对应图标。
3. 更新 `WELCOME_CARDS_BY_ROLE`，按角色分类展示卡片：
   - 研发：编写代码、修复 BUG、代码评审、生成单测
   - 测试：生成测试用例、自动化脚本、BUG 分析、测试报告
   - 设计：制作原型、UI 规范、设计走查、生成 Design Token
   - 产品：撰写 PRD、用户故事拆分、需求调研、数据分析
4. 将 `WELCOME_CARDS_DEFAULT` 也改为产品视角的 4 张卡片，确保默认角色体验一致。

### 验证结果

- `curl http://localhost:8080/api/v1/commands` 返回 16 条指令，新指令均存在。
- `pnpm --filter @repo/dh-frontend check-types` 通过。
- `go vet ./apps/dh-backend/... ./apps/agent-stub/...` 通过。
- `pnpm lint` 通过。
- `pnpm build` 通过。
- `pnpm dev` 启动后，前端首页与后端接口均返回 200。

## 相关文件

- `apps/dh-backend/config/commands.yaml`
- `apps/dh-backend/gateway/handler/command_config_defaults.go`
- `apps/dh-frontend/src/pages/Chat.tsx`
