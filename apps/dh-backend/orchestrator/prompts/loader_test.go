package prompts

import (
	"strings"
	"testing"
)

func TestRenderProductBrainstorm(t *testing.T) {
	result := BuildProductBrainstormPrompt("测试需求", "这是一个描述", "/workspace")
	if !strings.Contains(result, "/grill-me") {
		t.Error("missing /grill-me command")
	}
	if !strings.Contains(result, "测试需求") {
		t.Error("missing title")
	}
	if !strings.Contains(result, "这是一个描述") {
		t.Error("missing description")
	}
	if !strings.Contains(result, "/workspace/pm-jobs/brainstorm/") {
		t.Error("missing workspace path")
	}
}

func TestRenderProductBrainstormNoDescription(t *testing.T) {
	result := BuildProductBrainstormPrompt("测试需求", "", "/workspace")
	if strings.Contains(result, "描述:") {
		t.Error("should not contain description when empty")
	}
}

func TestRenderDevCode(t *testing.T) {
	result := BuildCodePrompt("标题", "描述", "/ws", "repo-1", "my-app", "doc info", "proto info")
	if !strings.Contains(result, "/code") {
		t.Error("missing /code command")
	}
	if !strings.Contains(result, "/ws/dev-jobs/my-app") {
		t.Error("missing project path")
	}
	if !strings.Contains(result, "doc info") {
		t.Error("missing doc info")
	}
	if !strings.Contains(result, "proto info") {
		t.Error("missing proto info")
	}
}

func TestRenderDevCodeNoProjectName(t *testing.T) {
	result := BuildCodePrompt("标题", "描述", "/ws", "", "", "", "")
	if !strings.Contains(result, "/ws/dev-jobs/") {
		t.Error("missing workspace path")
	}
	if strings.Contains(result, "关联设计产物") {
		t.Error("should not contain design artifacts section when both empty")
	}
}

func TestRenderDevCodeOnlyDoc(t *testing.T) {
	result := BuildCodePrompt("标题", "描述", "/ws", "", "", "doc info only", "")
	if !strings.Contains(result, "doc info only") {
		t.Error("missing doc info")
	}
	if strings.Contains(result, "proto info") {
		t.Error("should not contain proto info")
	}
}

func TestRenderDevOptimize(t *testing.T) {
	result := BuildOptimizePrompt("review report", "")
	if !strings.Contains(result, "review report") {
		t.Error("missing review report")
	}
	if strings.Contains(result, "开发人员优化指示") {
		t.Error("should not contain developer prompt section when empty")
	}
}

func TestRenderDevOptimizeWithPrompt(t *testing.T) {
	result := BuildOptimizePrompt("review report", "fix it now")
	if !strings.Contains(result, "fix it now") {
		t.Error("missing developer prompt")
	}
}

func TestRenderTestPlanDesign(t *testing.T) {
	result := BuildTestPlanDesignPrompt("标题", "描述", "/ws")
	if !strings.Contains(result, "/ws/dev-jobs/") {
		t.Error("missing workspace path")
	}
	if !strings.Contains(result, "标题") {
		t.Error("missing title")
	}
}

func TestRenderProductBreakdown(t *testing.T) {
	result := BuildProductBreakdownPrompt("测试需求", "需求要点内容", "/workspace")
	if !strings.Contains(result, "功能拆解清单") {
		t.Error("missing 功能拆解清单")
	}
	if !strings.Contains(result, "/workspace/pm-jobs/breakdown/") {
		t.Error("missing breakdown workspace path")
	}
	if !strings.Contains(result, "需求要点内容") {
		t.Error("missing brainstorm result")
	}
}

func TestRenderProductAIDraftReview(t *testing.T) {
	result := BuildProductAIDraftReviewPrompt("测试需求", "草案内容", "/workspace")
	if !strings.Contains(result, "pass / reject") {
		t.Error("missing pass/reject decision format")
	}
	if !strings.Contains(result, "草案内容") {
		t.Error("missing draft result")
	}
}

func TestRenderProductAIGateway(t *testing.T) {
	result := BuildProductAIGatewayPrompt("测试需求", "定稿方案内容", "/workspace")
	if !strings.Contains(result, "NEED_PROTO: true") {
		t.Error("missing NEED_PROTO true format")
	}
	if !strings.Contains(result, "NEED_PROTO: false") {
		t.Error("missing NEED_PROTO false format")
	}
	if !strings.Contains(result, "定稿方案内容") {
		t.Error("missing draft result")
	}
}
