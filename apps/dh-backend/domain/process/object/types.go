package object

import "time"

// 流程阶段名称常量（通用，其他流程可复用）
const (
	StageRequirement    = "requirement"     // 需求受理
	StageRequirementEval = "requirement_eval" // 需求评估
	StageArchDesign     = "arch_design"     // 架构设计
	StageAIEval         = "ai_eval"         // 智能评估
	StageHumanAudit     = "human_audit"     // 人工审核
	StageDevelopment    = "development"     // 需求开发
	StageReview         = "review"          // 智能评审
	StageHumanReview    = "human_review"    // 人工复审
	StageCodeOptimize   = "code_optimize"   // 代码优化
	StageDevComplete    = "dev_complete"    // 开发结束

	// 自动化测试流程阶段
	StageTestRequirement     = "test_requirement"      // 测试需求接收
	StageTestPlanDesign      = "test_plan_design"      // 测试方案设计
	StageTestPlanReview      = "test_plan_review"      // 测试方案评审
	StageTestCaseGen         = "test_case_gen"         // 测试用例生成
	StageTestCaseReview      = "test_case_review"      // 用例评审
	StageTestAutoExec        = "test_auto_exec"        // 自动化测试执行
	StageTestDefectVerify    = "test_defect_verify"    // 缺陷识别与闭环验证
	StageTestAdmissionReview = "test_admission_review" // 测试准入评审
	StageTestComplete        = "test_complete"         // 测试结束

	// 产品流程阶段
	StageProductBrainstorm    = "product_brainstorm"    // 需求头脑风暴
	StageProductBreakdown     = "product_breakdown"     // 需求拆解
	StageProductResearch      = "product_research"      // 方案调研与选型
	StageProductDraft         = "product_draft"         // 方案草案输出
	StageProductAIDraftReview = "product_ai_draft_review" // AI 草案复核
	StageProductReview        = "product_review"        // 方案自主复核
	StageProductAIGateway     = "product_ai_gateway"    // AI 网关（并行分叉）
	StageProductPRDWrite      = "product_prd_write"     // PRD初稿生成
	StageProductProtoMake     = "product_proto_make"    // 原型生成
	StageProductProtoReview   = "product_proto_review"  // 原型交互复核
	StageProductFinalReview   = "product_final_review"  // 需求评审
)

// 流程阶段展示标签
var StageLabels = map[string]string{
	StageRequirement:     "需求受理",
	StageRequirementEval: "需求评估",
	StageArchDesign:      "架构设计",
	StageAIEval:          "智能评估",
	StageHumanAudit:      "人工审核",
	StageDevelopment:     "需求开发",
	StageReview:          "智能评审",
	StageHumanReview:     "人工复审",
	StageCodeOptimize:    "代码优化",
	StageDevComplete:     "开发结束",

	StageTestRequirement:     "测试需求接收",
	StageTestPlanDesign:      "测试方案设计",
	StageTestPlanReview:      "测试方案评审",
	StageTestCaseGen:         "测试用例生成",
	StageTestCaseReview:      "用例评审",
	StageTestAutoExec:        "自动化测试执行",
	StageTestDefectVerify:    "缺陷识别与闭环验证",
	StageTestAdmissionReview: "测试准入评审",
	StageTestComplete:        "测试结束",

	StageProductBrainstorm:    "需求头脑风暴",
	StageProductBreakdown:     "需求拆解",
	StageProductResearch:      "方案调研与选型",
	StageProductDraft:         "方案草案输出",
	StageProductAIDraftReview: "AI 草案复核",
	StageProductReview:        "方案自主复核",
	StageProductAIGateway:     "AI 网关",
	StageProductPRDWrite:      "PRD初稿生成",
	StageProductProtoMake:     "原型生成",
	StageProductProtoReview:   "原型交互复核",
	StageProductFinalReview:   "需求评审",
}

