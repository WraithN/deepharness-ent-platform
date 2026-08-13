package flows

import (
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/nodes"
)

// NewAutoTestFlow 创建自动化测试流程（旧版完整链路，保留兼容）
// 拓扑: 测试需求接收 -> 测试方案设计 -> 测试方案评审(条件) -> 测试用例生成 -> 用例评审(条件) -> 自动化测试执行 -> 缺陷识别与闭环验证 -> 测试准入评审(条件) -> 测试结束
func NewAutoTestFlow(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("AutoTestFlow", deps,
		&nodes.TestRequirementNode{BaseNode: core.NewBaseNode(processobject.StageTestRequirement, core.NodeTypeHuman, deps)},
		nodes.NewTestPlanDesignNode(deps),
		nodes.NewTestPlanReviewNode(deps),
		nodes.NewTestCaseGenNode(deps),
		nodes.NewTestCaseReviewNode(deps),
		nodes.NewTestAutoExecNode(deps),
		nodes.NewTestDefectVerifyNode(deps),
		nodes.NewTestAdmissionReviewNode(deps),
		&nodes.TestCompleteNode{BaseNode: core.NewBaseNode(processobject.StageTestComplete, core.NodeTypeHuman, deps)},
	)
}

// NewAutoTestAssetFlow 创建测试资产流程
// 拓扑: 测试需求接收 -> 测试方案设计 -> 测试方案评审(条件) -> 测试用例生成 -> 用例评审(条件) -> 测试结束
func NewAutoTestAssetFlow(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("AutoTestAssetFlow", deps,
		&nodes.TestRequirementNode{
			BaseNode:    core.NewBaseNode(processobject.StageTestRequirement, core.NodeTypeHuman, deps),
			ProcessType: processobject.ProcessTypeAutoTestAsset,
		},
		nodes.NewTestPlanDesignNode(deps),
		nodes.NewTestPlanReviewNode(deps),
		nodes.NewTestCaseGenNode(deps),
		nodes.NewTestCaseReviewNode(deps),
		&nodes.TestCompleteNode{BaseNode: core.NewBaseNode(processobject.StageTestComplete, core.NodeTypeHuman, deps)},
	)
}

// NewAutoTestExecutionFlow 创建测试执行流程
// 拓扑: 测试需求接收 -> 自动化测试执行 -> 缺陷识别与闭环验证 -> 测试准入评审(条件) -> 测试结束
func NewAutoTestExecutionFlow(deps *core.FlowDeps) *core.Flow {
	return core.NewFlow("AutoTestExecutionFlow", deps,
		&nodes.TestRequirementNode{
			BaseNode:    core.NewBaseNode(processobject.StageTestRequirement, core.NodeTypeHuman, deps),
			ProcessType: processobject.ProcessTypeAutoTestExecution,
		},
		nodes.NewTestAutoExecNode(deps),
		nodes.NewTestDefectVerifyNode(deps),
		nodes.NewTestAdmissionReviewNode(deps),
		&nodes.TestCompleteNode{BaseNode: core.NewBaseNode(processobject.StageTestComplete, core.NodeTypeHuman, deps)},
	)
}
