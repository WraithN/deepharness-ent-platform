# 产品流程并行 Fork/Join 重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将产品需求设计流程从 9 节点顺序流重构为 11 节点 + 真 并行 fork/join 流，补齐缺失节点，修正路由与节点类型，前后端映射对齐。

**Architecture:** 方案 A——新增复合 `ParallelNode`（符合 `Node` 接口），分支用 `FlowContext` 值拷贝隔离会话状态，join 后合并结果；引擎主循环不变，仅提取 `ExecuteNode` 为包级函数复用；`ProcessServiceImpl` 加 `sync.Mutex` 保护 read-modify-write；前端新增 `skipped` 状态渲染与 `final_review` 驳回边。

**Tech Stack:** Go 1.22（后端 orchestrator + domain）、React 18 + TypeScript（前端）、Go testing（后端测试）、Biome + tsc（前端检查）。

## Global Constraints

- Go 模块路径前缀 `github.com/deepharness/deepharness-ent-platform/...`。
- Go 常量 UPPER_SNAKE_CASE；前端常量 UPPER_SNAKE_CASE。
- 代码最多 3 层嵌套（规则4）；复杂逻辑加中文注释（规则5）；魔法值提取常量（规则7）。
- 后端 `go vet ./...` 0 warnings（规则8）；前端 `tsc --noEmit` 0 errors。
- 完成后 `pnpm build` + `bash scripts/restart-dev.sh` 验证（规则1）。
- 缺陷文档记录到 `docs/bugs/`（规则3）。
- 参考设计文档：`docs/superpowers/specs/2026-08-13-product-flow-parallel-fork-join-design.md`。

---

### Task 1: 后端常量与阶段元数据修正

**Files:**
- Modify: `apps/dh-backend/domain/process/object/types.go:85`（新增状态常量）
- Modify: `apps/dh-backend/domain/process/object/types.go:140`（FinalReview 改 Judge）
- Test: `go build ./...` + `go vet ./...`

**Interfaces:**
- Produces: `StageStatusSkipped = "skipped"`（供 Task 5 OnSkip、Task 9 前端使用）；`StageProductFinalReview` 元数据改为 Judge。

- [ ] **Step 1: 新增 StageStatusSkipped 常量**

修改 `apps/dh-backend/domain/process/object/types.go` 阶段状态常量块（L80-86），在 `StageStatusTerminated` 后新增：

```go
// 阶段状态常量
const (
	StageStatusPending    = "pending"
	StageStatusInProgress = "in_progress"
	StageStatusCompleted  = "completed"
	StageStatusFailed     = "failed"
	StageStatusTerminated = "terminated"
	StageStatusSkipped    = "skipped" // 跳过（条件分支未执行）
)
```

- [ ] **Step 2: 修正 StageProductFinalReview 为 Judge**

同文件 L140，将 `StageTypeAction` 改为 `StageTypeJudge`：

```go
	StageProductFinalReview:   {OperatorTypeHuman, StageTypeJudge},
```

- [ ] **Step 3: 编译与 vet 验证**

Run: `cd apps/dh-backend && go build ./... && go vet ./...`
Expected: 成功，0 warnings。

- [ ] **Step 4: 提交**

```bash
git add apps/dh-backend/domain/process/object/types.go
git commit -m "feat(process): add StageStatusSkipped + fix FinalReview stage type to Judge"
```

---

### Task 2: FlowContext 新增产品流程字段

**Files:**
- Modify: `apps/dh-backend/orchestrator/core/context.go:77-85`（产品流程数据块）
- Test: `go build ./...`

**Interfaces:**
- Produces: `FlowContext.BreakdownResult`、`AIDraftReviewResult`、`ProductAIDraftReviewResult`、`AIGatewayResult`、`NeedProto`（供 Task 7/8 节点读写）。

- [ ] **Step 1: 新增字段**

修改 `apps/dh-backend/orchestrator/core/context.go` 产品流程数据块（L77-85），新增 5 个字段：

```go
	// 产品流程数据
	BrainstormResult           string
	BreakdownResult            string // 功能拆解清单
	ResearchResult             string
	DraftResult                string
	AIDraftReviewResult        string // AI 草案复核报告文本
	ProductAIDraftReviewResult string // "pass" / "reject"
	PRDResult                  string
	ProtoResult                string
	ProductReviewResult        string // "pass" / "reject"
	ProductProtoReviewResult   string // "pass" / "reject"
	ProductFinalReviewResult   string // "pass" / "reject"
	AIGatewayResult            string // AI 网关决策文本
	NeedProto                  bool   // 是否需要原型
```

- [ ] **Step 2: 编译验证**

Run: `cd apps/dh-backend && go build ./...`
Expected: 成功。

- [ ] **Step 3: 提交**

```bash
git add apps/dh-backend/orchestrator/core/context.go
git commit -m "feat(orchestrator): add product flow context fields for breakdown/review/gateway"
```

---

### Task 3: ProcessServiceImpl 加锁保护并发 read-modify-write

**Files:**
- Modify: `apps/dh-backend/domain/process/service/service.go:36-38`（结构体加锁字段）
- Modify: `apps/dh-backend/domain/process/service/service.go:45`（Create 加锁）
- Modify: `apps/dh-backend/domain/process/service/service.go:133`（UpdateStage 加锁）
- Test: `go build ./...` + `go vet ./...`

**Interfaces:**
- Produces: `ProcessServiceImpl` 线程安全，供 Task 5 并行分支并发 UpdateStage。

- [ ] **Step 1: 结构体新增 mutex**

修改 `apps/dh-backend/domain/process/service/service.go` L36-38，新增 `sync.Mutex` 字段与 import：

```go
import (
	"context"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/store"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// ProcessServiceImpl 流程服务实现
type ProcessServiceImpl struct {
	store store.ProcessStore
	mu    sync.Mutex // 保护 Create/UpdateStage 的 read-modify-write，防止并行分支并发更新丢失
}
```

- [ ] **Step 2: Create 加锁**

修改 `Create` 方法（L45），在方法体开头加锁：

```go
func (s *ProcessServiceImpl) Create(_ context.Context, req object.CreateProcessRequest) (object.Process, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	// ... 原有逻辑不变
```

- [ ] **Step 3: UpdateStage 加锁**

修改 `UpdateStage` 方法（L133），在方法体开头加锁：

```go
func (s *ProcessServiceImpl) UpdateStage(_ context.Context, processID string, stageName string, req object.UpdateStageRequest) (object.Process, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.store.GetByID(context.Background(), processID)
	// ... 原有逻辑不变
```

- [ ] **Step 4: 编译与 vet 验证**

Run: `cd apps/dh-backend && go build ./... && go vet ./...`
Expected: 成功，0 warnings。

- [ ] **Step 5: 提交**

```bash
git add apps/dh-backend/domain/process/service/service.go
git commit -m "fix(process): add mutex to ProcessServiceImpl for concurrent stage updates"
```

