package core

import (
	"errors"
)

// NodeType 节点类型：人工节点或 AI 节点
type NodeType string

const (
	NodeTypeHuman NodeType = "human"
	NodeTypeAI    NodeType = "ai"
)

// ErrPauseFlow 表示节点需要暂停流程，等待人工操作后恢复
var ErrPauseFlow = errors.New("flow paused: waiting for human action")

// Node 流程节点接口
type Node interface {
	Name() string
	Type() NodeType
	Input(fc *FlowContext) error
	Processor(fc *FlowContext) error
	Output(fc *FlowContext) error
	NextNode(fc *FlowContext) string
}

// BaseNode 节点基类，提供公共字段
type BaseNode struct {
	name     string
	nodeType NodeType
	Deps     *FlowDeps
}

func (n *BaseNode) Name() string           { return n.name }
func (n *BaseNode) Type() NodeType         { return n.nodeType }
func (n *BaseNode) NextNode(fc *FlowContext) string { return "" }

// NewBaseNode 创建节点基类
func NewBaseNode(name string, nodeType NodeType, deps *FlowDeps) BaseNode {
	return BaseNode{name: name, nodeType: nodeType, Deps: deps}
}
