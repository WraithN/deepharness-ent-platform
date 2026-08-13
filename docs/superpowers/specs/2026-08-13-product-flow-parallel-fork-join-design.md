# 产品需求设计流程：并行 Fork/Join 重构设计

> 日期：2026-08-13
> 范围：`apps/dh-backend/orchestrator` + `apps/dh-frontend` 产品流程（product flow）
> 目标：修复产品流程前后端映射差异，补齐缺失节点，将顺序执行引擎扩展为真并行 fork + join。

## 1. 背景与问题

### 1.1 现状

后端权威阶段定义 `domain/process/object/types.go` 中 `NewProductProcess`（L341-371）已包含 **11 个阶段**，`StageMetaMap`（L130-141）的执行主体与节点类型也已正确：

```
brainstorm -> breakdown -> research -> draft -> ai_draft_review -> review
-> ai_gateway -> prd_write -> proto_make -> proto_review -> final_review
```

但**实际执行的流程** `orchestrator/flows/product_flow.go` 只有 **9 个节点**，缺失：

- `product_breakdown`（需求拆解）
- `product_ai_draft_review`（AI 草案复核）
- `product_ai_gateway`（AI 网关并行分叉）

且为**顺序执行**：`prd_write` 完成后才 `proto_make`，`proto_make` 的 prompt 依赖 `PRDResult`。

### 1.2 前端设计意图

前端 `FlowGraph.tsx:546-635` 已绘制**完整正确**的产品拓扑：

- `ai_gateway` 作为并行分叉节点，`prd_write`（顶行）与 `proto_make`（底行）并行，均以「定稿方案(draft)」为输入。
- 两路汇入 `proto_review`（原型+PRD 联合复核）。
- 驳回边：`ai_draft_review -> draft`、`review -> draft`、`proto_review -> draft`。
- `FlowTemplateMarket.tsx:450-499` 描述 `ai_gateway` 为「条件分叉：仅需 PRD 则跳过原型；需要原型则同时产生原型+PRD」。

### 1.3 核心矛盾

| # | 矛盾 | 决策（用户确认） |
|---|------|------------------|
| 1 | PRD 与原型并行 vs 串行 | **真并行**，均以 `DraftResult` 为输入 |
| 2 | ai_gateway 无条件并行 vs 条件分叉 | **条件分叉**，可跳过原型 |
| 3 | 跳过原型后汇合点 | **仍走 proto_review**（仅评审 PRD） |
| 4 | final_review「三路驳回」语义 | **统一回 proto_review** |
| 5 | ai_draft_review 线性 vs 判定 | **AI 判定节点**（pass/reject），对齐 FlowGraph |
| 6 | 跳过阶段标记 | **新增 `skipped` 状态**（后端+前端） |

### 1.4 现有节点路由缺陷

- `ProductProtoReviewNode`：节点类型误标 `NodeTypeAI`（实际为人工复核），应改 `NodeTypeHuman`。
- `ProductProtoReviewNode.NextNode`：reject 目标为 `PRDWrite`，应为 `Draft`（退回草案）。
- `ProductFinalReviewNode.NextNode`：reject 目标为 `PRDWrite`，应为 `ProtoReview`。
- `ProductReviewNode.NextNode`：pass 目标为 `PRDWrite`，应为 `AIGateway`。
- `ProductProtoMakeNode`：prompt 输入为 `PRDResult`，应为 `DraftResult`。
- `StageProductFinalReview`：`StageMetaMap` 为 `Action`，应为 `Judge`（有 pass/reject 路由）。

## 2. 目标流程拓扑

`flows/product_flow.go` 节点序列（11 阶段，扁平节点表 + `NextNode` 跳转 + 一个 `ParallelNode`）：

| # | 节点 | 阶段 | 操作者 | 行为 |
|---|------|------|--------|------|
| 1 | ProductRequirementNode | product_brainstorm | human | 受理建流程+通知，不暂停 |
| 2 | ProductBrainstormNode | product_brainstorm | AI | 结构化需求要点 |
| 3 | **ProductBreakdownNode**（新） | product_breakdown | AI | 功能拆解清单 |
| 4 | ProductResearchNode | product_research | AI | 调研，输入改为 BreakdownResult |
| 5 | ProductDraftNode | product_draft | AI | 方案草案 DraftResult |
| 6 | **ProductAIDraftReviewNode**（新） | product_ai_draft_review | AI | 判定节点：pass->#7，reject->#5 |
| 7 | ProductReviewNode | product_review | human | 暂停；pass->#8，reject->#5 |
| 8 | **ProductAIGatewayNode**（新） | product_ai_gateway | AI | 决策 `NeedProto` |
| 9 | **ParallelNode**（新） | - | - | 分支A:PRDWrite(常驻)；分支B:ProtoMake(仅 NeedProto)；join |
| 10 | ProductProtoReviewNode | product_proto_review | human（改） | 暂停；pass->#11，reject->#5 |
| 11 | ProductFinalReviewNode | product_final_review | human | 暂停；pass->结束，reject->#10 |