---

### Task 4: 提取 ExecuteNode 为包级函数

**Files:**
- Modify: `apps/dh-backend/orchestrator/core/flow.go:94-106`（提取方法为包级函数）
- Modify: `apps/dh-backend/orchestrator/core/flow.go:26,73`（调用点更新）
- Test: `go build ./...` + `go vet ./...` + 既有测试

**Interfaces:**
- Produces: `core.ExecuteNode(fc *FlowContext, node Node) error`（供 Task 5 ParallelNode 分支复用）。
- Consumes: `Node` 接口（已存在）。

- [ ] **Step 1: 提取包级函数 ExecuteNode**

修改 `apps/dh-backend/orchestrator/core/flow.go`，将 `executeNode` 方法（L94-106）替换为包级函数：

```go
// ExecuteNode 执行单个节点的 Input -> Processor -> Output 三段式。
// 提取为包级函数，供 Flow 主循环与 ParallelNode 分支复用，保证执行语义一致。
func ExecuteNode(fc *FlowContext, node Node) error {
	log.Printf("[Flow] executing node %s (%s)", node.Name(), node.Type())
	if err := node.Input(fc); err != nil {
		return fmt.Errorf("node %s input: %w", node.Name(), err)
	}
	if err := node.Processor(fc); err != nil {
		return err
	}
	if err := node.Output(fc); err != nil {
		return fmt.Errorf("node %s output: %w", node.Name(), err)
	}
	return nil
}
```

- [ ] **Step 2: 更新调用点**

同文件 `Run`（L26）与 `Resume`（L73）中的 `f.executeNode(fc, node)` 改为 `ExecuteNode(fc, node)`：

```go
		if err := ExecuteNode(fc, node); err != nil {
```

（两处均改）

- [ ] **Step 3: 编译与 vet 验证**

Run: `cd apps/dh-backend && go build ./... && go vet ./...`
Expected: 成功，0 warnings。

- [ ] **Step 4: 运行既有测试确保行为不变**

Run: `cd apps/dh-backend && go test ./orchestrator/... ./agent/chat/tests/... ./config/tests/...`
Expected: 全部 PASS（行为未变）。

- [ ] **Step 5: 提交**

```bash
git add apps/dh-backend/orchestrator/core/flow.go
git commit -m "refactor(orchestrator): extract ExecuteNode as package-level function"
```

---

### Task 5: 新增 ParallelNode 并发原语 + 测试

**Files:**
- Create: `apps/dh-backend/orchestrator/core/parallel_node.go`
- Create: `apps/dh-backend/orchestrator/core/parallel_node_test.go`
- Test: `go test ./orchestrator/core/...`

**Interfaces:**
- Consumes: `core.ExecuteNode`（Task 4）、`core.BaseNode`/`core.Node`/`core.FlowContext`（已存在）。
- Produces: `ParallelBranch`、`ParallelNode`（供 Task 9 产品流程构造使用）。

- [ ] **Step 1: 编写失败测试**

创建 `apps/dh-backend/orchestrator/core/parallel_node_test.go`：

```go
package core

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

// fakeNode 测试用节点，记录执行顺序与并发数
type fakeNode struct {
	name      string
	procDelay int // goroutine 内自增计数
	outputVal string
	executed  *atomic.Int32
}

func (n *fakeNode) Name() string                 { return n.name }
func (n *fakeNode) Type() NodeType               { return NodeTypeAI }
func (n *fakeNode) Input(fc *FlowContext) error  { return nil }
func (n *fakeNode) Processor(fc *FlowContext) error {
	n.executed.Add(1)
	return nil
}
func (n *fakeNode) Output(fc *FlowContext) error {
	// 把 outputVal 写到 fc 对应字段（用 ProcessID 复用做演示）
	if n.outputVal != "" {
		fc.CodeResult = n.outputVal
	}
	return nil
}
func (n *fakeNode) NextNode(fc *FlowContext) string { return "" }

func newFakeNode(name, outputVal string, executed *atomic.Int32) *fakeNode {
	return &fakeNode{name: name, outputVal: outputVal, executed: executed}
}

func TestParallelNodeRunsAllBranches(t *testing.T) {
	var executed atomic.Int32
	pn := &ParallelNode{
		BaseNode: NewBaseNode("parallel_test", NodeTypeAI, &FlowDeps{}),
		Branches: []ParallelBranch{
			{
				Name:  "A",
				Nodes: []Node{newFakeNode("a1", "resultA", &executed)},
				Merge: func(mainFC, branchFC *FlowContext) { mainFC.PRDResult = branchFC.CodeResult },
			},
			{
				Name:  "B",
				Nodes: []Node{newFakeNode("b1", "resultB", &executed)},
				Merge: func(mainFC, branchFC *FlowContext) { mainFC.ProtoResult = branchFC.CodeResult },
			},
		},
	}
	fc := &FlowContext{Ctx: context.Background()}
	if err := pn.Processor(fc); err != nil {
		t.Fatalf("Processor failed: %v", err)
	}
	if executed.Load() != 2 {
		t.Errorf("expected 2 nodes executed, got %d", executed.Load())
	}
	if fc.PRDResult != "resultA" {
		t.Errorf("PRDResult = %q, want resultA", fc.PRDResult)
	}
	if fc.ProtoResult != "resultB" {
		t.Errorf("ProtoResult = %q, want resultB", fc.ProtoResult)
	}
}

func TestParallelNodeSkipsBranch(t *testing.T) {
	var executed atomic.Int32
	pn := &ParallelNode{
		BaseNode: NewBaseNode("parallel_skip", NodeTypeAI, &FlowDeps{}),
		Branches: []ParallelBranch{
			{
				Name:  "A",
				Nodes: []Node{newFakeNode("a1", "resultA", &executed)},
				Merge: func(mainFC, branchFC *FlowContext) { mainFC.PRDResult = branchFC.CodeResult },
			},
			{
				Name:    "B",
				Nodes:   []Node{newFakeNode("b1", "resultB", &executed)},
				Skip:    func(fc *FlowContext) bool { return true },
				OnSkip:  func(fc *FlowContext) error { fc.ProtoResult = "SKIPPED"; return nil },
				Merge:   func(mainFC, branchFC *FlowContext) { mainFC.ProtoResult = branchFC.CodeResult },
			},
		},
	}
	fc := &FlowContext{Ctx: context.Background()}
	if err := pn.Processor(fc); err != nil {
		t.Fatalf("Processor failed: %v", err)
	}
	if executed.Load() != 1 {
		t.Errorf("expected 1 node executed (B skipped), got %d", executed.Load())
	}
	if fc.PRDResult != "resultA" {
		t.Errorf("PRDResult = %q, want resultA", fc.PRDResult)
	}
	if fc.ProtoResult != "SKIPPED" {
		t.Errorf("ProtoResult = %q, want SKIPPED", fc.ProtoResult)
	}
}

func TestParallelNodeBranchError(t *testing.T) {
	var executed atomic.Int32
	errNode := &fakeNode{name: "err", executed: &executed}
	errNode.Processor = func(fc *FlowContext) error { executed.Add(1); return errors.New("boom") }
	pn := &ParallelNode{
		BaseNode: NewBaseNode("parallel_err", NodeTypeAI, &FlowDeps{}),
		Branches: []ParallelBranch{
			{Name: "A", Nodes: []Node{errNode}},
			{Name: "B", Nodes: []Node{newFakeNode("b1", "resultB", &executed)}},
		},
	}
	fc := &FlowContext{Ctx: context.Background()}
	err := pn.Processor(fc)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

// 确保两个分支真正并行执行（用共享计数器 + 屏障验证并发）
func TestParallelNodeTrueParallel(t *testing.T) {
	const branchCount = 2
	var barrier sync.WaitGroup
	var concurrent atomic.Int32
	barrier.Add(branchCount)
	pn := &ParallelNode{
		BaseNode: NewBaseNode("parallel_concurrent", NodeTypeAI, &FlowDeps{}),
	}
	for i := 0; i < branchCount; i++ {
		idx := i
		pn.Branches = append(pn.Branches, ParallelBranch{
			Name: string(rune('A' + idx)),
			Nodes: []Node{&fakeNode{
				name:     string(rune('A' + idx)),
				executed: &atomic.Int32{},
				Processor: func(fc *FlowContext) error {
					concurrent.Add(1)
					barrier.Done()
					barrier.Wait() // 等两个分支都到达
					return nil
				},
			}},
		})
	}
	fc := &FlowContext{Ctx: context.Background()}
	if err := pn.Processor(fc); err != nil {
		t.Fatalf("Processor failed: %v", err)
	}
	if concurrent.Load() != int32(branchCount) {
		t.Errorf("expected %d concurrent, got %d", branchCount, concurrent.Load())
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/dh-backend && go test ./orchestrator/core/...`
Expected: 编译失败（`ParallelNode`/`ParallelBranch` 未定义）。

