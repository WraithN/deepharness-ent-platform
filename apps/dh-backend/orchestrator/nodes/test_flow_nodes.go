package nodes

import (
	"fmt"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// ============================================================
// 测试需求接收（人工 ACTION 节点）
// ============================================================

type TestRequirementNode struct {
	core.BaseNode
	// ProcessType 指定该节点创建何种类型的测试流程；为空时保持旧版 auto_test 兼容。
	ProcessType string
}

func (n *TestRequirementNode) Input(fc *core.FlowContext) error {
	var proc *processobject.Process
	switch n.ProcessType {
	case processobject.ProcessTypeAutoTestAsset:
		proc = processobject.NewAutoTestAssetProcess(fc.WorkspaceID, fc.WorkitemID, fc.WorkitemTitle)
	case processobject.ProcessTypeAutoTestExecution:
		proc = processobject.NewAutoTestExecutionProcess(fc.WorkspaceID, fc.WorkitemID, fc.WorkitemTitle)
	default:
		proc = processobject.NewAutoTestProcess(fc.WorkspaceID, fc.WorkitemID, fc.WorkitemTitle)
	}
	created := fc.CreateProcess(proc)
	fc.ProcessID = created.ID
	return nil
}

func (n *TestRequirementNode) Processor(fc *core.FlowContext) error {
	return nil
}

func (n *TestRequirementNode) Output(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestRequirement, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		OutputDesc:   fmt.Sprintf("接收测试需求「%s」", fc.WorkitemTitle),
	})
	return nil
}

// ============================================================
// 测试方案设计（AI ACTION 节点）
// ============================================================

func NewTestPlanDesignNode(deps *core.FlowDeps) *TestPlanDesignNode {
	return &TestPlanDesignNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageTestPlanDesign, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildTestPlanDesignPrompt(fc.WorkitemTitle, fc.WorkitemDesc, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[测试方案]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.TestPlanResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageTestPlanDesign, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "测试方案文档",
					Prompt:     fc.TestPlanResult,
				})
				return nil
			},
		},
	}
}

type TestPlanDesignNode struct {
	CodeWriteNode
}

func (n *TestPlanDesignNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestPlanDesign, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleAIEval,
		InputDesc:    "测试需求",
		OutputDesc:   "测试方案文档",
	})
	return nil
}

// ============================================================
// 测试方案评审（人工 JUDGE 节点）
// ============================================================

// NewTestPlanReviewNode 创建测试方案评审人工节点（条件分支）。
// 迁移为 core.HumanReviewNode：通过进入用例生成，不通过重新设计测试方案。
func NewTestPlanReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageTestPlanReview,
		InputDesc:  "测试方案文档",
		OutputDesc: "待评审测试方案",
		PassDesc:   "评审通过，进入测试用例生成",
		FailDesc:   "评审不通过，需重新设计测试方案",

		NotifType:     notificationobject.TypeTestPlanReviewRequired,
		NotifTitleFmt: "测试方案评审: %s",
		NotifBodyFmt:  "需求「%s」的测试方案已生成，请评审。通过则进入用例生成，不通过将重新设计测试方案。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.TestPlanResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.TestPlanReviewResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"sessionId":      fc.SessionID,
				"threadId":       fc.ThreadID,
				"testPlanResult": fc.TestPlanResult,
			}
		},
		PassNodeName: processobject.StageTestCaseGen,
		FailNodeName: processobject.StageTestPlanDesign,
	})
}

// ============================================================
// 测试用例生成（AI ACTION 节点）
// ============================================================

func NewTestCaseGenNode(deps *core.FlowDeps) *TestCaseGenNode {
	return &TestCaseGenNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageTestCaseGen, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildTestCaseGenPrompt(fc.TestPlanResult, fc.WorkitemTitle, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[用例生成]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.TestCaseResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageTestCaseGen, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "测试用例及自动化脚本",
					Prompt:     fc.TestCaseResult,
				})
				return nil
			},
		},
	}
}

type TestCaseGenNode struct {
	CodeWriteNode
}

func (n *TestCaseGenNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestCaseGen, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleAIEval,
		InputDesc:    "测试方案文档",
		OutputDesc:   "测试用例及自动化脚本",
	})
	return nil
}

// ============================================================
// 用例评审（人工 JUDGE 节点）
// ============================================================