**路由变更汇总**：

- `ProductReviewNode.NextNode`：pass `PRDWrite -> AIGateway`；reject 保持 `Draft`
- `ProductProtoReviewNode`：类型 `AI -> Human`；reject `PRDWrite -> Draft`
- `ProductFinalReviewNode.NextNode`：reject `PRDWrite -> ProtoReview`
- `ProductProtoMakeNode`：prompt 输入 `PRDResult -> DraftResult`；InputDesc `结构化 PRD 文档 -> 定稿方案`
- `ProductResearchNode`：prompt 输入 `BrainstormResult -> BreakdownResult`；InputDesc 改「功能拆解清单」

**brainstorm 阶段归属**：`ProductRequirementNode`（人工受理）与 `ProductBrainstormNode`（AI）继续共用 `product_brainstorm` 阶段（保持现状）。

**跳过原型时**：`ParallelNode` 跳过分支 B，将 `product_proto_make` 阶段标记为 `StageStatusSkipped`，仅跑 PRD 分支，然后正常进入 `proto_review`（仅评审 PRD）。

## 3. 引擎扩展（方案 A：复合 ParallelNode）

### 3.1 提取 ExecuteNode 为包级函数

`core/flow.go`：将 `f.executeNode(fc, node)` 方法体提取为包级函数：

```go
func ExecuteNode(fc *FlowContext, node Node) error {
    // 执行 Input -> Processor -> Output
}
```

`Flow.executeNode` 改为调用它；`ParallelNode` 分支也复用，保证执行语义一致。

### 3.2 新增 core/parallel_node.go

```go
// ParallelBranch 并行分支定义
type ParallelBranch struct {
    Name   string
    Nodes  []Node
    Skip   func(fc *FlowContext) bool        // 返回 true 则跳过该分支
    OnSkip func(fc *FlowContext) error       // 跳过时的处理（如标记阶段 Skipped）
    Merge  func(mainFC, branchFC *FlowContext) // join 后把分支结果写回主 fc
}

// ParallelNode 并行执行多个分支的复合节点，符合 Node 接口
type ParallelNode struct {
    BaseNode
    Branches []ParallelBranch
}
```

**Processor 执行逻辑**：

1. 遍历每个分支，若 `Skip(fc)` 为 true，调 `OnSkip` 后跳过。
2. 对每个非跳过分支：`branchFC := *fc`（值拷贝，隔离 `SessionID`/`ThreadID`），启动 goroutine 顺序执行 `branch.Nodes`（每个节点调 `ExecuteNode(&branchFC, node)`）。
3. 用 `sync.WaitGroup` + 错误通道收集结果：任一分支出错则返回错误（与现有单节点失败语义一致）。
4. 全部完成后，按顺序对各分支调 `Merge(mainFC, &branchFC)` 写回 `PRDResult`/`ProtoResult`。

**并发安全要点**：

- `CodeWriteNode.Processor` 写 `fc.SessionID`(L31)、`fc.ThreadID`(L78)，并行时通过 `branchFC := *fc` 值拷贝隔离，避免数据竞争。
- `FetchLastAssistantMessage(fc, ...)` 读 `fc.SessionID`，分支内读各自 branchFC，互不干扰。
- `UpdateStageFull` 经 `ProcessServiceImpl.UpdateStage` 做 read-modify-write，需加锁（见 3.3）。
- `MemoryProcessStore` 已有 `sync.RWMutex`（单操作安全），但 service 层 RMW 跨操作非原子。

**Resume 不受影响**：并行段位于 `review`（暂停）与 `proto_review`（暂停）之间，不跨越 pause 边界。`ParallelNode.NextNode` 默认 `""`，由主循环自然推进到 `ProtoReview`。

### 3.3 ProcessServiceImpl 加锁

`domain/process/service/service.go`：

