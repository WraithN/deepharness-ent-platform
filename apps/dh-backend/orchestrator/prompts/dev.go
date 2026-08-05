package prompts

// 研发流程 Prompt 生成器
// 模板定义在 dev.yaml 中，使用 Render 渲染。
// 所有 Build* 函数在 Render 后统一调用 ApplyPromptCommon，
// 自动 prepend CommonPromptRules + append 工作空间规范引用。

// BuildCodePrompt 代码开发
func BuildCodePrompt(title, description, workspacePath, repositoryID, projectName, docInfo, protoInfo string) string {
	rendered := Render("dev_code", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
		"RepositoryID":  repositoryID,
		"ProjectName":   projectName,
		"DocInfo":       docInfo,
		"ProtoInfo":     protoInfo,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildReviewPrompt 代码评审
func BuildReviewPrompt(workspacePath, projectName string) string {
	rendered := Render("dev_review", map[string]string{
		"WorkspacePath": workspacePath,
		"ProjectName":   projectName,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildRequirementEvalPrompt 需求评估
func BuildRequirementEvalPrompt(title, description string) string {
	rendered := Render("dev_requirement_eval", map[string]string{
		"Title":       title,
		"Description": description,
	})
	return ApplyPromptCommon(rendered, "")
}

// BuildArchDesignPrompt 架构设计
func BuildArchDesignPrompt(title, description, workspacePath string) string {
	rendered := Render("dev_arch_design", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
	})
	return ApplyPromptCommon(rendered, workspacePath)
}

// BuildOptimizePrompt 代码优化
func BuildOptimizePrompt(reviewReport, developerPrompt string) string {
	rendered := Render("dev_optimize", map[string]string{
		"ReviewReport":    reviewReport,
		"DeveloperPrompt": developerPrompt,
	})
	return ApplyPromptCommon(rendered, "")
}

// BuildAIEvalPrompt AI 架构评估
func BuildAIEvalPrompt(archDesignResult, workitemTitle, workitemDesc string) string {
	rendered := Render("dev_ai_eval", map[string]string{
		"ArchDesignResult": archDesignResult,
		"WorkitemTitle":    workitemTitle,
		"WorkitemDesc":     workitemDesc,
	})
	return ApplyPromptCommon(rendered, "")
}
