# 架构设计工作台重构：开发库代码视图与多层下钻

> 日期：2026-08-13
> 状态：设计已确认，待制定实施计划
> 关联缺陷：`docs/bugs/2026-08-13-arch-repo-sync-no-dashboard.md`（路径索引修复）

## 1. 背景与目标

现有架构设计工作台（`ArchDesignWorkspace`）基于 `arch-repo-analysis` 技能产出服务级
架构（domains/services/relations），提供工程全景/服务依赖/业务领域三视图 + 业务线/
依赖类型筛选。该方案粒度粗（仅服务级）、与代码结构脱节、无法下钻。

本次重构将工作台改造为**开发库代码视图**：以 `understand` 技能（产出
`.understand-anything/knowledge-graph.json`）为数据源，展示开发库间依赖，支持下钻到
模块、类，并提供开发库介绍页。

**核心目标**：
1. 去掉业务线筛选、视图模式、依赖过滤
2. 一键全量解析所有开发库（加锁防重复）
3. 画布展示开发库及其依赖关系
4. 点击开发库下钻模块（模块有作用介绍）-> 再下钻类
5. 开发库介绍页（定位、架构简介等）

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| 开发库间依赖来源 | agent 综合推断（解析后综合各库入口/对外调用推断） |
| 模块层产生方式 | agent 识别（在 understand 产出基础上识别模块边界 + summary） |
| 解析范围与触发 | 一键全量解析（对所有 type=dev 库），加锁防重复 |
| 介绍页内容来源 | agent 生成（定位/架构简介/技术栈/核心模块） |
| 架构库角色 | 转为聚合存储（从 domains/services 改为跨库依赖图+模块/介绍索引） |
| 解析编排方案 | 单一自定义技能 `dev-lib-analysis` 编排全部 |

## 3. 整体架构与数据流

```
用户点"解析"(加锁)
  -> dh-backend 创建 agent 会话，预填 dev-lib-analysis 技能指令
  -> gatewayd agent 执行 dev-lib-analysis：
      ① 遍历 dev-jobs/ 下所有 type=dev 开发库
      ② 每个库跑 understand --language zh
         -> 产出 <lib>/.understand-anything/knowledge-graph.json
      ③ 基于知识图谱识别模块（module 节点 + summary 作用介绍）
      ④ 生成开发库介绍（定位/架构简介/技术栈/核心模块）
      ⑤ 综合各库入口与对外调用，推断库间依赖
      ⑥ 聚合结果写入架构库（type=arch）
  -> 前端 SSE/轮询获知完成 -> 画布展示 L1 开发库依赖图
  -> 点击开发库 -> 下钻 L2 模块 / 打开介绍页
  -> 点击模块 -> 下钻 L3 类
```

**层级数据来源**：

| 层级 | 数据来源 | 写入方 |
|------|----------|--------|
| L1 开发库 + 库间依赖 | 架构库 `libraries.yaml` | dev-lib-analysis agent |
| L2 模块 | 架构库 `modules/<lib>.yaml` | dev-lib-analysis agent |
| L3 类/函数 | 各开发库 `.understand-anything/knowledge-graph.json` | understand 技能 |
| 介绍页 | 架构库 `overviews/<lib>.yaml` | dev-lib-analysis agent |

understand 原始产出留在各开发库自身 `.understand-anything/` 目录；聚合数据（L1/L2/介绍）
写入架构库。dh-backend 经 stubclient 读取这些文件，按层级返回前端。

## 4. 数据模型

### 4.1 架构库（type=arch）新结构

替代旧 `domains/services/relations/observed` 结构：

```
arch-repo/
├── libraries.yaml          # L1: 开发库节点 + 库间依赖边
├── modules/
│   └── <lib>.yaml          # L2: 每个开发库的模块节点 + 模块间依赖
├── overviews/
│   └── <lib>.yaml          # 介绍页: 定位/架构简介/技术栈/核心模块
└── README.md
```

### 4.2 libraries.yaml（L1 开发库层）

```yaml
# 开发库列表与库间依赖（agent 综合推断产出）
libraries:
  - key: dh-backend
    name: DeepHarness Backend
    path: dev-jobs/dh-backend
    languages: [go]
    summary: 平台后端统一入口，管理控制台、会话、Agent 生命周期
  - key: go-sdk
    name: Go SDK
    path: dev-jobs/go-sdk
    languages: [go]
    summary: 共享领域模型与基础设施抽象
dependencies:
  - from: dh-backend
    to: go-sdk
    kind: imports          # imports | calls | depends_on
    description: 引用 go-sdk 的 domain/infrastructure 包
warnings:                  # 解析时单库失败等告警
  - "库 xxx understand 失败：<reason>"
parsedAt: "2026-08-13T..."
```

### 4.3 modules/<lib>.yaml（L2 模块层）