- [ ] **Step 3: 实现 ParallelNode**

创建 `apps/dh-backend/orchestrator/core/parallel_node.go`：

```go
package core

import (
	"log"
	"sync"
)

// ParallelBranch 并行分支定义
type ParallelBranch struct {
	Name   string
	Nodes  []Node
	Skip   func(fc *FlowContext) bool       // 返回 true 则跳过该分支
	OnSkip func(fc *FlowContext) error      // 跳过时的处理（如标记阶段 Skipped）
	Merge  func(mainFC, branchFC *FlowContext) // join 后把分支结果写回主 fc
}

// ParallelNode 并行执行多个分支的复合节点，符合 Node 接口。
// 各分支拿到 FlowContext 的值拷贝，隔离 SessionID/ThreadID，避免并发写竞争；
// 全部分支完成后按顺序调 Merge 把结果写回主 fc。
type ParallelNode struct {
	BaseNode
	Branches []ParallelBranch
}

func (n *ParallelNode) Input(fc *FlowContext) error  { return nil }
func (n *ParallelNode) Output(fc *FlowContext) error { return nil }
func (n *ParallelNode) NextNode(fc *FlowContext) string { return "" }

// Processor 并行执行所有非跳过分支，任一出错即返回错误
func (n *ParallelNode) Processor(fc *FlowContext) error {
	type branchResult struct {
		idx     int
		branchFC FlowContext
		err      error
	}

	// 先处理跳过的分支（同步），收集 OnSkip 效果
	skipped := make(map[int]bool)
	for i, b := range n.Branches {
		if b.Skip != nil && b.Skip(fc) {
			skipped[i] = true
			if b.OnSkip != nil {
				if err := b.OnSkip(fc); err != nil {
					return err
				}
			}
			log.Printf("[ParallelNode] branch %s skipped", b.Name)
		}
	}

	// 并行执行非跳过分支
	var wg sync.WaitGroup
	results := make([]branchResult, len(n.Branches))
	for i, b := range n.Branches {
		if skipped[i] {
			continue
		}
		wg.Add(1)
		go func(idx int, branch ParallelBranch) {
			defer wg.Done()
			// 值拷贝隔离会话状态（SessionID/ThreadID）
			branchFC := *fc
			for _, node := range branch.Nodes {
				if err := ExecuteNode(&branchFC, node); err != nil {
					results[idx] = branchResult{idx: idx, err: err}
					return
				}
			}
			results[idx] = branchResult{idx: idx, branchFC: branchFC}
		}(i, b)
	}
	wg.Wait()

	// 检查错误
	for _, r := range results {
		if r.err != nil {
			return r.err
		}
	}

	// 按顺序合并结果到主 fc
	for i, b := range n.Branches {
		if skipped[i] || b.Merge == nil {
			continue
		}
		b.Merge(fc, &results[i].branchFC)
	}
	return nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/dh-backend && go test ./orchestrator/core/...`
Expected: 4 个测试全 PASS。

- [ ] **Step 5: vet 验证**

Run: `cd apps/dh-backend && go vet ./orchestrator/...`
Expected: 0 warnings。

- [ ] **Step 6: 提交**

```bash
git add apps/dh-backend/orchestrator/core/parallel_node.go apps/dh-backend/orchestrator/core/parallel_node_test.go
git commit -m "feat(orchestrator): add ParallelNode for true parallel fork/join execution"
```

---

### Task 6: 新增产品流程 Prompt 模板与 builder（仅新增）

**Files:**
- Modify: `apps/dh-backend/orchestrator/prompts/product.yaml`（新增 3 个 key）
- Modify: `apps/dh-backend/orchestrator/prompts/product.go`（新增 3 个 builder）
- Modify: `apps/dh-backend/orchestrator/prompts/loader_test.go`（新增测试）
- Test: `go test ./orchestrator/prompts/...`

**Interfaces:**
- Produces: `BuildProductBreakdownPrompt`、`BuildProductAIDraftReviewPrompt`、`BuildProductAIGatewayPrompt`（供 Task 7 节点调用）。
- 注意：本任务**不修改**现有 `BuildProductResearchPrompt`/`BuildProductProtoMakePrompt` 签名（留到 Task 8 与调用方一起改），保证中间状态可编译。

- [ ] **Step 1: 新增 3 个 YAML 模板**

在 `apps/dh-backend/orchestrator/prompts/product.yaml` 末尾追加：

