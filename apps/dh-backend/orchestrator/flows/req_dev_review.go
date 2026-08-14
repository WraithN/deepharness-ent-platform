package flows

import (
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/nodes"
)

// NewReqDevAndReviewFlowLoop 创建"需求开发与代码评审"流程
// 拓扑: 需求受理 -> 需求评估(条件: 通过走方案设计, 不通过直接到人工介入) -> 方案设计 ->
// AI方案评估(混合判断: 不通过自动回方案设计, 最多2次, 超限转人工裁决) -> 人工审核(条件) ->
// AI开发 -> AI代码评审(混合判断: 不通过自动回AI开发, 最多2次, 超限转人工裁决) ->
// 人工评审(条件: 不通过回AI开发) -> 人工介入(终态)
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
		&nodes.DevCompleteNode{BaseNode: core.NewBaseNode(processobject.StageDevComplete, core.NodeTypeHuman, deps)},
	)
}