```yaml
# 某开发库的模块划分与模块间依赖（agent 识别产出）
modules:
  - key: gateway
    name: 网关层
    path: gateway/         # 相对开发库根的路径前缀
    summary: 处理 HTTP 路由、中间件装配、请求分发
    fileCount: 12
  - key: domain-repository
    name: 仓库领域
    path: domain/repository/
    summary: 仓库配置、同步、分支等领域服务
    fileCount: 18
dependencies:
  - from: gateway
    to: domain-repository
    kind: calls            # calls | imports | depends_on
```

### 4.4 overviews/<lib>.yaml（开发库介绍页）

```yaml
key: dh-backend
name: DeepHarness Backend
positioning: DeepHarness 平台后端统一入口，负责管理控制台接口、WebSocket 会话、Agent 生命周期管理与各业务模块。
architecture: 采用 DDD 分层（gateway -> domain -> infrastructure），标准库 net/http + ServeMux，领域模型定义在 go-sdk。
techStack: [go, postgresql, redis]
coreModules:
  - key: gateway
    role: HTTP 路由与中间件
  - key: domain/repository
    role: 仓库领域服务
  - key: agent/orchestrator
    role: Agent 会话编排
```

### 4.5 L3 类层（直接复用 understand 产出）

读取开发库 `.understand-anything/knowledge-graph.json`：
- **nodes**：`type=file/function/class`，含 `id/name/summary/tags/complexity/filePath/lineRange`
- **edges**：`calls/imports/contains/inherits/depends_on/implements` 等 29 种
- 按 module 的 `path` 前缀过滤 nodes（module 对应一组 filePath 前缀），再保留这些 nodes 间的 edges

> 注：understand 的 `module` 节点类型虽被保留但无 agent 产出，故 L2 模块由 dev-lib-analysis
> agent 自行识别并写入架构库 `modules/<lib>.yaml`，不依赖 understand 的 module 节点。

## 5. 解析流程与加锁

### 5.1 触发

- 前端点"解析开发库" -> `POST /v1/workspaces/{id}/arch/parse`
- 后端检测 per-workspace 解析锁，锁存在则返回 `409 Conflict`
- 加锁后创建 agent 会话，自动发送 `dev-lib-analysis` 技能指令（不跳聊天页）
- 返回 `202 Accepted` + 会话标识，前端进入 `parsing` 状态轮询 `GET /arch/parse/status`

### 5.2 dev-lib-analysis 技能

新建 `shares/skills/dev-lib-analysis/SKILL.md`，由 dh-backend 部署到共享目录供 agent 读取。
技能编排：

1. 读取架构库路径与 `dev-jobs/` 下开发库清单（排除架构库自身）
2. 对每个开发库执行 `understand --language zh`，产出 `<lib>/.understand-anything/knowledge-graph.json`
3. 读取各库知识图谱，按代码结构与语义识别模块，产出 `modules/<lib>.yaml`（含 module summary）
4. 为每个库生成介绍 `overviews/<lib>.yaml`
5. 综合各库入口（main/路由注册）与对外调用（imports/depends_on 跨库引用），推断库间依赖，产出 `libraries.yaml`
6. 单库 understand 失败：记入 `libraries.yaml` 的 `warnings`，继续其他库，不阻塞全局
7. 完成后写入完成标志（如 `libraries.yaml` 的 `parsedAt`），清理锁

### 5.3 加锁

- 锁文件：`dev-jobs/<arch-repo>/.parse.lock`（经 stubclient 写入 personal-stub）
- 锁内容：启动时间 + agent 会话 ID
- per-workspace 粒度（一个空间同时仅允许一个解析任务）
- `POST /arch/parse` 检测锁存在返回 409
- agent 完成/失败后清理锁；异常残留锁由 `GET /arch/parse/status` 检测会话状态后允许清理

### 5.4 进度反馈

- 前端轮询 `GET /arch/parse/status`（间隔 2s）：返回锁状态、完成标志、warnings
- 解析完成 -> 前端 `setPageState('loading')` 重新加载 L1 画布

## 6. 前端交互

### 6.1 页面状态机

```
loading -> not-configured（未配置架构库）
        -> not-synced（架构库未同步到本地）
        -> not-parsed（已同步但未解析，显示"解析开发库"按钮）
        -> parsing（解析中，轮询状态）
        -> ready（展示 L1 画布）
```

新增 `not-parsed` 与 `parsing` 状态。判定 `not-parsed`：架构库已 cloned 但
`libraries.yaml` 不存在或无 `parsedAt`。

### 6.2 删除项

- 业务线筛选（`businessLine` Select + `ALL_BUSINESS_LINE`）
- 视图模式（`viewMode` RadioGroup + `VIEW_MODE_OPTIONS`）
- 依赖过滤（`edgeKindFilter` Checkbox + `EDGE_KINDS`）
- 对应的 `graphData.views/domains`、`filteredView` 业务线/依赖过滤逻辑
- 「重新全局解析」按钮（改为「解析开发库」）