// NewTestCaseReviewNode 创建用例评审人工节点（条件分支）。
// 迁移为 core.HumanReviewNode：通过执行自动化测试，不通过重新生成用例。
func NewTestCaseReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageTestCaseReview,
		InputDesc:  "测试用例及自动化脚本",
		OutputDesc: "待评审测试用例",
		PassDesc:   "评审通过，进入自动化测试执行",
		FailDesc:   "评审不通过，需重新生成测试用例",

		NotifType:     notificationobject.TypeTestCaseReviewRequired,
		NotifTitleFmt: "用例评审: %s",
		NotifBodyFmt:  "需求「%s」的测试用例已生成，请评审。通过则执行自动化测试，不通过将重新生成用例。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.TestCaseResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.TestCaseReviewResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"sessionId":      fc.SessionID,
				"threadId":       fc.ThreadID,
				"testCaseResult": fc.TestCaseResult,
			}
		},
		PassNodeName: processobject.StageTestAutoExec,
		FailNodeName: processobject.StageTestCaseGen,
	})
}

// ============================================================
// 自动化测试执行（AI ACTION 节点）
// ============================================================

func NewTestAutoExecNode(deps *core.FlowDeps) *TestAutoExecNode {
	return &TestAutoExecNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageTestAutoExec, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildTestAutoExecPrompt(fc.WorkspacePath)
			},
			SessionTitlePrefix: "[测试执行]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.TestExecResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageTestAutoExec, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "测试执行报告",
					Prompt:     fc.TestExecResult,
				})
				return nil
			},
		},
	}
}

type TestAutoExecNode struct {
	CodeWriteNode
}

func (n *TestAutoExecNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestAutoExec, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleAIEval,
		InputDesc:    "测试用例及自动化脚本",
		OutputDesc:   "测试执行报告",
	})
	return nil
}

// ============================================================
// 缺陷识别与闭环验证（AI ACTION 节点）
// ============================================================

func NewTestDefectVerifyNode(deps *core.FlowDeps) *TestDefectVerifyNode {
	return &TestDefectVerifyNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageTestDefectVerify, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildDefectVerifyPrompt(fc.TestExecResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[缺陷验证]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.TestDefectResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageTestDefectVerify, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "缺陷分析与修复报告",
					Prompt:     fc.TestDefectResult,
				})
				return nil
			},
		},
	}
}

type TestDefectVerifyNode struct {
	CodeWriteNode
}

func (n *TestDefectVerifyNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestDefectVerify, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleAIEval,
		InputDesc:    "测试执行报告",
		OutputDesc:   "缺陷分析与修复报告",
	})
	return nil
}

// ============================================================
// 测试准入评审（人工 JUDGE 节点）
// ============================================================

// NewTestAdmissionReviewNode 创建测试准入评审人工节点（条件分支）。
// 迁移为 core.HumanReviewNode：通过结束测试，不通过重新执行测试。
func NewTestAdmissionReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageTestAdmissionReview,
		InputDesc:  "缺陷分析与修复报告",
		OutputDesc: "待评审测试准入",
		PassDesc:   "评审通过，测试完成",
		FailDesc:   "评审不通过，需重新执行测试",

		NotifType:     notificationobject.TypeTestAdmissionReviewRequired,
		NotifTitleFmt: "测试准入评审: %s",
		NotifBodyFmt:  "需求「%s」的自动化测试与缺陷修复已完成，请评审。通过则结束测试，不通过将重新执行测试。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.TestDefectResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.TestAdmissionReviewResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"sessionId":        fc.SessionID,
				"threadId":         fc.ThreadID,
				"testDefectResult": fc.TestDefectResult,
				"testExecResult":   fc.TestExecResult,
			}
		},
		PassNodeName: processobject.StageTestComplete,
		FailNodeName: processobject.StageTestAutoExec,
	})
}

// ============================================================
// 测试结束（人工 ACTION 节点）
// ============================================================

type TestCompleteNode struct {
	core.BaseNode
}

func (n *TestCompleteNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestComplete, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "测试准入评审结果",
		OutputDesc:   "测试完成报告",
	})
	return nil
}

func (n *TestCompleteNode) Processor(fc *core.FlowContext) error {
	return nil
}

func (n *TestCompleteNode) Output(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageTestComplete, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		OutputDesc:   "测试流程完成",
	})
	return nil
}
