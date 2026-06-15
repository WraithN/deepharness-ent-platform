# AGENTS.md — DeepHarness Enterprise Platform

> 本文件面向 AI 编程助手阅读。项目主要文档语言为中文，代码注释也以中文居多，因此本文档使用中文编写。

## 1. 项目概述

**DeepHarness Enterprise Platform** 是一个面向开发团队的多租户 AI 辅助编码平台。仓库采用 **Turborepo + pnpm workspaces + Go workspaces** 组织的 monorepo 结构，包含：

- `apps/web`：React + Vite + TypeScript 前端应用（包名 `@repo/web`）。
- `apps/agent-runtime`：Agent 运行时（包名 `@repo/agent-runtime`），定位为外部 Rust 可执行程序（OpenCode / Claude Code 等智能体封装），当前为 Go 占位实现。
- `apps/dh-backend`：DeepHarness 后端统一入口（包名 `@repo/dh-backend`），包含管理控制台接口、WebSocket 会话、Agent Runtime 生命周期管理，以及 identity / project / workitem / orchestrator / pr-agent / audit 等业务模块。
- `apps/agent-runtime/mock`：本地 Agent SSE 模拟器（独立 Go 模块），用于模拟外部 Agent Runtime 的流式响应。
- `packages/go-sdk`：共享 Go SDK，包含 DDD 领域模型和基础设施抽象。
- `packages/ui`：共享 React UI 组件库。
- `packages/api-types`：前后端共享 API TypeScript 类型。
- `packages/config`：共享配置（tsconfig, eslint presets）。

业务核心围绕"智能会话"展开，提供 Skill 市场、Prompt 市场、需求分析、智能评审、智能测试、数据大盘、空间设置等功能。详细需求说明见 `apps/web/docs/prd.md`。

## 2. 仓库结构

```
.
├── package.json              # 根 workspace 脚本，仅依赖 turbo
├── turbo.json                # Turborepo 任务配置
├── pnpm-workspace.yaml       # pnpm workspace：apps/*, packages/*
├── go.work                   # Go workspace，管理所有 Go 模块
├── README.md
├── .gitignore
├── apps/
│   ├── web/                  # 前端应用
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── vite.config.dev.ts
│   │   ├── tailwind.config.js
│   │   ├── components.json
│   │   ├── biome.json
│   │   ├── sgconfig.yml
│   │   ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json / tsconfig.check.json
│   │   ├── .rules/
│   │   ├── index.html
│   │   ├── public/
│   │   └── src/
│   ├── agent-runtime/        # Agent 运行时（Rust 占位，当前为 Go 占位实现）
│   │   ├── main.go
│   │   ├── go.mod
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── dh-backend/           # DeepHarness 后端统一入口
│   │   ├── main.go
│   │   ├── go.mod
│   │   ├── Makefile
│   │   ├── package.json
│   │   ├── config/           # 环境配置加载
│   │   ├── constants/        # 全局常量
│   │   ├── agent/            # Agent 相关：客户端、对话模型、编排模块
│   │   │   ├── client/       # HTTP+SSE 客户端
│   │   │   ├── chat/         # Session/Message 领域模型、存储接口与内存实现
│   │   │   │   ├── session/  # Session/Message 内存存储实现
│   │   │   │   └── tests/
│   │   │   └── orchestrator/ # Agent 会话编排
│   │   ├── gateway/          # HTTP 路由、处理器、中间件、服务器组装
│   │   │   ├── handler/
│   │   │   ├── websocket/    # WebSocket Hub / broker / 连接管理
│   │   │   │   └── broker/
│   │   │   │       └── memory/
│   │   │   ├── middleware/
│   │   │   └── server/
│   │   ├── worker/           # 每会话 Agent Worker 生命周期
│   │   ├── domain/           # 业务领域模块（每个模块下含 handler / object / service）
│   │   │   ├── identity/
│   │   │   ├── project/
│   │   │   ├── workitem/
│   │   │   ├── pragent/
│   │   │   └── audit/
│   │   └── tests/            # 本地测试工具
│   │       └── test-agent/   # Agent Client 本地测试工具
│   └── mock/                 # 本地 Agent SSE 模拟器（独立模块）
│       ├── main.go
│       ├── go.mod
│       ├── Makefile
│       └── package.json
├── packages/
│   ├── ui/                   # 共享 UI 组件库
│   │   ├── package.json
│   │   └── src/
│   ├── api-types/            # 共享 API 类型
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/index.ts
│   ├── go-sdk/               # Go 共享 SDK
│   │   ├── go.mod
│   │   ├── domain/           # DDD 领域模型
│   │   │   ├── identity/
│   │   │   ├── project/
│   │   │   ├── workitem/
│   │   │   ├── agent/
│   │   │   └── audit/
│   │   ├── infrastructure/   # 基础设施抽象
│   │   │   ├── git/
│   │   │   ├── workitem-tracker/
│   │   │   ├── pr-agent/
│   │   │   └── llm/
│   │   └── common/
│   └── config/               # 共享配置
│       └── package.json
└── infra/
    ├── database/             # 数据库迁移脚本
    ├── k8s/                  # K8s 部署清单
    ├── helm/                 # Helm Chart
    └── docker/               # Dockerfile
```