// 阶段状态常量
const (
	StageStatusPending    = "pending"
	StageStatusInProgress = "in_progress"
	StageStatusCompleted  = "completed"
	StageStatusFailed     = "failed"
	StageStatusTerminated = "terminated"
	StageStatusSkipped    = "skipped" // 跳过（条件分支未执行）
)

// 操作者类型常量
const (
	OperatorTypeHuman = "human"
	OperatorTypeAI    = "ai"
)

// 阶段类型常量
const (
	StageTypeAction  = "action"  // 操作节点：输出某个交付物
	StageTypeJudge   = "judge"   // 判断节点：输出通过或不通过
	StageTypeGateway = "gateway" // 网关节点：并行分叉
)

// stageMeta 定义每个阶段的执行主体和节点类型
type stageMeta struct {
	OperatorType string
	StageType    string
}

// StageMetaMap 阶段元数据映射（执行主体 + 节点类型）
var StageMetaMap = map[string]stageMeta{
	StageRequirement:     {OperatorTypeHuman, StageTypeAction},
	StageRequirementEval: {OperatorTypeHuman, StageTypeJudge},
	StageArchDesign:      {OperatorTypeAI, StageTypeAction},
	StageAIEval:          {OperatorTypeAI, StageTypeAction},
	StageHumanAudit:      {OperatorTypeHuman, StageTypeJudge},
	StageDevelopment:     {OperatorTypeAI, StageTypeAction},
	StageReview:          {OperatorTypeAI, StageTypeAction},
	StageHumanReview:     {OperatorTypeHuman, StageTypeJudge},
	StageCodeOptimize:    {OperatorTypeAI, StageTypeAction},
	StageDevComplete:     {OperatorTypeHuman, StageTypeAction},

	StageTestRequirement:     {OperatorTypeHuman, StageTypeAction},
	StageTestPlanDesign:      {OperatorTypeAI, StageTypeAction},
	StageTestPlanReview:      {OperatorTypeHuman, StageTypeJudge},
	StageTestCaseGen:         {OperatorTypeAI, StageTypeAction},
	StageTestCaseReview:      {OperatorTypeHuman, StageTypeJudge},
	StageTestAutoExec:        {OperatorTypeAI, StageTypeAction},
	StageTestDefectVerify:    {OperatorTypeAI, StageTypeAction},
	StageTestAdmissionReview: {OperatorTypeHuman, StageTypeJudge},
	StageTestComplete:        {OperatorTypeHuman, StageTypeAction},

	StageProductBrainstorm:    {OperatorTypeAI, StageTypeAction},
	StageProductBreakdown:     {OperatorTypeAI, StageTypeAction},
	StageProductResearch:      {OperatorTypeAI, StageTypeAction},
	StageProductDraft:         {OperatorTypeAI, StageTypeAction},
	StageProductAIDraftReview: {OperatorTypeAI, StageTypeJudge},
	StageProductReview:        {OperatorTypeHuman, StageTypeJudge},
	StageProductAIGateway:     {OperatorTypeAI, StageTypeGateway},
	StageProductPRDWrite:      {OperatorTypeAI, StageTypeAction},
	StageProductProtoMake:     {OperatorTypeAI, StageTypeAction},
	StageProductProtoReview:   {OperatorTypeHuman, StageTypeJudge},
	StageProductFinalReview:   {OperatorTypeHuman, StageTypeJudge},
}

// AI 角色常量
const (
	AgentRoleDevelopment  = "开发助理"
	AgentRoleReview       = "评审助理"
	AgentRoleCodeOptimize = "优化助理"
	AgentRoleAIEval       = "评估助理"
	AgentRoleProduct      = "产品助理"
)

// 流程类型常量
const (
	ProcessTypeAIDev              = "ai_dev"
	ProcessTypeAutoTest           = "auto_test"
	ProcessTypeAutoTestAsset      = "auto_test_asset"
	ProcessTypeAutoTestExecution  = "auto_test_execution"
	ProcessTypeProduct            = "product"
)