```yaml
product_breakdown: |
  你是一位资深产品经理。请基于以下需求要点，进行功能拆解，产出功能拆解清单与模块关系图。

  【文件输出要求】
  1. 将文档写入 {{.WorkspacePath}}/pm-jobs/breakdown/ 目录下（如目录不存在请先创建）。
  2. 文件命名格式：{需求关键词}-breakdown.md。
  3. 文档使用 Markdown 格式编写，包含以下结构：
     - 功能模块划分
     - 功能清单（表格：功能名称、描述、优先级、所属模块）
     - 模块关系图（使用 Mermaid 语法）
     - 依赖与约束

  【输出标记】
  在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的文件。
  务必使用真实的文件系统绝对路径，不要使用占位符。

  【需求要点】
  {{.BrainstormResult}}

  【需求标题】
  {{.Title}}

product_ai_draft_review: |
  你是一位资深产品评审专家。请对以下业务方案草案进行自动复核，从完整性、一致性、可行性三个维度检查，并输出复核结论。

  【复核维度】
  1. 完整性：功能模块是否覆盖核心需求，是否有明显遗漏。
  2. 一致性：模块间逻辑是否自洽，是否存在冲突。
  3. 可行性：技术约束是否合理，是否存在明显风险。

  【输出格式要求】
  请按以下格式输出（全部使用中文）：

  ---
  ## AI 草案复核结论
  - **复核结论**: (pass / reject)
  - **问题列表**: （若 pass 可写「无明显问题」）
    1. ...
    2. ...
  - **改进建议**: （若 pass 可省略）
  ---

  注意：复核结论必须是明确的二选一，pass 表示草案可进入人工复核，reject 表示需重新生成草案。

  【方案草案】
  {{.DraftResult}}

  【需求标题】
  {{.Title}}

product_ai_gateway: |
  你是一位资深产品经理。请根据以下定稿方案，判断该需求是否需要生成 UI 交互原型。

  【决策规则】
  - 若需求涉及用户界面、页面交互、可视化展示，则 NEED_PROTO 为 true（需要原型）。
  - 若需求仅为后端逻辑、数据接口、定时任务等无 UI 场景，则 NEED_PROTO 为 false（仅 PRD）。
  - 不确定时默认 true，宁可有原型补充细节。

  【输出格式要求】
  请在回复末尾输出一行决策标记（必须严格匹配格式）：

  NEED_PROTO: true

  或

  NEED_PROTO: false

  【定稿方案】
  {{.DraftResult}}

  【需求标题】
  {{.Title}}
```

- [ ] **Step 2: 新增 3 个 builder**

在 `apps/dh-backend/orchestrator/prompts/product.go` 末尾追加：

```go
// BuildProductBreakdownPrompt 需求拆解（功能拆解清单与模块关系图）
func BuildProductBreakdownPrompt(title, brainstormResult, workspacePath string) string {
	rendered := Render("product_breakdown", map[string]string{
		"Title":            title,
		"BrainstormResult": brainstormResult,
		"WorkspacePath":    workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductAIDraftReviewPrompt AI 草案复核（输出报告 + pass/reject 决策）
func BuildProductAIDraftReviewPrompt(title, draftResult, workspacePath string) string {
	rendered := Render("product_ai_draft_review", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductAIGatewayPrompt AI 网关决策（输出 NEED_PROTO: true/false）
func BuildProductAIGatewayPrompt(title, draftResult, workspacePath string) string {
	rendered := Render("product_ai_gateway", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}
```

- [ ] **Step 3: 新增 builder 测试**

在 `apps/dh-backend/orchestrator/prompts/loader_test.go` 末尾追加：

```go
func TestRenderProductBreakdown(t *testing.T) {
	result := BuildProductBreakdownPrompt("测试需求", "需求要点内容", "/workspace")
	if !strings.Contains(result, "功能拆解清单") {
		t.Error("missing 功能拆解清单")
	}
	if !strings.Contains(result, "/workspace/pm-jobs/breakdown/") {
		t.Error("missing breakdown workspace path")
	}
	if !strings.Contains(result, "需求要点内容") {
		t.Error("missing brainstorm result")
	}
}

func TestRenderProductAIDraftReview(t *testing.T) {
	result := BuildProductAIDraftReviewPrompt("测试需求", "草案内容", "/workspace")
	if !strings.Contains(result, "pass / reject") {
		t.Error("missing pass/reject decision format")
	}
	if !strings.Contains(result, "草案内容") {
		t.Error("missing draft result")
	}
}

func TestRenderProductAIGateway(t *testing.T) {
	result := BuildProductAIGatewayPrompt("测试需求", "定稿方案内容", "/workspace")
	if !strings.Contains(result, "NEED_PROTO: true") {
		t.Error("missing NEED_PROTO true format")
	}
	if !strings.Contains(result, "NEED_PROTO: false") {
		t.Error("missing NEED_PROTO false format")
	}
	if !strings.Contains(result, "定稿方案内容") {
		t.Error("missing draft result")
	}
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/dh-backend && go test ./orchestrator/prompts/...`
Expected: 全部 PASS（含原有 + 3 个新增）。

- [ ] **Step 5: 提交**

```bash
git add apps/dh-backend/orchestrator/prompts/product.yaml apps/dh-backend/orchestrator/prompts/product.go apps/dh-backend/orchestrator/prompts/loader_test.go
git commit -m "feat(prompts): add product breakdown/ai_draft_review/ai_gateway prompts"
```

---

### Task 7: 新增 3 个 AI 节点

**Files:**
- Modify: `apps/dh-backend/orchestrator/nodes/product_flow_nodes.go`（新增 3 个节点构造与类型）
- Test: `go build ./...` + `go vet ./...`

**Interfaces:**
- Consumes: `prompts.BuildProductBreakdownPrompt`/`BuildProductAIDraftReviewPrompt`/`BuildProductAIGatewayPrompt`（Task 6）、`fc.BreakdownResult`/`AIDraftReviewResult`/`ProductAIDraftReviewResult`/`AIGatewayResult`/`NeedProto`（Task 2）、`CodeWriteNode`（已存在）。
- Produces: `NewProductBreakdownNode`、`NewProductAIDraftReviewNode`、`NewProductAIGatewayNode`（供 Task 9 流程构造）。

- [ ] **Step 1: 新增决策解析辅助常量**

在 `apps/dh-backend/orchestrator/nodes/product_flow_nodes.go` 顶部 import 后，新增决策标记常量：

```go
// AI 决策输出标记常量
const (
	aiDecisionPass      = "pass"
	aiDecisionReject    = "reject"
	needProtoTrueMark   = "NEED_PROTO: true"
	needProtoFalseMark  = "NEED_PROTO: false"
	draftReviewPassMark = "pass"
)
```

- [ ] **Step 2: 新增 ProductBreakdownNode**

在 `ProductBrainstormNode` 定义后（约 L96 后）新增：

```go
// ============================================================
// 需求拆解（AI ACTION 节点）：功能拆解清单与模块关系图
// ============================================================

func NewProductBreakdownNode(deps *core.FlowDeps) *ProductBreakdownNode {
	return &ProductBreakdownNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductBreakdown, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductBreakdownPrompt(fc.WorkitemTitle, fc.BrainstormResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[需求拆解]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.BreakdownResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductBreakdown, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "功能拆解清单、模块关系图",
					Prompt:     fc.BreakdownResult,
				})
				return nil
			},
		},
	}
}

type ProductBreakdownNode struct {
	CodeWriteNode
}

func (n *ProductBreakdownNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductBreakdown, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "结构化需求要点",
		OutputDesc:   "功能拆解清单、模块关系图",
	})
	return nil
}
```

