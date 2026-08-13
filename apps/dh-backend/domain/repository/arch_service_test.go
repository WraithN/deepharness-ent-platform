package repository

import (
	"testing"
)

// TestFilterClassView 验证 loadClassView 的纯过滤逻辑：
// 仅保留 file/function/class 类型节点，且 filePath 须命中 module path 前缀；
// 边仅当两端节点均存活时保留。
func TestFilterClassView(t *testing.T) {
	kg := kgGraph{
		Nodes: []kgNode{
			{ID: "f1", Type: "class", Name: "App", FilePath: "gateway/app.go"},
			{ID: "f2", Type: "class", Name: "Repo", FilePath: "domain/repo.go"},
			{ID: "c1", Type: "config", Name: "cfg", FilePath: "gateway/cfg.yaml"},
		},
		Edges: []kgEdge{
			{Source: "f1", Target: "f2", Kind: "imports"},
			{Source: "f1", Target: "c1", Kind: "contains"},
		},
	}
	view := filterClassView(kg, "gateway/")
	if len(view.Nodes) != 1 || view.Nodes[0].ID != "f1" {
		t.Fatalf("expected only gateway/app.go class node, got %+v", view.Nodes)
	}
	// c1 是 config 类型被过滤；f2 不在 gateway/ 前缀下；f1->f2 边因 f2 被剔除
	if len(view.Edges) != 0 {
		t.Fatalf("expected 0 edges after filtering, got %d", len(view.Edges))
	}
}
