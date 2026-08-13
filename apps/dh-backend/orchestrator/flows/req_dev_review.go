package flows

import (
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/nodes"
)

// NewReqDevAndReviewFlowLoop 创建"需求开发与代码评审"流程
// 拓扑: 需求受理 -> 需求评估(条件) -> [架构设计 -> 智能评估 -> 人工审核 ->] 需求开发 -> 智能评审 -> 人工复审(条件) -> 代码优化 -> Review(循环) / 开发结束
func NewReqDevAndReviewFlowLoop(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("ReqDevAndReviewFlowLoop", deps,
		&nodes.RequirementAskForAcceptNode{BaseNode: core.NewBaseNode(processobject.StageRequirement, core.NodeTypeHuman, deps)},
		nodes.NewRequirementEvalNode(deps),
		nodes.NewArchDesignNode(deps),
		&nodes.AiEvalNode{BaseNode: core.NewBaseNode(processobject.StageAIEval, core.NodeTypeAI, deps)},
		nodes.NewHumanAuditNode(deps),
		nodes.NewDevelopmentNode(deps),
		&nodes.ReviewNode{BaseNode: core.NewBaseNode(processobject.StageReview, core.NodeTypeAI, deps)},
		nodes.NewHumanReviewNode(deps),
		nodes.NewCodeOptimizeNode(deps),
		&nodes.DevCompleteNode{BaseNode: core.NewBaseNode(processobject.StageDevComplete, core.NodeTypeHuman, deps)},
	)
}