- [ ] **Step 3: 新增 ProductAIDraftReviewNode（AI 判定节点）**

在 `ProductDraftNode` 定义后新增：

```go
// ============================================================
// AI 草案复核（AI JUDGE 节点）：自动判定 pass/reject
// ============================================================

func NewProductAIDraftReviewNode(deps *core.FlowDeps) *ProductAIDraftReviewNode {
	return &ProductAIDraftReviewNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductAIDraftReview, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductAIDraftReviewPrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[AI草案复核]",
			AfterComplete: func(fc *core.FlowContext) error {
				report := core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.AIDraftReviewResult = report
				// 解析决策：默认 pass（解析失败时交人工兜底）
				fc.ProductAIDraftReviewResult = aiDecisionPass
				if strings.Contains(strings.ToLower(report), aiDecisionReject) {
					fc.ProductAIDraftReviewResult = aiDecisionReject
				}
				outputDesc := "AI 复核通过，进入人工复核"
				if fc.ProductAIDraftReviewResult == aiDecisionReject {
					outputDesc = "AI 复核不通过，返回方案草案"
				}
				fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: outputDesc,
					Prompt:     report,
				})
				return nil
			},
		},
	}
}

type ProductAIDraftReviewNode struct {
	CodeWriteNode
}

func (n *ProductAIDraftReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "初步业务方案",
		OutputDesc:   "AI 复核报告（含 pass/reject）",
	})
	return nil
}

func (n *ProductAIDraftReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductAIDraftReviewResult == aiDecisionPass {
		return processobject.StageProductReview
	}
	return processobject.StageProductDraft
}
```

- [ ] **Step 4: 新增 ProductAIGatewayNode（AI 决策节点）**

在 `ProductReviewNode` 定义后新增：

```go
// ============================================================
// AI 网关（AI GATEWAY 节点）：决策是否需要原型
// ============================================================

func NewProductAIGatewayNode(deps *core.FlowDeps) *ProductAIGatewayNode {
	return &ProductAIGatewayNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductAIGateway, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductAIGatewayPrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[AI网关决策]",
			AfterComplete: func(fc *core.FlowContext) error {
				decision := core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.AIGatewayResult = decision
				// 解析决策：默认需要原型（解析失败时保守走完整流程）
				fc.NeedProto = true
				if strings.Contains(decision, needProtoFalseMark) {
					fc.NeedProto = false
				}
				outputDesc := "决策：生成原型 + PRD（并行）"
				if !fc.NeedProto {
					outputDesc = "决策：仅生成 PRD（跳过原型）"
				}
				fc.UpdateStageFull(processobject.StageProductAIGateway, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: outputDesc,
					Prompt:     decision,
				})
				return nil
			},
		},
	}
}

type ProductAIGatewayNode struct {
	CodeWriteNode
}

func (n *ProductAIGatewayNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductAIGateway, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "方案复核通过结论",
		OutputDesc:   "决策结论（输出路径）",
	})
	return nil
}
```

- [ ] **Step 5: 补充 strings import**

在 `apps/dh-backend/orchestrator/nodes/product_flow_nodes.go` import 块新增 `"strings"`：

```go
import (
	"fmt"
	"log"
	"strings"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)
```

- [ ] **Step 6: 编译与 vet 验证**

Run: `cd apps/dh-backend && go build ./... && go vet ./...`
Expected: 成功，0 warnings。

- [ ] **Step 7: 提交**

```bash
git add apps/dh-backend/orchestrator/nodes/product_flow_nodes.go
git commit -m "feat(orchestrator): add ProductBreakdown/AIDraftReview/AIGateway nodes"
```

---

### Task 8: 修改现有节点（路由/类型/prompt 输入）+ 修改现有 prompt 签名

**Files:**
- Modify: `apps/dh-backend/orchestrator/prompts/product.go:20-27,49-57`（research/proto_make 签名）
- Modify: `apps/dh-backend/orchestrator/prompts/product.yaml:103,177`（模板变量）
- Modify: `apps/dh-backend/orchestrator/nodes/product_flow_nodes.go`（5 个节点修改）
- Test: `go build ./...` + `go vet ./...` + `go test ./orchestrator/prompts/...`

**Interfaces:**
- Consumes: Task 6 新增 builder、Task 2 新增字段。
- Produces: 修正后的节点路由与 prompt 签名，供 Task 9 流程构造。
- 注意：本任务同时改 prompt 签名与调用方，保证可编译。

- [ ] **Step 1: 修改 product_research 模板变量**

`apps/dh-backend/orchestrator/prompts/product.yaml` L103，`{{if .Description}}描述: {{.Description}}{{end}}` 改为引用 BreakdownResult。将该行替换为：

```yaml
  {{if .BreakdownResult}}功能拆解清单: {{.BreakdownResult}}{{end}}
```

- [ ] **Step 2: 修改 product_proto_make 模板变量**

同文件 L176-177，`【PRD】\n  {{.PRDResult}}` 改为 `【定稿方案】\n  {{.DraftResult}}`：

```yaml
  【定稿方案】
  {{.DraftResult}}
```

- [ ] **Step 3: 修改 BuildProductResearchPrompt 签名**

`apps/dh-backend/orchestrator/prompts/product.go` L19-27，参数 `description` 改 `breakdownResult`，map key `Description` 改 `BreakdownResult`：

```go
// BuildProductResearchPrompt 方案调研与选型
func BuildProductResearchPrompt(title, breakdownResult, workspacePath string) string {
	rendered := Render("product_research", map[string]string{
		"Title":            title,
		"BreakdownResult": breakdownResult,
		"WorkspacePath":   workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}
```

- [ ] **Step 4: 修改 BuildProductProtoMakePrompt 签名**

同文件 L49-57，参数 `prdResult` 改 `draftResult`，map key `PRDResult` 改 `DraftResult`：

```go
// BuildProductProtoMakePrompt 原型生成
func BuildProductProtoMakePrompt(title, draftResult, workspacePath string) string {
	rendered := Render("product_proto_make", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}
```

- [ ] **Step 5: 修改 ProductResearchNode 调用与 InputDesc**

`apps/dh-backend/orchestrator/nodes/product_flow_nodes.go` `NewProductResearchNode`（L119-121），`BuildPrompt` 改用 `fc.BreakdownResult`：

```go
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductResearchPrompt(fc.WorkitemTitle, fc.BreakdownResult, fc.WorkspacePath)
			},
```

`ProductResearchNode.Input`（L146），InputDesc 改「功能拆解清单」：

```go
		InputDesc:    "功能拆解清单",
```

