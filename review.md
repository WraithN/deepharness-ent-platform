# DeepHarness Enterprise Platform — 代码审查报告

> 审查日期：2026-06-08  
> 审查范围：全仓库（`apps/web`、`services/*`、`packages/*`、根配置）

---

## 1. 总体评价

本项目是一个基于 **Turborepo + pnpm workspaces + Go workspaces** 的 monorepo，前端使用 React 18 + Vite + TypeScript + Tailwind CSS，后端采用 Go 1.22 标准库构建微服务。项目整体架构设计合理，目录结构清晰，Go SDK 领域模型遵循 DDD 思想，前端 UI 基于 shadcn/ui 体系。

**当前阶段：骨架/原型阶段**。后端服务仅有极简的 mock handler，前端以 mock 数据驱动，尚未接入真实 API。代码中存在较多与 `AGENTS.md` 自定义规则（如魔法值禁止、嵌套限制、重复逻辑封装等）相违背的问题，需要重点关注。

---

## 2. 前端审查（`apps/web`）

### 2.1 🔴 严重问题

#### 2.1.1 超大文件，单组件职责过重

| 文件 | 行数 | 问题 |
|------|------|------|
| `src/pages/ProjectCode.tsx` | ~1466 | 包含文件树、Markdown 渲染器、代码编辑器、Iframe 预览、评审面板等 |
| `src/pages/Chat.tsx` | ~1363 | 包含三栏侧边栏、看板、详情抽屉、历史会话、输入工具栏等 |
| `src/pages/Settings.tsx` | ~1024 | 包含 7 个 Tab 的全量配置表单和弹窗 |

**影响**：
- 可读性差，定位问题困难。
- 任意小改动都需重新编译整个大文件。
- 状态过多，容易产生意想不到的副作用。

**建议**：
- 按功能拆分出独立子组件（如 `ChatSidebar`、`KanbanBoard`、`MessageInputToolbar`）。
- 提取自定义 Hook（如 `useKanban`、`useMessageQueue`）管理局部状态。
- 目标：单文件不超过 300 行。

#### 2.1.2 类型定义与 Mock 数据严重重复、分散

**示例 1：`Chat.tsx` 中重新定义了与全局类型几乎一致的接口：**

```tsx
// Chat.tsx 第 55-68 行
interface ReqItem { id: string; title: string; ... }
interface DefectItem { id: string; title: string; ... }
interface CaseItem { id: string; title: string; ... }
```

而 `src/types/index.ts` 中已有 `Requirement` 接口，字段高度重叠。

**示例 2：Mock 数据散落在页面文件内部：**

- `Chat.tsx` 中内嵌 `MOCK_HISTORY`、`MOCK_MESSAGES`、`MOCK_REQUIREMENTS`、`MOCK_DEFECTS`、`MOCK_CASES` 等常量。
- `ProjectCode.tsx` 中内嵌 `repositories`、`mockFileSystem`、`mockMarkdownDoc`。
- `Settings.tsx` 中内嵌 `mockSettings` 等（虽然部分从 `mock/data.ts` 导入，但页面内仍有大量硬编码数据）。

**建议**：
- 所有类型统一定义在 `src/types/` 或 `packages/api-types/`。
- 所有 Mock 数据统一收口到 `src/mock/` 目录，按领域拆分为 `mock/chat.ts`、`mock/requirements.ts` 等。

#### 2.1.3 大量使用魔法值与魔法字符串

违反 `AGENTS.md` 规则 7。

**示例：**

```tsx
// Chat.tsx 第 71-78 行
const MOCK_HISTORY = [
  { id: '1', title: '实现登录页面UI', date: '10分钟前', type: 'ui' },
  // ...
];

// Chat.tsx 第 333-343 行
const availableRepos = [
  { id: '1', name: 'frontend-web' },
  { id: '2', name: 'backend-api' },
];

// Settings.tsx 第 124 行
const userRole = localStorage.getItem('userRole') || 'user';
// 'user' 作为默认角色字符串未提取为常量。

// Chat.tsx 多处
const baseTime = Date.now();
addMsg(800, { ... });
addMsg(1800, { ... });
addMsg(2800, { ... });
```

**建议**：
- 提取常量到 `src/lib/constants.ts` 或页面同级 `constants.ts`。
- 时间延迟、角色枚举、本地存储 key、路由路径等全部常量化。

#### 2.1.4 过深的 JSX 嵌套

违反 `AGENTS.md` 规则 4。

多个页面（尤其是 `Chat.tsx`、`Settings.tsx`）存在 5-7 层的 JSX 嵌套，加上条件渲染和 map 循环，实际阅读时嵌套层级超过 10 层。

