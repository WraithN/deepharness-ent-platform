package prompts

// 测试流程 Prompt 生成器
// 模板定义在 test.yaml 中，使用 Render 渲染。

// BuildTestPlanDesignPrompt 构造测试方案设计提示词
func BuildTestPlanDesignPrompt(title, description, workspacePath string) string {
	return Render("test_plan_design", map[string]string{
		"Title":         title,
		"Description":   description,
		"WorkspacePath": workspacePath,
	})
}

// BuildTestCaseGenPrompt 构造测试用例生成提示词
func BuildTestCaseGenPrompt(testPlan, title, workspacePath string) string {
	return Render("test_case_gen", map[string]string{
		"TestPlan":      testPlan,
		"Title":         title,
		"WorkspacePath": workspacePath,
	})
}

// BuildTestAutoExecPrompt 构造自动化测试执行提示词
func BuildTestAutoExecPrompt(workspacePath string) string {
	return Render("test_auto_exec", map[string]string{
		"WorkspacePath": workspacePath,
	})
}

// BuildDefectVerifyPrompt 构造缺陷识别与闭环验证提示词
func BuildDefectVerifyPrompt(execReport, workspacePath string) string {
	return Render("test_defect_verify", map[string]string{
		"ExecReport":    execReport,
		"WorkspacePath": workspacePath,
	})
}