- 结构体新增 `mu sync.Mutex`。
- `UpdateStage` 的 read-modify-write 整段加 `s.mu.Lock()`/`defer s.mu.Unlock()`。
- `Create` 同样加锁（保守起见，因 store 层 Create 后可能被并发 UpdateStage 读到）。

### 3.4 FlowContext 新增字段

`core/context.go`：

```go
BrainstormResult           string  // 已存在，保留
BreakdownResult            string  // 新增：功能拆解清单
DraftResult                string  // 已存在
AIDraftReviewResult        string  // 新增：AI 草案复核报告文本
ProductAIDraftReviewResult string  // 新增："pass" / "reject"
AIGatewayResult            string  // 新增：AI 网关决策文本
NeedProto                  bool    // 新增：是否需要原型
```

### 3.5 阶段状态新增 Skipped

`domain/process/object/types.go`：

```go
StageStatusSkipped = "skipped"  // 跳过（条件分支未执行）
```

## 4. 新增/修改节点与 Prompt

### 4.1 新增节点（均基于 CodeWriteNode）

| 节点 | 阶段 | prompt 输入 | AfterComplete |
|------|------|------------|---------------|
| ProductBreakdownNode | product_breakdown | BrainstormResult | `fc.BreakdownResult = FetchLastAssistantMessage`；完成阶段 |
| ProductAIDraftReviewNode | product_ai_draft_review | DraftResult | `fc.AIDraftReviewResult` = 报告；解析决策设 `fc.ProductAIDraftReviewResult`；完成阶段 |
| ProductAIGatewayNode | product_ai_gateway | DraftResult | `fc.AIGatewayResult` = 决策文本；解析设 `fc.NeedProto`；完成阶段 |

**ProductAIDraftReviewNode.NextNode**：`pass -> StageProductReview`，`reject -> StageProductDraft`。

**ProductAIGatewayNode**：prompt 要求 AI 输出明确标记（如 `NEED_PROTO: true/false`），`AfterComplete` 解析设置 `fc.NeedProto`。`NextNode` 默认 `""`（推进到 ParallelNode）。

### 4.2 ParallelNode 实例（在 flows/product_flow.go 构造）

- 分支 A（常驻）：`ProductPRDWriteNode`；`Merge`: `mainFC.PRDResult = branchFC.PRDResult`
- 分支 B（条件）：`ProductProtoMakeNode`；`Skip: func(fc) bool { return !fc.NeedProto }`；`OnSkip`: 标记 `product_proto_make` 为 `Skipped`；`Merge`: `mainFC.ProtoResult = branchFC.ProtoResult`

### 4.3 修改节点

| 节点 | 改动 |
|------|------|
| ProductResearchNode | prompt 输入 `BrainstormResult -> BreakdownResult`；InputDesc「功能拆解清单」 |
| ProductProtoMakeNode | prompt 输入 `PRDResult -> DraftResult`；InputDesc「定稿方案」 |
| ProductProtoReviewNode | `NodeTypeAI -> NodeTypeHuman`；reject `PRDWrite -> Draft`；InputDesc「UI 交互原型（可选）+ 结构化 PRD + 定稿方案」；通知文案 reject 改「返回方案草案」 |
| ProductFinalReviewNode | reject `PRDWrite -> ProtoReview`；OutputDesc 改「返回原型+PRD联合复核」 |
| ProductReviewNode | pass `PRDWrite -> AIGateway`；通知 data 增加 `aiDraftReviewResult` |

### 4.4 Prompt 模板（prompts/product.yaml + product.go）

**新增 key**：

- `product_breakdown`：输入 `{{.BrainstormResult}}`，输出功能拆解清单与模块关系图。
- `product_ai_draft_review`：输入 `{{.DraftResult}}`，AI 从完整性/一致性/可行性维度复核，输出报告 + `DRAFT_REVIEW: pass/reject` 决策标记。
- `product_ai_gateway`：输入 `{{.DraftResult}}`，AI 根据需求复杂度判断是否需要原型，输出 `NEED_PROTO: true/false`。

**修改 key**：

- `product_research`：`{{.BrainstormResult}} -> {{.BreakdownResult}}`
- `product_proto_make`：`{{.PRDResult}} -> {{.DraftResult}}`

**对应 builder 签名**：

- `BuildProductBreakdownPrompt(title, brainstormResult, workspacePath)`
- `BuildProductAIDraftReviewPrompt(title, draftResult, workspacePath)`
- `BuildProductAIGatewayPrompt(title, draftResult, workspacePath)`
- `BuildProductResearchPrompt(title, breakdownResult, workspacePath)`（参数变更）
- `BuildProductProtoMakePrompt(title, draftResult, workspacePath)`（参数变更）