**建议**：
- 将列表项提取为独立子组件。
- 将条件渲染块提取为独立函数组件或变量。
- 使用 Guard Clause 提前返回空状态。

### 2.2 🟡 中等问题

#### 2.2.1 缺乏 Service/API 抽象层

`src/services/` 目录下仅有 `.keep` 文件。`package.json` 依赖了 `axios` 和 `ky`，但业务代码中未使用任何 HTTP 客户端。

**建议**：
- 建立 `src/services/api.ts` 封装 HTTP 客户端（如 `ky`）。
- 按领域建立 `src/services/chat.ts`、`src/services/requirements.ts` 等 API 模块。
- 即使当前是 mock，也应统一通过 service 层返回 `Promise`，便于后续无缝切换真实接口。

#### 2.2.2 路由未使用懒加载

`src/routes.tsx` 直接 import 所有页面组件：

```tsx
import { Chat } from "@/pages/Chat";
import { Dashboard } from "@/pages/Dashboard";
// ... 十几个页面全量导入
```

**建议**：
- 使用 `React.lazy(() => import('@/pages/Chat'))` 实现代码分割。
- 配合 `Suspense` 提供加载状态。

#### 2.2.3 `AuthContext.tsx` 类型逃逸

```tsx
// @ts-ignore
import { supabase } from '@/db/supabase';
// @ts-ignore
import type { Profile } from '@/types/types';
// 多处使用 @ts-ignore 绕过 .then() 的类型检查
```

**建议**：
- 补充 `src/db/supabase.ts` 的类型声明，或创建 `.d.ts` 文件。
- 补充 `Profile` 类型到 `src/types/index.ts`。
- 移除所有 `@ts-ignore`，改用 `// @ts-expect-error <reason>` 并说明原因。

#### 2.2.4 状态管理过于零散

`Chat.tsx` 中声明了超过 20 个 `useState`，包括输入框、弹窗开关、展开状态、筛选条件、引用卡片等。大量状态互相交织，难以追踪。

**建议**：
- 使用 `useReducer` 将相关状态收敛到一个状态机中。
- 或使用轻量级状态管理库（如 Zustand）管理跨组件的状态。

#### 2.2.5 代码重复：颜色/标签映射

`Chat.tsx` 中 `STATUS_COLORS`、`SEVERITY_COLORS`、`REQ_STATUS_LABELS` 等映射表与 `Requirements.tsx`、`SmartReview.tsx` 等页面中的映射逻辑重复。

**建议**：
- 提取为 `src/lib/status-maps.ts` 共享工具。
- 使用函数工厂生成映射，避免复制粘贴。

### 2.3 🟢 亮点

- **UI 组件体系**：基于 shadcn/ui + Radix UI + `cva` + `tailwind-merge`，风格统一。
- **主题系统**：`next-themes` 管理 Dark Mode，深色主题采用 Dracula 风格，一致性较好。
- **路径别名**：`@/` 映射到 `src/`，配置清晰。
- **TypeScript**：`strict: true`，类型安全基础较好。

---

## 3. 后端审查（`services/*`）

### 3.1 🔴 严重问题

#### 3.1.1 所有服务均为空壳，无真实业务逻辑

7 个微服务中，仅 `api-gateway` 具备分层架构（handler / middleware / server），其余 6 个服务的 `main.go` 均为内联 handler，返回硬编码 mock 数据。

**关键缺失**：
- 无数据库连接与访问。
- 无服务间 HTTP / gRPC 调用。
- 无认证与鉴权。
- 无请求限流。
- 无结构化错误处理。

**建议**：
- 按 DDD 分层补齐：Handler → Service → Repository。
- 引入数据库连接（如 `database/sql` + `pgx` 或 ORM）。
- `api-gateway` 应实现反向路由转发到各下游服务。

#### 3.1.2 错误处理形同虚设

**示例（`identity-service/main.go`）：**

```go
mux.HandleFunc("/api/v1/users", func(w http.ResponseWriter, r *http.Request) {
    users := []identity.User{ ... }
    json.NewEncoder(w).Encode(users)
})
```

- 未设置 `Content-Type: application/json`。
- 未处理编码错误。
- 未返回 HTTP 状态码。
- 未处理请求方法校验（`GET` 以外的方法也会进入该 handler）。

**建议**：
- 封装统一的 JSON 响应函数：
  ```go
  func JSON(w http.ResponseWriter, status int, data any) {
      w.Header().Set("Content-Type", "application/json")
      w.WriteHeader(status)
      json.NewEncoder(w).Encode(data)
  }
  ```
