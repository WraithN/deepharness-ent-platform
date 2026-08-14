package core

import (
	"errors"
	"fmt"
	"log"
)

// Flow 流程基类
type Flow struct {
	Name  string
	Nodes []Node
	Deps  *FlowDeps
}

func NewFlow(name string, deps *FlowDeps, nodes ...Node) *Flow {
	return &Flow{Name: name, Deps: deps, Nodes: nodes}
}

// Run 从头执行流程，直到完成或暂停
func (f *Flow) Run(fc *FlowContext) error {
	log.Printf("[Flow:%s] starting, nodes=%d", f.Name, len(f.Nodes))
	currentIdx := 0
	for currentIdx < len(f.Nodes) {
		node := f.Nodes[currentIdx]
		if err := ExecuteNode(fc, node); err != nil {
			if errors.Is(err, ErrPauseFlow) {
				log.Printf("[Flow:%s] paused at node %s", f.Name, node.Name())
				fc.PausedNode = node.Name()
				return err
			}
			log.Printf("[Flow:%s] node %s failed: %v", f.Name, node.Name(), err)
			return err
		}
		if next := node.NextNode(fc); next != "" {
			if idx := f.indexOfNode(next); idx != -1 {
				currentIdx = idx
				continue
			}
		}
		currentIdx++
	}
	log.Printf("[Flow:%s] completed", f.Name)
	return nil
}

// Resume 恢复暂停的流程
func (f *Flow) Resume(fc *FlowContext) error {
	if fc.PausedNode == "" {
		return fmt.Errorf("no paused node to resume")
	}
	startIdx := f.indexOfNode(fc.PausedNode)
	if startIdx == -1 {
		return fmt.Errorf("paused node %s not found", fc.PausedNode)
	}
	log.Printf("[Flow:%s] resuming from node %s", f.Name, fc.PausedNode)

	pausedNode := f.Nodes[startIdx]
	if err := pausedNode.Output(fc); err != nil {
		log.Printf("[Flow:%s] node %s output failed on resume: %v", f.Name, pausedNode.Name(), err)
		return err
	}

	currentIdx := startIdx + 1
	if next := pausedNode.NextNode(fc); next != "" {
		if idx := f.indexOfNode(next); idx != -1 {
			currentIdx = idx
		}
	}

	for currentIdx < len(f.Nodes) {
		node := f.Nodes[currentIdx]
		if err := ExecuteNode(fc, node); err != nil {
			if errors.Is(err, ErrPauseFlow) {
				log.Printf("[Flow:%s] paused at node %s", f.Name, node.Name())
				fc.PausedNode = node.Name()
				return err
			}
			log.Printf("[Flow:%s] node %s failed: %v", f.Name, node.Name(), err)
			return err
		}
		if next := node.NextNode(fc); next != "" {
			if idx := f.indexOfNode(next); idx != -1 {
				currentIdx = idx
				continue
			}
		}
		currentIdx++
	}
	log.Printf("[Flow:%s] completed after resume", f.Name)
	return nil
}

// Retry 从指定节点重新执行流程（用于失败节点重试）。
// 与 Resume 不同：Retry 会重新执行目标节点的 Input -> Processor -> Output，
// 而 Resume 只执行暂停节点的 Output（其 Input/Processor 已在此前完成）。
func (f *Flow) Retry(fc *FlowContext, retryNodeName string) error {
	startIdx := f.indexOfNode(retryNodeName)
	if startIdx == -1 {
		return fmt.Errorf("retry node %s not found", retryNodeName)
	}
	log.Printf("[Flow:%s] retrying from node %s", f.Name, retryNodeName)

	currentIdx := startIdx
	for currentIdx < len(f.Nodes) {
		node := f.Nodes[currentIdx]
		if err := ExecuteNode(fc, node); err != nil {
			if errors.Is(err, ErrPauseFlow) {
				log.Printf("[Flow:%s] paused at node %s", f.Name, node.Name())
				fc.PausedNode = node.Name()
				return err
			}
			log.Printf("[Flow:%s] node %s failed: %v", f.Name, node.Name(), err)
			return err
		}
		if next := node.NextNode(fc); next != "" {
			if idx := f.indexOfNode(next); idx != -1 {
				currentIdx = idx
				continue
			}
		}
		currentIdx++
	}
	log.Printf("[Flow:%s] completed after retry", f.Name)
	return nil
}

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

func (f *Flow) indexOfNode(name string) int {
	for i, node := range f.Nodes {
		if node.Name() == name {
			return i
		}
	}
	return -1
}