// ProcessStage 流程阶段
type ProcessStage struct {
	Name        string     `json:"name"`
	Label       string     `json:"label"`
	Status      string     `json:"status"`
	StageType   string     `json:"stageType,omitempty"` // action / judge
	SessionID   string     `json:"sessionId,omitempty"`
	Prompt      string     `json:"prompt,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
	// 操作者信息
	OperatorType string `json:"operatorType,omitempty"` // human / ai
	OperatorName string `json:"operatorName,omitempty"` // 操作者显示名称
	OperatorID   string `json:"operatorId,omitempty"`   // 操作者 ID（人类为用户 ID，AI 为空）
	AgentRole    string `json:"agentRole,omitempty"`    // AI 角色（开发助理/评审助理）
	// 阶段输入/产出描述
	InputDesc      string `json:"inputDesc,omitempty"`      // 上一步交付物描述
	ExtraInputDesc string `json:"extraInputDesc,omitempty"` // 额外输入描述（如用户提示词、优化指示）
	ExtraInput     string `json:"extraInput,omitempty"`     // 额外输入内容
	OutputDesc     string `json:"outputDesc,omitempty"`     // 阶段交付物描述
}

// Process 流程实体
type Process struct {
	ID            string         `json:"id"`
	WorkspaceID   string         `json:"workspaceId"`
	WorkitemID    string         `json:"workitemId"`
	Title         string         `json:"title"`
	SourceDocPath string         `json:"sourceDocPath,omitempty"`
	Type          string         `json:"type"`
	Stages        []ProcessStage `json:"stages"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}

// CreateProcessRequest 创建流程请求
type CreateProcessRequest struct {
	WorkspaceID   string         `json:"workspaceId"`
	WorkitemID    string         `json:"workitemId"`
	Title         string         `json:"title"`
	SourceDocPath string         `json:"sourceDocPath,omitempty"`
	Type          string         `json:"type"`
	Stages        []ProcessStage `json:"stages"`
}

// UpdateStageRequest 更新阶段状态请求
type UpdateStageRequest struct {
	Status       string `json:"status"`
	SessionID    string `json:"sessionId,omitempty"`
	Prompt       string `json:"prompt,omitempty"`
	Error        string `json:"error,omitempty"`
	OperatorType string `json:"operatorType,omitempty"`
	OperatorName string `json:"operatorName,omitempty"`
	OperatorID   string `json:"operatorId,omitempty"`
	AgentRole    string `json:"agentRole,omitempty"`
	InputDesc      string `json:"inputDesc,omitempty"`
	ExtraInputDesc string `json:"extraInputDesc,omitempty"`
	ExtraInput     string `json:"extraInput,omitempty"`
	OutputDesc     string `json:"outputDesc,omitempty"`
}