- [ ] **Step 6: 修改 ProductProtoMakeNode 调用与 InputDesc**

`NewProductProtoMakeNode`（L313-314），`BuildPrompt` 改用 `fc.DraftResult`：

```go
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductProtoMakePrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
```

`ProductProtoMakeNode.Input`（L340），InputDesc 改「定稿方案」：

```go
		InputDesc:    "定稿方案",
```

- [ ] **Step 7: 修改 ProductProtoReviewNode 类型 + 路由 + InputDesc**

`flows/product_flow.go` 中 `ProductProtoReviewNode` 构造的节点类型改 human（在 Task 9 统一改 flow.go；此处先改节点文件本身不涉及类型，类型在 flow.go 构造处）。

`ProductProtoReviewNode.Input`（L360），InputDesc 改：

```go
		InputDesc:    "UI 交互原型（可选） + 结构化 PRD + 定稿方案",
```

`ProductProtoReviewNode.Processor` 通知 Body（L374）改：

```go
		Body:        fmt.Sprintf("需求「%s」的 PRD（与原型，如有）已准备就绪，请进行联合复核。通过则进入需求评审，不通过将返回方案草案重新构思。", fc.WorkitemTitle),
```

`ProductProtoReviewNode.Output`（L399），reject OutputDesc 改：

```go
		outputDesc = "复核不通过，返回方案草案"
```

`ProductProtoReviewNode.NextNode`（L411-416），reject 改 `Draft`：

```go
func (n *ProductProtoReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductProtoReviewResult == "pass" {
		return processobject.StageProductFinalReview
	}
	return processobject.StageProductDraft
}
```

- [ ] **Step 8: 修改 ProductFinalReviewNode 路由 + OutputDesc**

`ProductFinalReviewNode.Output`（L471），reject OutputDesc 改：

```go
		outputDesc = "需求评审驳回，返回原型+PRD联合复核"
```

`ProductFinalReviewNode.NextNode`（L483-488），reject 改 `ProtoReview`：

```go
func (n *ProductFinalReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductFinalReviewResult == "pass" {
		return "" // 流程结束
	}
	return processobject.StageProductProtoReview
}
```

- [ ] **Step 9: 修改 ProductReviewNode 路由 + 通知 data**

`ProductReviewNode.NextNode`（L257-262），pass 改 `AIGateway`：

```go
func (n *ProductReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductReviewResult == "pass" {
		return processobject.StageProductAIGateway
	}
	return processobject.StageProductDraft
}
```

`ProductReviewNode.Processor` 通知 data（L233 后）新增 `aiDraftReviewResult`：

```go
			"draftResult":         fc.DraftResult,
			"aiDraftReviewResult": fc.AIDraftReviewResult,
```

`ProductReviewNode.Output`（L243），pass OutputDesc 改：

```go
	outputDesc := "复核通过，进入 AI 网关决策"
```

- [ ] **Step 10: 编译与 vet 验证**

Run: `cd apps/dh-backend && go build ./... && go vet ./...`
Expected: 成功，0 warnings。

- [ ] **Step 11: 运行 prompts 测试**

Run: `cd apps/dh-backend && go test ./orchestrator/prompts/...`
Expected: 全部 PASS（注意：既有 `TestRenderProductBrainstorm` 等不涉及修改的 builder 仍通过；research/proto_make 无既有测试）。

- [ ] **Step 12: 提交**

```bash
git add apps/dh-backend/orchestrator/prompts/product.go apps/dh-backend/orchestrator/prompts/product.yaml apps/dh-backend/orchestrator/nodes/product_flow_nodes.go
git commit -m "fix(orchestrator): correct product flow routing/types/prompt inputs + research uses breakdown"
```

---

### Task 9: 重写产品流程构造（接入 ParallelNode）

**Files:**
- Modify: `apps/dh-backend/orchestrator/flows/product_flow.go`（重写节点序列）
- Test: `go build ./...` + `go vet ./...`

**Interfaces:**
- Consumes: Task 7 新节点、Task 8 修改后节点、Task 5 `ParallelNode`、Task 1 `StageStatusSkipped`。
- Produces: 完整 11 节点产品流程，含真并行 fork/join。

- [ ] **Step 1: 重写 NewProductFlow**

替换 `apps/dh-backend/orchestrator/flows/product_flow.go` 全文：

```go
package flows

import (
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/nodes"
)

// NewProductFlow 创建产品流程
// 拓扑：需求头脑风暴 -> 需求拆解 -> 方案调研 -> 方案草案 -> AI草案复核(判定) ->
//       方案自主复核(人工) -> AI网关(决策) -> [PRD初稿 || 原型生成] 并行 -> 原型+PRD联合复核(人工) -> 需求评审(人工) -> 结束
func NewProductFlow(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("ProductFlow", deps,
		// 1. 需求受理（人工，建流程+通知，不暂停）
		&nodes.ProductRequirementNode{BaseNode: core.NewBaseNode(processobject.StageProductBrainstorm, core.NodeTypeHuman, deps)},
		// 2. 需求头脑风暴（AI）
		nodes.NewProductBrainstormNode(deps),
		// 3. 需求拆解（AI）
		nodes.NewProductBreakdownNode(deps),
		// 4. 方案调研（AI，输入为功能拆解清单）
		nodes.NewProductResearchNode(deps),
		// 5. 方案草案（AI）
		nodes.NewProductDraftNode(deps),
		// 6. AI 草案复核（AI 判定：pass->人工复核，reject->草案）
		nodes.NewProductAIDraftReviewNode(deps),
		// 7. 方案自主复核（人工，暂停）
		&nodes.ProductReviewNode{BaseNode: core.NewBaseNode(processobject.StageProductReview, core.NodeTypeHuman, deps)},
		// 8. AI 网关决策（AI，决定 NeedProto）
		nodes.NewProductAIGatewayNode(deps),
		// 9. 并行分叉：PRD（常驻） || 原型（仅 NeedProto）
		newProductParallelNode(deps),
		// 10. 原型+PRD 联合复核（人工，暂停）
		&nodes.ProductProtoReviewNode{BaseNode: core.NewBaseNode(processobject.StageProductProtoReview, core.NodeTypeHuman, deps)},
		// 11. 需求评审（人工，暂停，结束）
		&nodes.ProductFinalReviewNode{BaseNode: core.NewBaseNode(processobject.StageProductFinalReview, core.NodeTypeHuman, deps)},
	)
}

// newProductParallelNode 构造产品流程的并行分叉节点。
// 分支 A（常驻）：PRD 初稿生成；分支 B（条件）：原型生成，仅当 NeedProto=true 时执行，
// 否则跳过并将 product_proto_make 阶段标记为 Skipped。两路均以定稿方案(DraftResult)为输入。
func newProductParallelNode(deps *core.FlowDeps) *core.ParallelNode {
	return &core.ParallelNode{
		BaseNode: core.NewBaseNode("product_parallel_fork", core.NodeTypeAI, deps),
		Branches: []core.ParallelBranch{
			{
				Name:  "prd_write",
				Nodes: []core.Node{nodes.NewProductPRDWriteNode(deps)},
				Merge: func(mainFC, branchFC *core.FlowContext) {
					mainFC.PRDResult = branchFC.PRDResult
				},
			},
			{
				Name:  "proto_make",
				Nodes: []core.Node{nodes.NewProductProtoMakeNode(deps)},
				Skip:  func(fc *core.FlowContext) bool { return !fc.NeedProto },
				OnSkip: func(fc *core.FlowContext) error {
					fc.UpdateStage(processobject.StageProductProtoMake, processobject.StageStatusSkipped)
					return nil
				},
				Merge: func(mainFC, branchFC *core.FlowContext) {
					mainFC.ProtoResult = branchFC.ProtoResult
				},
			},
		},
	}
}
```

