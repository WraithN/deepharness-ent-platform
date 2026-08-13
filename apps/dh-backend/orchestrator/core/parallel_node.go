package core

import (
	"log"
	"sync"
)

// ParallelBranch 并行分支定义
type ParallelBranch struct {
	Name   string
	Nodes  []Node
	Skip   func(fc *FlowContext) bool          // 返回 true 则跳过该分支
	OnSkip func(fc *FlowContext) error         // 跳过时的处理（如标记阶段 Skipped）
	Merge  func(mainFC, branchFC *FlowContext) // join 后把分支结果写回主 fc
}

// ParallelNode 并行执行多个分支的复合节点，符合 Node 接口。
// 各分支拿到 FlowContext 的值拷贝，隔离 SessionID/ThreadID，避免并发写竞争；
// 全部分支完成后按顺序调 Merge 把结果写回主 fc。
type ParallelNode struct {
	BaseNode
	Branches []ParallelBranch
}

func (n *ParallelNode) Input(fc *FlowContext) error     { return nil }
func (n *ParallelNode) Output(fc *FlowContext) error    { return nil }
func (n *ParallelNode) NextNode(fc *FlowContext) string { return "" }

// Processor 并行执行所有非跳过分支，任一出错即返回错误。
// 执行顺序：先同步处理 Skip 分支（收集 OnSkip 副作用）-> 并行执行剩余分支 ->
// 检查任一分支错误 -> 按声明顺序串行 Merge 结果回主 fc。
func (n *ParallelNode) Processor(fc *FlowContext) error {
	type branchResult struct {
		idx      int
		branchFC FlowContext
		err      error
	}

	// 先处理跳过的分支（同步），收集 OnSkip 效果。
	// 使用 guard clause（提前 continue）控制嵌套层级：Skip/OnSkip/err 三层判断扁平化。
	skipped := make(map[int]bool)
	for i, b := range n.Branches {
		if b.Skip == nil || !b.Skip(fc) {
			continue
		}
		skipped[i] = true
		if b.OnSkip != nil {
			if err := b.OnSkip(fc); err != nil {
				return err
			}
		}
		log.Printf("[ParallelNode] branch %s skipped", b.Name)
	}

	// 并行执行非跳过分支：每个 goroutine 拿 fc 的值拷贝，互不干扰。
	// 结果按分支下标写入 results[idx]，不同 goroutine 写不同下标，无竞争。
	var wg sync.WaitGroup
	results := make([]branchResult, len(n.Branches))
	for i, b := range n.Branches {
		if skipped[i] {
			continue
		}
		wg.Add(1)
		go func(idx int, branch ParallelBranch) {
			defer wg.Done()
			// 值拷贝隔离会话状态（SessionID/ThreadID 等），分支内 ExecuteNode 仅修改自己的 branchFC
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

	// 检查错误：任一分支失败即向上冒泡，保证错误不被吞掉
	for _, r := range results {
		if r.err != nil {
			return r.err
		}
	}

	// 按顺序合并结果到主 fc：串行执行 Merge，避免多分支同时写主 fc 的字段竞争
	for i, b := range n.Branches {
		if skipped[i] || b.Merge == nil {
			continue
		}
		b.Merge(fc, &results[i].branchFC)
	}
	return nil
}