// NewAIDevProcess 创建 AI 开发流程（含预定义阶段）
func NewAIDevProcess(workspaceID, workitemID, title string) *Process {
	now := time.Now()
	stages := make([]ProcessStage, 0, 10)
	for _, name := range []string{StageRequirement, StageRequirementEval, StageArchDesign, StageAIEval, StageHumanAudit, StageDevelopment, StageReview, StageHumanReview, StageCodeOptimize, StageDevComplete} {
		meta := StageMetaMap[name]
		stages = append(stages, ProcessStage{
			Name:         name,
			Label:        StageLabels[name],
			Status:       StageStatusPending,
			StageType:    meta.StageType,
			OperatorType: meta.OperatorType,
		})
	}
	return &Process{
		ID:          "",
		WorkspaceID: workspaceID,
		WorkitemID:  workitemID,
		Title:       title,
		Type:        ProcessTypeAIDev,
		Stages:      stages,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// NewAutoTestProcess 创建自动化测试流程（含预定义阶段）
func NewAutoTestProcess(workspaceID, workitemID, title string) *Process {
	now := time.Now()
	testStages := []string{
		StageTestRequirement, StageTestPlanDesign, StageTestPlanReview,
		StageTestCaseGen, StageTestCaseReview, StageTestAutoExec,
		StageTestDefectVerify, StageTestAdmissionReview, StageTestComplete,
	}
	stages := make([]ProcessStage, 0, len(testStages))
	for _, name := range testStages {
		meta := StageMetaMap[name]
		stages = append(stages, ProcessStage{
			Name:         name,
			Label:        StageLabels[name],
			Status:       StageStatusPending,
			StageType:    meta.StageType,
			OperatorType: meta.OperatorType,
		})
	}
	return &Process{
		ID:          "",
		WorkspaceID: workspaceID,
		WorkitemID:  workitemID,
		Title:       title,
		Type:        ProcessTypeAutoTest,
		Stages:      stages,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// NewAutoTestAssetProcess 创建测试资产流程（测试需求 -> 测试计划 -> 用例 -> 评审）
func NewAutoTestAssetProcess(workspaceID, workitemID, title string) *Process {
	now := time.Now()
	testStages := []string{
		StageTestRequirement, StageTestPlanDesign, StageTestPlanReview,
		StageTestCaseGen, StageTestCaseReview, StageTestComplete,
	}
	stages := make([]ProcessStage, 0, len(testStages))
	for _, name := range testStages {
		meta := StageMetaMap[name]
		stages = append(stages, ProcessStage{
			Name:         name,
			Label:        StageLabels[name],
			Status:       StageStatusPending,
			StageType:    meta.StageType,
			OperatorType: meta.OperatorType,
		})
	}
	return &Process{
		ID:          "",
		WorkspaceID: workspaceID,
		WorkitemID:  workitemID,
		Title:       title,
		Type:        ProcessTypeAutoTestAsset,
		Stages:      stages,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// NewAutoTestExecutionProcess 创建测试执行流程（测试需求 -> 自动化执行 -> 缺陷验证 -> 准入评审）
func NewAutoTestExecutionProcess(workspaceID, workitemID, title string) *Process {
	now := time.Now()
	testStages := []string{
		StageTestRequirement, StageTestAutoExec,
		StageTestDefectVerify, StageTestAdmissionReview, StageTestComplete,
	}
	stages := make([]ProcessStage, 0, len(testStages))
	for _, name := range testStages {
		meta := StageMetaMap[name]
		stages = append(stages, ProcessStage{
			Name:         name,
			Label:        StageLabels[name],
			Status:       StageStatusPending,
			StageType:    meta.StageType,
			OperatorType: meta.OperatorType,
		})
	}
	return &Process{
		ID:          "",
		WorkspaceID: workspaceID,
		WorkitemID:  workitemID,
		Title:       title,
		Type:        ProcessTypeAutoTestExecution,
		Stages:      stages,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// NewProductProcess 创建产品流程（含预定义阶段）
func NewProductProcess(workspaceID, workitemID, title, docPath string) *Process {
	now := time.Now()
	productStages := []string{
		StageProductBrainstorm, StageProductBreakdown, StageProductResearch,
		StageProductDraft, StageProductAIDraftReview, StageProductReview,
		StageProductAIGateway, StageProductPRDWrite, StageProductProtoMake,
		StageProductProtoReview, StageProductFinalReview,
	}
	stages := make([]ProcessStage, 0, len(productStages))
	for _, name := range productStages {
		meta := StageMetaMap[name]
		stages = append(stages, ProcessStage{
			Name:         name,
			Label:        StageLabels[name],
			Status:       StageStatusPending,
			StageType:    meta.StageType,
			OperatorType: meta.OperatorType,
		})
	}
	return &Process{
		ID:            "",
		WorkspaceID:   workspaceID,
		WorkitemID:    workitemID,
		Title:         title,
		SourceDocPath: docPath,
		Type:          ProcessTypeProduct,
		Stages:        stages,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
}