- [ ] **Step 2: 编译与 vet 验证**

Run: `cd apps/dh-backend && go build ./... && go vet ./...`
Expected: 成功，0 warnings。

- [ ] **Step 3: 运行全部后端测试**

Run: `cd apps/dh-backend && go test ./orchestrator/... ./agent/chat/tests/...`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/dh-backend/orchestrator/flows/product_flow.go
git commit -m "feat(orchestrator): rewrite product flow with 11 nodes + parallel fork/join"
```

---

### Task 10: 前端 process-api + FlowGraph（skipped 状态 + final_review 驳回边）

**Files:**
- Modify: `apps/dh-frontend/src/lib/process-api.ts:52-57`（STAGE_STATUS 新增 SKIPPED）
- Modify: `apps/dh-frontend/src/components/FlowGraph.tsx:7-26`（状态颜色/标签）
- Modify: `apps/dh-frontend/src/components/FlowGraph.tsx:312-320`（edgeStyle skipped 处理）
- Modify: `apps/dh-frontend/src/components/FlowGraph.tsx`（产品流程新增 final_review 驳回边）
- Test: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`

**Interfaces:**
- Consumes: Task 1 `StageStatusSkipped`（后端会下发 `skipped` 状态）。
- Produces: 前端可渲染 `skipped` 状态 + final_review 驳回边。

- [ ] **Step 1: STAGE_STATUS 新增 SKIPPED**

`apps/dh-frontend/src/lib/process-api.ts` L52-57：

```ts
export const STAGE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;
```

- [ ] **Step 2: FlowGraph 状态颜色/标签新增 skipped**

`apps/dh-frontend/src/components/FlowGraph.tsx` L7-26，三个 map 各加一行：

```ts
const STATUS_STROKE: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '#cbd5e1',
  [STAGE_STATUS.IN_PROGRESS]: '#3b82f6',
  [STAGE_STATUS.COMPLETED]: '#10b981',
  [STAGE_STATUS.FAILED]: '#ef4444',
  [STAGE_STATUS.SKIPPED]: '#94a3b8',
};

const STATUS_FILL: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '#ffffff',
  [STAGE_STATUS.IN_PROGRESS]: '#dbeafe',
  [STAGE_STATUS.COMPLETED]: '#d1fae5',
  [STAGE_STATUS.FAILED]: '#fee2e2',
  [STAGE_STATUS.SKIPPED]: '#f1f5f9',
};

const STATUS_LABELS: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '待执行',
  [STAGE_STATUS.IN_PROGRESS]: '进行中',
  [STAGE_STATUS.COMPLETED]: '已完成',
  [STAGE_STATUS.FAILED]: '失败',
  [STAGE_STATUS.SKIPPED]: '已跳过',
};
```

- [ ] **Step 3: edgeStyle 处理 skipped**

`apps/dh-frontend/src/components/FlowGraph.tsx` `edgeStyle` 函数（L312-320），skipped 视同 pending：

```ts
function edgeStyle(srcStatus: string, isConditional: boolean) {
  if (srcStatus === STAGE_STATUS.COMPLETED) {
    return { stroke: EDGE_COLOR_PASSED, dasharray: '', animate: false };
  }
  if (srcStatus === STAGE_STATUS.IN_PROGRESS) {
    return { stroke: EDGE_COLOR_ACTIVE, dasharray: DOT_DASH, animate: true };
  }
  // pending / failed / skipped 均按 pending 样式处理
  return { stroke: EDGE_COLOR_PENDING, dasharray: isConditional ? '6 4' : '', animate: false };
}
```

- [ ] **Step 4: 产品流程新增 final_review 驳回边**

`apps/dh-frontend/src/components/FlowGraph.tsx` 产品流程边区块，在 `proto_review -> final_review` 通过边（L591）之后、驳回边区块中新增 final_review 驳回边。在驳回边 3（L623-634）之后追加：

```ts
      // 驳回边 4：需求评审不通过 -> 原型+PRD联合复核（顶部折线，退回联合复核）
      {
        const srcCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_FINAL_REVIEW, bottomRowRef);
        const tgtCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_PROTO_REVIEW, bottomRowRef);
        addEdge(
          STAGE_NAMES.PRODUCT_FINAL_REVIEW,
          STAGE_NAMES.PRODUCT_PROTO_REVIEW,
          true,
          'N 不通过',
          [{ x: srcCx, y: ORTH_TOP_Y - 18 }, { x: tgtCx, y: ORTH_TOP_Y - 18 }],
        );
      }
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`
Expected: 0 errors。

- [ ] **Step 6: 提交**

```bash
git add apps/dh-frontend/src/lib/process-api.ts apps/dh-frontend/src/components/FlowGraph.tsx
git commit -m "feat(frontend): add skipped status rendering + final_review reject edge in product flow"
```

---

### Task 11: 前端 ProcessDetail 状态映射新增 skipped

**Files:**
- Modify: `apps/dh-frontend/src/pages/ProcessDetail.tsx:80-143`（7 处状态映射）
- Test: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`

**Interfaces:**
- Consumes: Task 10 `STAGE_STATUS.SKIPPED`。

- [ ] **Step 1: STAGE_STATUS_LABELS 新增 skipped**

`apps/dh-frontend/src/pages/ProcessDetail.tsx` L80-85：

```ts
const STAGE_STATUS_LABELS: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '待执行',
  [STAGE_STATUS.IN_PROGRESS]: '进行中',
  [STAGE_STATUS.COMPLETED]: '已完成',
  [STAGE_STATUS.FAILED]: '失败',
  [STAGE_STATUS.SKIPPED]: '已跳过',
};
```

- [ ] **Step 2: Badge variant map 新增 skipped**

L109-113（`STAGE_STATUS.PENDING]: 'outline'` 后新增）：

```ts
  [STAGE_STATUS.SKIPPED]: 'outline',