### 6.3 画布层级与面包屑

新增层级状态 `drillLevel: 'libraries' | 'modules' | 'classes'` 与当前选中
`selectedLib`/`selectedModule`。

- **L1 开发库图**：节点=开发库（`libraries.yaml` 的 libraries），边=库间依赖。
  节点挂「介绍」「下钻」两个动作按钮。
- **L2 模块图**：节点=模块（`modules/<lib>.yaml` 的 modules，label=模块名），
  边=模块间依赖。hover/侧栏显示 summary 作用介绍。点击模块节点下钻 L3。
- **L3 类图**：节点=class/function（按 module path 过滤 knowledge-graph.json），
  边=calls/imports/contains/inherits。点击节点 -> 右侧详情面板（summary/tags/lineRange/关联边）。
- **面包屑**：`架构总览 > <开发库> > <模块>`，点击任一级回退。

### 6.4 开发库介绍页

点击开发库节点的「介绍」动作 -> 右侧抽屉展示 `overviews/<lib>.yaml`
（定位/架构简介/技术栈/核心模块列表）。

### 6.5 保留项

缩放（ZoomIn/ZoomOut）、重置画布、导出（L1 导出 libraries.yaml 内容）。

## 7. 后端 API

### 7.1 改造 GET /arch/graph

改为层级查询（路径不变，增加 query 参数）：

| 参数 | 返回 | 数据源 |
|------|------|--------|
| `?level=libraries` | L1 开发库+依赖 | 架构库 `libraries.yaml` |
| `?level=modules&lib=<key>` | L2 模块+依赖 | 架构库 `modules/<lib>.yaml` |
| `?level=classes&lib=<key>&module=<key>` | L3 类/函数+边 | 开发库 `knowledge-graph.json`（按 module path 过滤） |

响应结构统一为 `{ nodes, edges, drillLevel, lib?, module?, warnings? }`。
`isArchRepoCloned` 逻辑保留（架构库需先同步才允许查询）。

### 7.2 新增接口

- `GET /arch/overview?lib=<key>` -> 开发库介绍（读 `overviews/<lib>.yaml`）
- `POST /arch/parse` -> 触发解析（加锁 + 创建 agent 会话，返回 202 + 会话 ID；锁存在返回 409）
- `GET /arch/parse/status` -> 解析状态（锁状态 + parsedAt 完成标志 + warnings）

### 7.3 保留接口

- `listUserRepos` / `syncUserRepo`（同步架构库到本地）
- `isArchRepoCloned`（架构库 cloned 判定）

### 7.4 废弃

- 旧 `arch/graph` 的 `views/domains/warnings` 三视图结构
- `arch-repo-analysis` 技能的 domains/services 产出（前端不再触发；技能文件保留备查）

## 8. 影响文件清单

### 后端（apps/dh-backend）
- `domain/repository/arch_handler.go` - `ArchGraph` 改为层级查询；新增 overview/parse/parse-status handler
- `domain/repository/arch_service.go` - 新增 L1/L2/L3 数据读取与聚合（替换旧 buildArchGraph 三视图）
- `domain/repository/service/parse_lock.go`（新建）- 解析锁机制
- `gateway/server/server.go` - 注册新路由（arch/overview, arch/parse, arch/parse/status）

### 共享目录（shares/skills）
- `dev-lib-analysis/SKILL.md`（新建）- 编排 understand + 模块识别 + 介绍 + 库间依赖

### 前端（apps/dh-frontend）
- `src/components/workspace/ArchDesignWorkspace.tsx` - 重构：删筛选/视图，加多层下钻+面包屑+介绍页
- `src/lib/arch-api.ts` - API 类型与请求改为层级参数

## 9. 风险与约束

1. **解析耗时**：understand per-repo，N 个开发库全量解析较慢。通过 SSE/轮询反馈进度，
   per-workspace 锁防重复。首版不做增量，后续可加 git diff 增量。
2. **模块识别质量**：依赖 agent 能力。技能 prompt 需明确模块划分原则（按目录/包/职责）。
3. **L3 数据量**：大库 knowledge-graph.json 可能很大。按 module path 过滤后仍可能节点过多，
   画布需考虑节点数量上限或折叠。
4. **架构合规**（规则12）：dev-lib-analysis 技能文件放 `shares/skills/`（共享目录），
   由 dh-backend 部署；agent 在 gatewayd 执行，产出写入共享目录；dh-backend 经 stubclient 读取。
5. **understand 可用性**：依赖 gatewayd 容器内 understand 技能已安装。需确认
   `.understand-anything/` 插件在 agent 容器可用。
