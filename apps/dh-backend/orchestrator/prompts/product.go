package prompts

// 产品流程 Prompt 生成器
// 模板定义在 product.yaml 中，使用 Render 渲染。
// 统一输出到 {workspacePath}/pm-jobs/ 下，与前端 slash 指令目录保持一致。

// BuildProductBrainstormPrompt 需求头脑风暴
func BuildProductBrainstormPrompt(title, description, workspacePath string) string {
	return Render("product_brainstorm", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
	})
}

// BuildProductResearchPrompt 方案调研与选型
func BuildProductResearchPrompt(title, description, workspacePath string) string {
	return Render("product_research", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
	})
}

// BuildProductDraftPrompt 方案草案输出
func BuildProductDraftPrompt(title, researchResult, workspacePath string) string {
	return Render("product_draft", map[string]string{
		"Title":         title,
		"ResearchResult": researchResult,
		"WorkspacePath":  workspacePath,
	})
}

// BuildProductPRDWritePrompt PRD初稿生成
func BuildProductPRDWritePrompt(title, draftResult, workspacePath string) string {
	return Render("product_prd_write", map[string]string{
		"Title":         title,
		"DraftResult":   draftResult,
		"WorkspacePath": workspacePath,
	})
}

// BuildProductProtoMakePrompt 原型生成
func BuildProductProtoMakePrompt(title, prdResult, workspacePath string) string {
	return Render("product_proto_make", map[string]string{
		"Title":         title,
		"PRDResult":     prdResult,
		"WorkspacePath": workspacePath,
	})
}

// BuildProductProtoReviewPrompt AI复查（原型交互一致性与需求覆盖度）
func BuildProductProtoReviewPrompt(title, protoResult, prdResult, workspacePath string) string {
	return Render("product_proto_review", map[string]string{
		"Title":         title,
		"ProtoResult":   protoResult,
		"PRDResult":     prdResult,
		"WorkspacePath": workspacePath,
	})
}