```

- [ ] **Step 3: icon map 新增 skipped**

L118-122（使用 `MinusCircle`，需在 import 中确认已导入；若未导入改用已导入的图标）。先检查 lucide-react import，若 `MinusCircle` 未导入则用已有的 `Circle`。在 `STAGE_STATUS.FAILED]: XCircle` 后新增：

```ts
  [STAGE_STATUS.SKIPPED]: Circle,
```

- [ ] **Step 4: text color map 新增 skipped**

L125-129（`STAGE_STATUS.FAILED]: 'text-red-500'` 后新增）：

```ts
  [STAGE_STATUS.SKIPPED]: 'text-slate-400',
```

- [ ] **Step 5: border color map 新增 skipped**

L133-136（`STAGE_STATUS.FAILED]` 后新增）：

```ts
  [STAGE_STATUS.SKIPPED]: 'border-slate-200 dark:border-slate-800',
```

- [ ] **Step 6: bg color map 新增 skipped**

L140-143（`STAGE_STATUS.FAILED]` 后新增）：

```ts
  [STAGE_STATUS.SKIPPED]: 'bg-slate-50 dark:bg-slate-950/40',
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`
Expected: 0 errors。

- [ ] **Step 8: 提交**

```bash
git add apps/dh-frontend/src/pages/ProcessDetail.tsx
git commit -m "feat(frontend): add skipped status to ProcessDetail status maps"
```

---

### Task 12: 全量验证 + 缺陷文档

**Files:**
- Create: `docs/bugs/2026-08-13-product-flow-parallel-fork-join.md`
- Test: 全量构建 + lint + 运行

- [ ] **Step 1: 后端全量编译 + vet + 测试**

Run: `cd apps/dh-backend && go build ./... && go vet ./... && go test ./...`
Expected: 成功，0 warnings，测试全 PASS。

- [ ] **Step 2: 前端类型检查 + lint**

Run: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json && pnpm lint`
Expected: 0 errors。

- [ ] **Step 3: 全量构建**

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 4: 重启开发环境并验证**

Run: `bash scripts/restart-dev.sh`
然后用 curl 验证后端健康：

```bash
curl -s http://localhost:8080/health || echo "backend not ready"
curl -s http://localhost:8888 | head -5 || echo "frontend not ready"
```
Expected: 后端前端均响应正常。

- [ ] **Step 5: 编写缺陷文档**

创建 `docs/bugs/2026-08-13-product-flow-parallel-fork-join.md`：

```markdown
# 产品流程前后端映射差异与并行 Fork/Join 重构

## 现象

产品需求设计流程后端实际执行节点（9 个）与前端设计（11 阶段 + 并行分叉）不一致：

- 后端缺失 `product_breakdown`、`product_ai_draft_review`、`product_ai_gateway` 三个节点。
- PRD 与原型生成为顺序执行（proto 依赖 PRD），前端设计为并行（均依赖 draft）。
- `ProductProtoReviewNode` 节点类型误标 AI（实际人工复核）。
- 驳回路由错误：`proto_review` reject 回 PRDWrite（应回 Draft）；`final_review` reject 回 PRDWrite（应回 ProtoReview）。
- 跳过原型时无 `skipped` 状态标记。

影响：前端流程图展示与后端实际执行不符，用户看到的阶段流转与真实行为不一致；原型与 PRD 无法并行，耗时翻倍。

## 根因

1. 后端 `flows/product_flow.go` 节点序列未与 `domain/process/object/types.go` 的 `NewProductProcess` 11 阶段定义同步演进，缺少 3 个节点。
2. 引擎 `core/flow.go` 仅有顺序执行能力，无 fork/join 原语，无法表达并行分叉。
3. `ProductProtoReviewNode` 构造时误用 `NodeTypeAI`，但其 Input/Processor 为人工复核行为。
4. 各 review 节点的 `NextNode` reject 目标在迭代中未随设计调整。
5. `ProcessServiceImpl.UpdateStage` 为非原子 read-modify-write，无锁，无法支持并行分支并发更新。

## 解决方案

1. 新增 `core.ParallelNode` 复合并行原语：分支用 `FlowContext` 值拷贝隔离 `SessionID/ThreadID`，goroutine 并行执行，join 后合并结果；条件分支支持 `Skip`/`OnSkip`（标记 `StageStatusSkipped`）。
2. 提取 `core.ExecuteNode` 包级函数供主循环与并行分支复用。
3. `ProcessServiceImpl` 新增 `sync.Mutex` 保护 `Create`/`UpdateStage` 的 read-modify-write。
4. 补齐 3 个 AI 节点（Breakdown/AIDraftReview/AIGateway）+ 3 个 prompt 模板。
5. 修正 5 个现有节点路由/类型/prompt 输入；research 改读 BreakdownResult，proto_make 改读 DraftResult。
6. 重写 `flows/product_flow.go` 为 11 节点 + ParallelNode（PRD || Proto 真并行）。
7. 前端新增 `skipped` 状态渲染（FlowGraph + ProcessDetail）+ final_review 驳回边。

验证：`go build`/`go vet`/`go test` 全通过；`tsc --noEmit` 0 errors；`pnpm build` 成功；开发环境重启后前后端响应正常。
```

- [ ] **Step 6: 提交**

```bash
git add docs/bugs/2026-08-13-product-flow-parallel-fork-join.md
git commit -m "docs(bug): record product flow parallel fork/join refactor"
```

---

## 自检结果

**Spec 覆盖核对**：

- §2 目标拓扑 11 节点 -> Task 9 全部接入 ✓
- §3.1 ExecuteNode 提取 -> Task 4 ✓
- §3.2 ParallelNode -> Task 5 ✓
- §3.3 ProcessServiceImpl 加锁 -> Task 3 ✓
- §3.4 FlowContext 字段 -> Task 2 ✓
- §3.5 StageStatusSkipped -> Task 1 ✓
- §4.1 新增 3 节点 -> Task 7 ✓
- §4.2 ParallelNode 实例 -> Task 9 ✓
- §4.3 修改 5 节点 -> Task 8 ✓
- §4.4 prompt 新增 3 + 修改 2 -> Task 6（新增）+ Task 8（修改）✓
- §4.5 FinalReview 改 Judge -> Task 1 ✓
- §5.1 process-api SKIPPED -> Task 10 ✓
- §5.2 FlowGraph skipped + final_review 驳回边 -> Task 10 ✓
- §5.3 ProcessDetail 7 处映射 -> Task 11 ✓
- §6 实施步骤 -> Task 1-9 ✓
- §7 验证计划 -> Task 12 ✓
- §8 风险缓解 -> ParallelNode 值拷贝（Task 5）+ 解析失败默认（Task 7）✓

**类型一致性**：`ParallelBranch`/`ParallelNode` 在 Task 5 定义，Task 9 使用 `core.ParallelBranch`/`core.ParallelNode` 一致；`ExecuteNode` Task 4 定义 Task 5 使用一致；builder 签名 Task 6/8 定义与 Task 7/8 调用一致。

**占位符扫描**：无 TBD/TODO，每个步骤含具体代码或命令。