### 4.5 后端 StageMetaMap 修正

`domain/process/object/types.go` L140：

```go
StageProductFinalReview: {OperatorTypeHuman, StageTypeJudge},  // 原 StageTypeAction
```

## 5. 前端对齐改动

### 5.1 process-api.ts

`STAGE_STATUS` 新增 `SKIPPED: 'skipped'`。

### 5.2 FlowGraph.tsx

- `STATUS_STROKE`/`STATUS_FILL`/`STATUS_LABELS` 新增 `skipped` 条目（stroke `#94a3b8`、fill `#f1f5f9`、label「已跳过」）。
- `edgeStyle`：`skipped` 视同 pending 处理。
- 产品流程边新增 **`final_review -> proto_review` 驳回边**（"N 不通过"，顶部折线 `ORTH_TOP_Y`），与后端 reject 路由一致。

### 5.3 ProcessDetail.tsx

7 处状态映射新增 `skipped` 条目：

- L80 `STAGE_STATUS_LABELS`：`已跳过`
- L109 Badge variant：`outline`
- L118 icon：`MinusCircle`
- L125 text color：`text-slate-400`
- L132 border：`border-slate-200 dark:border-slate-800`
- L139 bg：`bg-slate-50 dark:bg-slate-950/40`
- L364 过滤逻辑保持（skipped 阶段不在「进行中」列表显示，阶段卡片正常渲染徽章）

## 6. 实施步骤

1. **后端基础设施**
   - `core/flow.go`：提取 `ExecuteNode` 包级函数。
   - `core/parallel_node.go`：新增 `ParallelNode`/`ParallelBranch`。
   - `core/context.go`：新增 FlowContext 字段。
   - `domain/process/object/types.go`：新增 `StageStatusSkipped`；修正 `StageProductFinalReview` 为 Judge。
   - `domain/process/service/service.go`：`ProcessServiceImpl` 加 `sync.Mutex`，锁 `UpdateStage`/`Create`。

2. **后端 Prompt**
   - `prompts/product.yaml`：新增 3 个 key，修改 2 个 key。
   - `prompts/product.go`：新增 3 个 builder，修改 2 个 builder 签名。

3. **后端节点**
   - `nodes/product_flow_nodes.go`：新增 3 个 AI 节点；修改 5 个现有节点（路由/类型/prompt 输入/InputDesc）。
   - `flows/product_flow.go`：重写节点序列，插入新节点与 ParallelNode 实例。

4. **前端**
   - `process-api.ts`：新增 `SKIPPED`。
   - `FlowGraph.tsx`：状态颜色 + final_review 驳回边。
   - `ProcessDetail.tsx`：7 处状态映射。

5. **验证**（见 §7）

6. **缺陷文档**（规则3）：`docs/bugs/2026-08-13-product-flow-parallel-fork-join.md`

## 7. 验证计划

- **后端编译**：`pnpm --filter @repo/dh-backend build` + `go vet ./...`（apps/dh-backend）0 warnings（规则8）。
- **类型检查**：`npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 0 errors（规则8）。
- **Lint**：`pnpm lint`。
- **运行验证**（规则1）：`pnpm build` + `bash scripts/restart-dev.sh`，curl 确认前后端功能正常。
- **并发安全审查**：`ParallelNode` 的 FlowContext 值拷贝隔离 + `ProcessServiceImpl` 锁覆盖所有 read-modify-write。
- **路由正确性**：逐一核对 `NextNode` 返回值与目标拓扑一致。

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| FlowContext 值拷贝遗漏字段导致分支丢失上下文 | `branchFC := *fc` 是值拷贝，所有只读字段天然共享；仅 SessionID/ThreadID 需隔离，Merge 显式写回 PRDResult/ProtoResult |
| AI 决策解析失败（NeedProto / DraftReview） | prompt 强制输出明确标记；解析失败时保守默认（NeedProto 默认 true 走完整流程；DraftReview 默认 pass 交人工兜底） |
| 并行分支一个失败一个成功 | 任一失败即返回错误，与现有单节点失败语义一致；失败阶段标记 Failed 并通知 |
| 现有顺序流程的其他 flow（ai_dev/test）受影响 | `ExecuteNode` 提取为纯重构，不改变行为；`ParallelNode` 仅产品流程使用 |
