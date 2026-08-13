package prompts

// 产品流程 Prompt 生成器
// 模板定义在 product.yaml 中，使用 Render 渲染。
// 统一输出到 {workspacePath}/pm-jobs/ 下，与前端 slash 指令目录保持一致。
// 所有 Build* 函数在 Render 后统一调用 ApplyPromptCommon，
// 自动 prepend CommonPromptRules + append 工作空间规范引用。

// BuildProductBrainstormPrompt 需求头脑风暴
func BuildProductBrainstormPrompt(title, description, workspacePath string) string {
	rendered := Render("product_brainstorm", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductResearchPrompt 方案调研与选型
func BuildProductResearchPrompt(title, description, workspacePath string) string {
	rendered := Render("product_research", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductDraftPrompt 方案草案输出
func BuildProductDraftPrompt(title, researchResult, workspacePath string) string {
	rendered := Render("product_draft", map[string]string{
		"Title":          title,
		"ResearchResult": researchResult,
		"WorkspacePath":  workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductPRDWritePrompt PRD初稿生成
func BuildProductPRDWritePrompt(title, draftResult, workspacePath string) string {
	rendered := Render("product_prd_write", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductProtoMakePrompt 原型生成
func BuildProductProtoMakePrompt(title, prdResult, workspacePath string) string {
	rendered := Render("product_proto_make", map[string]string{
		"Title":         title,
		"PRDResult":     prdResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductProtoReviewPrompt AI复查（原型交互一致性与需求覆盖度）
func BuildProductProtoReviewPrompt(title, protoResult, prdResult, workspacePath string) string {
	rendered := Render("product_proto_review", map[string]string{
		"Title":         title,
		"ProtoResult":   protoResult,
		"PRDResult":     prdResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductBreakdownPrompt 需求拆解（功能拆解清单与模块关系图）
func BuildProductBreakdownPrompt(title, brainstormResult, workspacePath string) string {
	rendered := Render("product_breakdown", map[string]string{
		"Title":            title,
		"BrainstormResult": brainstormResult,
		"WorkspacePath":    workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductAIDraftReviewPrompt AI 草案复核（输出报告 + pass/reject 决策）
func BuildProductAIDraftReviewPrompt(title, draftResult, workspacePath string) string {
	rendered := Render("product_ai_draft_review", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildProductAIGatewayPrompt AI 网关决策（输出 NEED_PROTO: true/false）
func BuildProductAIGatewayPrompt(title, draftResult, workspacePath string) string {
	rendered := Render("product_ai_gateway", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}
