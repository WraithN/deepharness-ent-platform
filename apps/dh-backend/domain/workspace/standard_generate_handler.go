package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

// 规范智能生成相关常量。
const (
	// standardKindCoding 表示编码规范。
	standardKindCoding = "coding"
	// standardKindDesign 表示设计规范。
	standardKindDesign = "design"
	// standardGenerateMaxPromptLen 限制用户描述的最大长度，防止超长输入导致 LLM 调用超时或费用失控。
	standardGenerateMaxPromptLen = 2000
)

// standardGenerateSystemPrompts 按规范类型预置系统提示词。
// 约束模型只输出 Markdown 正文，避免寒暄或解释性文字污染规范文档。
var standardGenerateSystemPrompts = map[string]string{
	standardKindCoding: "你是资深的技术负责人，擅长制定团队编码规范。请根据用户的描述生成一份 Markdown 格式的编码规范文档，结构清晰、条目可落地执行。只输出 Markdown 正文，不要输出任何解释或寒暄。",
	standardKindDesign: "你是资深的设计负责人，擅长制定产品设计规范。请根据用户的描述生成一份 Markdown 格式的设计规范文档，结构清晰、条目可落地执行。只输出 Markdown 正文，不要输出任何解释或寒暄。",
}

// standardCompleter 是同步短文本补全能力（由 agent 运行时客户端注入）。
// 使用函数注入避免 workspace 包反向依赖 agent client 的具体实现。
type standardCompleter func(ctx context.Context, prompt string) (string, error)

// defaultStandardCompleter 智能生成规范的补全函数，nil 表示 agent 运行时未接入。
var defaultStandardCompleter standardCompleter

// InitStandardCompleter 注入智能生成规范的补全能力（通常为 AGUIHandler.QuickComplete）。
func InitStandardCompleter(fn standardCompleter) {
	defaultStandardCompleter = fn
}

// standardGenerateRequest 是智能生成规范的请求体。
type standardGenerateRequest struct {
	// Kind 规范类型：coding（编码规范）或 design（设计规范）。
	Kind string `json:"kind"`
	// Prompt 用户对规范的文字描述。
	Prompt string `json:"prompt"`
}

// StandardGenerate 处理 POST /api/v1/workspaces/{id}/standards/generate。
// 根据用户描述调用默认 agent 生成 Markdown 规范文档，返回 {content}，不落库（由前端填充编辑器后用户确认保存）。
func StandardGenerate(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	// 规范属于空间级管理配置，复用提示词的管理权限判定（租户/超管或 space_admin）。
	if !canManageSpacePrompts(r, workspaceID) {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "permission denied")
		return
	}
	if defaultStandardCompleter == nil {
		handler.WriteJSONError(w, http.StatusServiceUnavailable, 3, "智能生成服务未启用")
		return
	}
	var req standardGenerateRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	systemPrompt, ok := standardGenerateSystemPrompts[req.Kind]
	if !ok {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "kind must be coding or design")
		return
	}
	userPrompt := strings.TrimSpace(req.Prompt)
	if userPrompt == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "prompt is required")
		return
	}
	if len(userPrompt) > standardGenerateMaxPromptLen {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, fmt.Sprintf("prompt exceeds %d characters", standardGenerateMaxPromptLen))
		return
	}
	// QuickComplete 只接受单条 prompt，将系统角色约束拼接到用户描述之前。
	fullPrompt := systemPrompt + "\n\n用户描述：\n" + userPrompt
	content, err := defaultStandardCompleter(r.Context(), fullPrompt)
	if err != nil {
		handler.WriteJSONError(w, http.StatusServiceUnavailable, 3, "智能生成服务暂不可用: "+err.Error())
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{"content": content})
}
