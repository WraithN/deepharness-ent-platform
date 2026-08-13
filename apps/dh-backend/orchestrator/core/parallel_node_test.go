package core

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

// fakeNode 测试用节点，记录执行顺序与并发数。
// 通过 proc 字段支持按用例覆盖 Processor 行为（方法委派给 proc，nil 时走默认计数逻辑）。
type fakeNode struct {
	name      string
	outputVal string
	executed  *atomic.Int32
	proc      func(fc *FlowContext) error
}

func (n *fakeNode) Name() string                { return n.name }
func (n *fakeNode) Type() NodeType              { return NodeTypeAI }
func (n *fakeNode) Input(fc *FlowContext) error { return nil }
func (n *fakeNode) Processor(fc *FlowContext) error {
	if n.proc != nil {
		return n.proc(fc)
	}
	n.executed.Add(1)
	return nil
}
func (n *fakeNode) Output(fc *FlowContext) error {
	// 把 outputVal 写到 fc 对应字段（用 CodeResult 复用做演示）
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
				Name:   "B",
				Nodes:  []Node{newFakeNode("b1", "resultB", &executed)},
				Skip:   func(fc *FlowContext) bool { return true },
				OnSkip: func(fc *FlowContext) error { fc.ProtoResult = "SKIPPED"; return nil },
				Merge:  func(mainFC, branchFC *FlowContext) { mainFC.ProtoResult = branchFC.CodeResult },
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
	errNode.proc = func(fc *FlowContext) error { executed.Add(1); return errors.New("boom") }
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
				proc: func(fc *FlowContext) error {
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