## 3. 技术栈

### 前端
- **框架**：React 18（函数组件 + Hooks）
- **路由**：react-router / react-router-dom v7
- **构建工具**：Vite（实际使用 `rolldown-vite` 别名）
- **语言**：TypeScript 5.9（`strict: true`）
- **样式**：Tailwind CSS v3 + `tailwindcss-animate` + `tailwindcss-intersect` + `@tailwindcss/container-queries`
- **组件库**：shadcn/ui（New York 风格），基于 Radix UI + `class-variance-authority` + `tailwind-merge`
- **主题**：`next-themes`（`class` 策略，默认 `system`），深色主题为 Dracula 风格
- **图标**：`lucide-react`
- **表单**：`react-hook-form` + `zod`（通过 `@hookform/resolvers`）
- **通知**：`sonner`
- **图表**：`recharts`
- **内部插件**：`miaoda-sc-plugin`

### 后端
- **语言**：Go 1.22
- **框架**：标准库 `net/http` + `http.ServeMux`
- **架构**：DDD，领域模型定义在 `packages/go-sdk/domain/`
- **中间件**：手写 CORS、请求日志
- **构建**：各服务独立 `go build` 或通过 `Makefile`

### 工具链
- **包管理器**：pnpm 9.15.5（`packageManager` 已锁定）
- **Monorepo 调度**：Turborepo 2.5.3
- **Go 工作区**：`go.work` 管理所有 Go 模块
- **Linter**：Biome 2.4.5（仅启用 lint，formatter 关闭）
- **类型检查**：`tsc --noEmit`；lint 脚本中还使用 `tsgo`
- **代码规则扫描**：ast-grep，规则存放在 `apps/web/.rules/`

## 4. 代码组织约定

- **前端路径别名**：`@/*` 映射到 `apps/web/src/*`
- **Go 模块路径**：所有模块使用 `github.com/deepharness/deepharness-ent-platform/...` 前缀
- **Go SDK 引用**：各服务通过 `replace` 指令引用本地 `packages/go-sdk`
- **UI 组件**：位于 `src/components/ui/`，使用 `cva` 管理变体，通过 `cn()` 合并类名
- **页面组件**：位于 `src/pages/`，在 `src/routes.tsx` 中集中注册路由
- **服务端口**：
  - DH Backend: 8080
  - Agent Runtime: 8090

## 5. 构建与开发命令

所有命令均在仓库根目录执行。

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装全部依赖 |
| `pnpm dev` | 同时启动所有服务（Turborepo 并行） |
| `pnpm build` | 构建所有 app 和 service |
| `pnpm lint` | 对所有 app 执行 lint |
| `pnpm check-types` | 对所有 app 执行类型检查 |
| `pnpm test` | 运行所有测试 |

启动本地 MySQL（可选，未启动时 Go 服务使用内存 mock）：

```bash
docker compose -f infra/docker/compose.mysql.yml up -d
```

单独运行某个应用：

```bash
# 前端
pnpm --filter @repo/web dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

## 6. 代码风格与检查

与改造前一致，详见原 `apps/web/.rules/` 和 `biome.json`。

## 7. 测试说明

- **当前仓库中没有测试文件**。
- **后端**：各服务可通过 `go test -v ./...` 运行测试；目前尚无测试。
- **前端**：`package.json` 未配置测试命令和测试运行器。

## 8. 安全与部署注意事项

- 后端 CORS 中间件当前设置为 `Access-Control-Allow-Origin: *`，生产环境应收紧。
- `apps/dh-backend` 目前无身份校验、无请求限流，生产需补充。
- `infra/database/` 提供 MySQL 8.0 Schema 脚本（`identity/schema.sql`、`workitem/schema.sql`）。
- `infra/docker/compose.mysql.yml` 提供 MySQL 8.0 开发环境。
- `packages/go-sdk/infrastructure/mysql/` 提供统一的 MySQL 连接封装。
- `infra/docker/` 提供了 `Dockerfile.web`。
- `infra/k8s/` 提供了基础 K8s 部署清单。
- `infra/helm/` 提供了 Helm Chart 模板。
- 仓库中未提供 CI/CD 配置，部署流程需自行补充。

## 9. 快速参考

```bash
# 安装并启动开发环境
pnpm install
pnpm dev

# 仅前端开发
pnpm --filter @repo/web dev

# 仅 DH Backend
pnpm --filter @repo/dh-backend dev

# 构建全部
pnpm build