- 引入 `github.com/go-chi/chi/v5` 或类似的轻量路由库，支持 HTTP Method 绑定。

#### 3.1.3 `workitem-service/core/service.go` 未被引用

`core/service.go` 中定义了清晰的 DDD 业务层 `Service`，支持多 Tracker 注册与路由。但 `main.go` 中完全没有引用它，导致精心设计的分层逻辑悬空。

**建议**：
- 在 `main.go` 中实例化 `core.NewService()`，注册具体 Tracker 实现，并在 handler 中调用。

#### 3.1.4 CORS 中间件配置过于宽松

```go
// services/api-gateway/internal/middleware/cors.go
w.Header().Set("Access-Control-Allow-Origin", "*")
```

生产环境必须收紧为具体域名白名单。

### 3.2 🟡 中等问题

#### 3.2.1 代码重复：每个服务的 main.go 结构几乎相同

所有服务的 `main.go` 都重复了以下模式：
- `os.Getenv("PORT")` + 默认值。
- `http.NewServeMux()`。
- `/health` handler。
- `log.Printf` + `http.ListenAndServe`。

**建议**：
- 在 `packages/go-sdk/common/` 中提供 `StartServer(port string, handler http.Handler)` 封装函数。
- 或提供一个通用的 `server` 包模板。

#### 3.2.2 缺乏结构化日志

所有服务使用标准库 `log`，仅有 `api-gateway` 记录了请求方法和耗时。缺少：
- Trace ID / Request ID。
- 结构化字段（如 JSON 格式日志）。
- 日志级别（DEBUG / INFO / WARN / ERROR）。

**建议**：
- 引入 `slog`（Go 1.21+ 标准库）或 `zap` / `zerolog`。

#### 3.2.3 缺少单元测试

所有 Go 模块的 `*_test.go` 文件数量为零。

**建议**：
- 从 `api-gateway` 的 middleware 和 handler 开始补测试。
- 为 `go-sdk/domain/` 的纯数据结构补测试（虽然简单，但可作为 CI 基线）。

### 3.3 🟢 亮点

- **Go SDK 领域模型设计清晰**：`domain/` 下各包（identity、project、workitem、agent、audit）职责明确，枚举常量定义规范。
- **基础设施抽象合理**：`infrastructure/` 定义了 `git.Repository`、`llm.Engine`、`workitemtracker.Tracker` 等接口，便于后续适配具体实现。
- **api-gateway 分层模式**：handler / middleware / server 三层分离，可作为其他服务的参考模板。

---

## 4. 共享包审查（`packages/*`）

### 4.1 `packages/ui`

**问题**：
- 仅有 `Button` 和 `Card` 两个组件，未与 `apps/web/src/components/ui/`（60+ shadcn/ui 组件）打通。
- `Button.tsx` 未使用 `cva` 管理变体，而是直接拼接 Tailwind 类名字符串，与 `apps/web` 中的 shadcn/ui 实现不一致。

**建议**：
- 明确 `packages/ui` 的定位：是共享基础组件库，还是 shadcn/ui 的二次封装？
- 如果定位为基础库，应将 `apps/web/src/components/ui/` 下沉到 `packages/ui`。
- 统一使用 `cva` + `cn()` 管理变体。

### 4.2 `packages/api-types`

**问题**：
- 类型数量不足，缺少 `AuditEventDTO`、`AgentDTO` 等。
- `apps/web/src/types/index.ts` 与 `packages/api-types/src/index.ts` 存在重复定义（如 `User`、`Requirement` 等）。

**建议**：
- 所有前后端共享类型统一收口到 `packages/api-types`。
- 前端业务类型（如 UI 状态类型）放在 `apps/web/src/types/`，避免混淆。

### 4.3 `packages/go-sdk`

**评价**：
- 领域模型和基础设施接口设计良好，是后端架构的坚实基础。
- 建议补充：通用错误类型（如 `AppError`）、分页请求/响应结构、时间格式化工具。

### 4.4 `packages/config`

**问题**：
- `tsconfig.base.json` 未被所有前端包引用验证。
- `eslint-preset.js` 存在但未启用（前端实际使用 Biome）。

**建议**：
- 清理未使用的 ESLint 预设，或统一工具链。
- 确保所有 TypeScript 包继承 `tsconfig.base.json`。

---

## 5. 工程实践审查

### 5.1 构建与 CI/CD

| 项 | 现状 | 评价 |
|----|------|------|
| `pnpm build` | Turbo 编排 | ✅ 正常 |
| `pnpm lint` | Turbo 编排 Biome + tsgo | ⚠️ Biome 规则过于宽松（仅 3 条规则） |
| `pnpm test` | Turbo 编排 | ❌ 无任何测试，会空跑通过 |
| `pnpm check-types` | `tsc --noEmit` | ⚠️ 存在 `@ts-ignore` 掩盖了真实类型问题 |
| CI/CD | 无 | ❌ 需补充 GitHub Actions 或类似方案 |

