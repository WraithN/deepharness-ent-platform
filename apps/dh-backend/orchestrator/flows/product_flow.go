package flows

import (
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/nodes"
)

// NewProductFlow 创建产品流程
// 拓扑：需求头脑风暴 -> 需求拆解 -> 方案调研 -> 方案草案 -> AI草案复核(判定) ->
//
//	方案自主复核(人工) -> AI并行决策器(决策) -> [PRD初稿 || 原型生成] 并行 -> 需求设计复核(人工) -> 需求评审(人工) -> 结束
func NewProductFlow(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("ProductFlow", deps,
		// 1. 需求受理（人工，建流程+通知，不暂停）
		&nodes.ProductRequirementNode{BaseNode: core.NewBaseNode(processobject.StageProductBrainstorm, core.NodeTypeHuman, deps)},
		// 2. 需求头脑风暴（数据复用）
		nodes.NewProductBrainstormNode(deps),
		// 3. 需求拆解（AI）
		nodes.NewProductBreakdownNode(deps),
		// 4. 方案调研（AI，输入为功能拆解清单）
		nodes.NewProductResearchNode(deps),
		// 5. 方案草案（AI）
		nodes.NewProductDraftNode(deps),
		// 6. AI 草案复核（人工：AI 生成复核建议，用户通过/拒绝）
		nodes.NewProductAIDraftReviewNode(deps),
		// 7. 方案自主复核（人工，暂停）
		nodes.NewProductReviewNode(deps),
		// 8. AI 并行决策器决策（AI，决定 NeedProto）
		nodes.NewProductAIGatewayNode(deps),
		// 9. 并行分叉：PRD（常驻） || 原型（仅 NeedProto）
		newProductParallelNode(deps),
		// 10. 需求设计复核（人工，暂停）
		nodes.NewProductProtoReviewNode(deps),
		// 11. 需求评审（人工，暂停，结束）
		nodes.NewProductFinalReviewNode(deps),
	)
}

// StageProductParallelFork 是产品流程并行分叉节点的名称（PRD 与原型并行生成）。
// 并行分支节点（PRD 生成/原型生成）失败重试时需映射回此父节点。
const StageProductParallelFork = "product_parallel_fork"

// newProductParallelNode 构造产品流程的并行分叉节点。
// 分支 A（常驻）：PRD 初稿生成；分支 B（条件）：原型生成，仅当 NeedProto=true 时执行，
// 否则跳过并将 product_proto_make 阶段标记为 Skipped。两路均以定稿方案(DraftResult)为输入。
func newProductParallelNode(deps *core.FlowDeps) *core.ParallelNode {
	return &core.ParallelNode{
		BaseNode: core.NewBaseNode(StageProductParallelFork, core.NodeTypeAI, deps),
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