# Go 测试
pnpm --filter @repo/dh-backend test
```

## 13. 用户自定义规则（不可覆盖）

以下规则为硬性约束，在任何代码变更或 AGENTS.md 更新中**必须保留**，不得删除或修改：

### 规则1：自动化编译与启动
每次需求开发或缺陷修复完成后，必须自动执行编译并启动应用：
1. 运行 `pnpm build` 构建全部应用（前端 `apps/web` + 后端各服务）
2. 使用 `pnpm dev` 启动开发服务器（前端 Vite dev server + 后端 Go services）
3. 通过 `curl` 或浏览器访问确认前后端功能正常后再告知用户

### 规则2：缺陷排查流程
如果 5 步之内无法定位缺陷根因：
1. 在相关代码路径中增加详细日志输出（使用 `console.log` 或项目日志服务）
2. 要求用户在真实环境中进行测试操作
3. 通过观察用户测试产生的日志来分析和排查问题
4. 根据日志反馈迭代修复

### 规则3：缺陷文档化
所有缺陷修改必须同步记录到 `docs/bugs/` 目录：
- 文件名格式：`YYYY-MM-DD-<brief-description>.md`
- 必须包含三部分内容：
  1. **现象**：缺陷的具体表现和影响范围
  2. **根因**：导致缺陷的根本原因分析
  3. **解决方案**：修复措施和验证结果

### 规则4：代码嵌套限制
代码中最多不超过 3 层嵌套：
- 当嵌套超过三层时，必须进行以下优化之一：
  - **小函数提取**：将嵌套逻辑提取为独立函数
  - **Guard Clause**：使用提前返回（early return）减少嵌套层级
- 目标：保持主流程清晰可读，避免深层嵌套导致的认知负担

### 规则5：复杂逻辑注释
复杂的业务逻辑必须添加详细的注释：
- **必须注释的场景**：
  - 涉及多步状态转换的流程
  - 非直观的算法或计算逻辑
  - 与外部系统交互的边界处理
  - 存在特殊 case 或容错处理的代码块
- **注释要求**：
  - 对关键变量和条件判断给出上下文解释
  - 如果逻辑有已知限制或 TODO，必须明确标注

### 规则6：重复逻辑封装
同一逻辑在代码中出现超过两处时，必须封装为小函数：
- **判定标准**：相同的代码片段或逻辑模式在项目中出现 ≥2 次
- **封装要求**：
  - 提取为语义清晰的命名函数（动词开头，描述行为）
  - 将函数放置在合适的模块或工具文件中（如 `src/lib/utils.ts` 或相关领域目录）
  - 通过参数化提高复用性，避免为相似逻辑创建多个几乎相同的函数
- **例外**：UI 层极简单的 JSX 重复（如纯样式类名组合）可酌情处理，但业务逻辑必须严格遵循

### 规则7：禁止魔法值
代码中不允许出现魔法值（Magic Values），所有字面量必须提取为常量：
- **必须提取的字面量**：
  - 数字（如超时时间、分页大小、状态码、阈值等）
  - 字符串（如错误消息、路由路径、localStorage key、API 端点等）
  - 布尔值组合或标志位
- **常量组织**：
  - 前端模块级常量：放在使用文件顶部或同目录 `constants.ts` 中
  - 前端全局常量：放在 `apps/web/src/lib/constants.ts` 或 `apps/web/src/config/` 中
  - Go 常量：放在包级别 `const` 块或同目录 `constants.go` 中
  - 常量命名使用 UPPER_SNAKE_CASE（如 `MAX_RETRY_COUNT`、`DEFAULT_PAGE_SIZE`）
- **例外**：
  - `0`、`1`、`-1` 在明显上下文中的使用（如数组索引 `arr[0]`）
  - `true`/`false` 在简单条件判断中
  - 纯 UI 展示用的临时字符串（如调试日志中的分隔符 `"---"`）

### 规则8：编译 warnings 清零
每次需求开发或缺陷修复完成后，**必须解决所有编译器 warnings**，不允许遗留未处理的 warning 上线：
- **Go**：运行 `go vet ./...` 于所有服务目录，确保 0 warnings
- **TypeScript**：运行 `npx tsc --noEmit -p apps/web/tsconfig.check.json`，确保 0 errors
- 对于确实需要保留的代码（如预留的公共 API、未来的扩展点），使用显式抑制并在注释中说明理由：
  - Go：`//nolint:<linter-name> // <reason>`
  - TypeScript：`// @ts-expect-error <reason>`
- 禁止通过批量添加全局忽略配置掩盖真正的代码质量问题

### 规则9：设计规范遵循与 DESIGN.md 维护
- **默认遵循**：除非用户**明确要求**变更样式，否则 Agent 在进行任何涉及 UI 设计、样式调整、新增组件或修改界面布局的变更时，**必须先阅读并严格遵循 `DESIGN.md` 中的设计规范**
- **强制更新**：如果用户明确要求变更样式（如修改主题色、调整组件风格、改变布局规范等），Agent 在完成样式变更后，**必须同步更新 `DESIGN.md`**，确保设计文档始终与实际代码保持一致
- `DESIGN.md` 是项目 UI/UX 设计的单一事实来源，涵盖色彩系统、字体系统、间距布局、组件规范、图标系统等完整的设计规范

### 规则10：规则持久化
以上九条规则（规则1-9）在变更 AGENTS.md 时必须保留，不允许被覆盖、删除或修改。任何对 AGENTS.md 的更新都应在保留这些规则的前提下进行追加或调整其他内容。
