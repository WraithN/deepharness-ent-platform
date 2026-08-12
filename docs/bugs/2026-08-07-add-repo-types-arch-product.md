# 新增仓库类型“架构库/产品库”并统一前后端定义

## 现象

- 仓库类型仅区分“开发库(dev)”和“用例库(case)”，随着业务扩展需要支持“架构库”与“产品库”。
- 工程代码 Tab 的仓库类型下拉可以选择所有仓库类型，不符合业务预期：工程代码应只能关联“开发库”和“架构库”。
- 前后端对仓库类型的枚举值、展示文案分散定义，新增类型时容易遗漏。

## 根因

1. 类型常量分别散落在 Go SDK、`api-types` 包、前端本地类型文件和各个 UI 组件中，没有统一维护。
2. 后端校验仅识别 `dev`/`case` 两种仓库类型。
3. 前端工程代码面板直接遍历所有仓库类型渲染下拉框，未做工程库过滤。

## 解决方案

1. **统一类型定义**
   - 后端：`packages/go-sdk/domain/repository/repository.go` 新增 `RepoTypeArch = "arch"`、`RepoTypeProduct = "product"`。
   - 共享 API 类型：`packages/api-types/src/index.ts` 与 `apps/dh-frontend/src/lib/api-types.ts` 扩展 `RepoType` 为 `"dev" | "arch" | "product" | "case"`。
   - 前端常量：新建 `apps/dh-frontend/src/lib/repository-constants.ts`，集中定义 `REPO_TYPE_*`、`REPO_TYPE_LABELS`、`ENGINEERING_REPO_TYPES = ['dev', 'arch']`。

2. **后端感知新类型**
   - `apps/dh-backend/domain/repository/handler.go` 的 `isValidRepoType` 增加 `arch`、`product` 校验。
   - 扫描/文件路径等依赖 `RepoType` 常量。

3. **工程代码 Tab 限制可选类型**
   - `ProjectCode` 组件使用 `ENGINEERING_REPO_TYPES` 渲染仓库类型下拉，默认自动选择首个工程类型仓库。
   - 预览模式/自动注册仓库等逻辑同步按新类型处理。

4. **仓库设置修改类型时增加红字风险提示**
   - 在 `apps/dh-frontend/src/pages/Settings.tsx` 的“仓库设置”弹窗中，当修改已有仓库（非本地新增行）的类型时，显示红色警告文案：
     > 修改仓库类型会显著影响该库可用的功能（如工程代码、用例设计、智能评审等），请谨慎操作。
   - 使用 `text-destructive` 样式与 `AlertTriangle` 图标，仅在 `!repoSettingsRepo.id.startsWith(LOCAL_REPO_ID_PREFIX)` 时展示。

5. **修复 /code 在 comet 流程下不返回卡片的问题**
   - 原因：`comet_flow` 开关启用时，`/code` 切换到 `cometTemplate`，该模板早期只要求加载 `comet-classic` skill，没有明确要求 agent 输出 `[[PROJECT:...]]` / `[[FILE:...]]` 标记；前端只有识别到这些标记才会渲染卡片。
   - 修复：在 `apps/dh-backend/config/commands.yaml` 的 `/code` `cometTemplate` 中追加与常规 `template` 一致的【代码输出要求】和【输出标记】，使两种模式行为一致。当前模板内容已包含：
     - 代码写入 `{WORKSPACE_PATH}/dev-jobs/{工程名}/`。
     - 技术文档用 `[[FILE:...]]` 标记。
     - 创建或修改整个工程用 `[[PROJECT:...]]` 标记。
   - 同时开启 `comet_flow` 平台开关（`/api/v1/platform/feature-flags` 中 `comet_flow` 为 `enabled: true`），确保后端渲染时确实走 `cometTemplate`。

6. **修复 comet 流程未调用导致 `.aicoding` 不生成的问题**
   - 原因：`.aicoding` 目录并非由 Comet 工作流生成；它是用例设计（`TestCaseDesign`）模块中用于存储用例绑定关系元文件（`.aicoding/case-mapping.yaml`）的约定路径。Comet 工作流本身只产生 `.comet.yaml`、`.openspec.yaml`、`proposal.md`、`design.md`、`tasks.md` 等产物。
   - 修复/确认：
     1. 本机已安装 `comet` CLI（`~/.local/bin/comet`）和 `comet-classic` skill（`~/.config/opencode/skills/comet-classic/SKILL.md`）。
     2. `personal-stub` 启动时 `initCometGlobal()` 检测到 skill 已存在，跳过重复安装，不影响流程。
     3. `comet_flow` 开关已启用，重启后 gatewayd 会加载 skill 并走 Comet 工作流。
     4. 若仍需要 `.aicoding/case-mapping.yaml`，应通过用例设计模块生成，而不是通过 Comet 指令。

7. **perfect-chinese-name 工程本地路径说明**
   - 仓库在本地工作区目录结构中存放于 `{workspaceRoot}/{userId}/{workspaceId}/dev-jobs/{repoName}/`，而不是 `projects/`。
   - 当前 `pefect-chinese-name`（仓库名称本身拼写缺少 `r`）已同步到 `.../dev-jobs/pefect-chinese-name/`，工程代码 Tab 可以正常展示文件树。
   - 如在其他目录找不到，请检查是否按上述路径查看，或确认仓库已在“空间设置 > 代码仓库”中完成同步。

## 验证结果

- `pnpm --filter @repo/dh-frontend check-types` 通过。
- `pnpm build` 全量构建成功（7 successful）。
- `go vet ./...` 在 `apps/dh-backend` 和 `apps/personal-stub` 下无警告。
- 浏览器回归截图确认：
  - 工程代码 Tab 的仓库类型下拉仅显示“开发库 / 架构库”。
  - 仓库设置弹窗在修改已有仓库类型时显示红字风险提示。
- 通过 `curl` 确认 `comet_flow` 平台开关已启用（`enabled: true`）。
- `comet` CLI 与 `comet-classic` skill 已存在，personal-stub 重启日志无 skill 安装错误。
