package flows

import (
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/nodes"
)

// NewProductFlow 创建产品流程
// 拓扑：需求头脑风暴 -> 方案调研与选型 -> 方案草案输出 -> 方案自主复核(条件)
//       -> PRD初稿生成 -> 原型生成 -> AI复查(条件) -> 需求评审 -> 结束
func NewProductFlow(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("ProductFlow", deps,
		&nodes.ProductRequirementNode{BaseNode: core.NewBaseNode(processobject.StageProductBrainstorm, core.NodeTypeHuman, deps)},
		nodes.NewProductBrainstormNode(deps),
		nodes.NewProductResearchNode(deps),
		nodes.NewProductDraftNode(deps),
		&nodes.ProductReviewNode{BaseNode: core.NewBaseNode(processobject.StageProductReview, core.NodeTypeHuman, deps)},
		nodes.NewProductPRDWriteNode(deps),
		nodes.NewProductProtoMakeNode(deps),
		&nodes.ProductProtoReviewNode{BaseNode: core.NewBaseNode(processobject.StageProductProtoReview, core.NodeTypeAI, deps)},
		&nodes.ProductFinalReviewNode{BaseNode: core.NewBaseNode(processobject.StageProductFinalReview, core.NodeTypeHuman, deps)},
	)
}