### 5.2 代码规范执行度

`AGENTS.md` 定义了 10 条硬性规则，但代码实际执行度较低：

| 规则 | 执行情况 | 说明 |
|------|----------|------|
| 规则1：自动编译启动 | — | 审查时未触发，需人工确认 |
| 规则4：嵌套限制 ≤3 层 | ❌ 未遵守 | JSX 嵌套普遍超过 5 层 |
| 规则5：复杂逻辑注释 | ⚠️ 部分遵守 | 部分业务逻辑缺少注释 |
| 规则6：重复逻辑封装 | ❌ 未遵守 | 颜色映射、标签映射多处重复 |
| 规则7：禁止魔法值 | ❌ 未遵守 | 大量硬编码字符串和数字 |
| 规则8：编译 warnings 清零 | ⚠️ 部分遵守 | Go 侧 `go vet` 可能通过，但 TS 侧存在 `@ts-ignore` |
| 规则9：DESIGN.md 维护 | — | 未涉及 UI 变更，无法评估 |

### 5.3 安全与部署

- **CORS**：`Access-Control-Allow-Origin: *` 需收紧。
- **认证**：后端服务无身份校验。
- **Secrets**：前端 `Settings.tsx` 中 API Key 以 `type="password"` 输入，但无实际加密存储逻辑。
- **Docker / K8s**：infra 目录提供了基础模板，但未验证是否可正常构建。

---

## 6. 优先级改进清单

### P0（立即处理）

1. **拆分超大组件**：将 `Chat.tsx`、`ProjectCode.tsx`、`Settings.tsx` 拆分为子组件和自定义 Hook。
2. **统一 Mock 数据与类型**：清理分散在各页面的 Mock 数据和重复类型定义，收口到 `src/mock/` 和 `src/types/`。
3. **提取常量**：将魔法值、魔法字符串提取到 `src/lib/constants.ts` 或同级 `constants.ts`。
4. **后端错误处理**：封装统一 JSON 响应，设置正确的 HTTP status code 和 Content-Type。
5. **连接 `workitem-service/core/service.go`**：让分层设计真正落地。

### P1（本周内）

6. **建立 Service/API 层**：创建 `src/services/api.ts` 和领域 API 模块，统一 mock 调用方式。
7. **路由懒加载**：`routes.tsx` 改用 `React.lazy` + `Suspense`。
8. **修复 `AuthContext.tsx` 类型问题**：补充类型声明，移除 `@ts-ignore`。
9. **CORS 收紧**：将 `*` 改为可配置的白名单。
10. **补充 Go 测试**：从 `api-gateway` 的 middleware 和 `go-sdk/domain` 开始。

### P2（本月内）

11. **状态管理优化**：`Chat.tsx` 等复杂页面引入 `useReducer` 或 Zustand。
12. **结构化日志**：后端统一使用 `slog` 或 `zap`。
13. **api-gateway 路由转发**：实现反向代理到各下游服务。
14. **补齐缺失 DTO**：`packages/api-types` 补充 `AuditEventDTO`、`AgentDTO` 等。
15. **CI/CD 流水线**：补充 GitHub Actions，执行 `pnpm build`、`go test ./...`、`docker build`。

### P3（后续规划）

16. **数据库接入**：选择 PostgreSQL 或 MySQL，建立 Repository 层。
17. **服务间通信**：选择 HTTP/gRPC 实现服务间调用。
18. **认证鉴权**：JWT + OAuth2.0 接入。
19. **前端性能优化**：虚拟滚动、图片懒加载、代码分割深化。
20. **UI 包下沉**：将 `apps/web/src/components/ui/` 下沉到 `packages/ui`。

---

## 7. 结论

DeepHarness Enterprise Platform 在架构层面（monorepo、DDD、组件化）具备良好的顶层设计，但**当前代码仍处于早期原型阶段**，存在大量与自身规范（`AGENTS.md`）不符的代码质量问题。最突出的三个风险是：

1. **前端超大文件与状态爆炸**：导致维护困难、Bug 隐藏深。
2. **后端空壳服务**：仅有健康检查，无真实业务逻辑和数据层。
3. **规范执行度低**：魔法值、深层嵌套、重复逻辑等问题普遍。

建议优先执行 **P0 和 P1 清单**，在保持架构清晰的前提下，快速补齐代码质量和工程实践短板，为后续功能迭代奠定坚实基础。
