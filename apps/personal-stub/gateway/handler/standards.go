package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

// 规范文件名常量。
const (
	standardFileAgents  = "AGENTS.md"
	standardFileDesign  = "DESIGN.md"
	standardFileClaude  = "CLAUDE.md"
)

// claudeIncludeTemplate 是 CLAUDE.md 的 @include 模板，
// 让 Claude Code 能通过 @include 语法加载 AGENTS.md 和 DESIGN.md。
const claudeIncludeTemplate = `@include ./AGENTS.md
@include ./DESIGN.md
`

// designHintPrefix 是写入 AGENTS.md 头部的提示，引导 agent 主动阅读 DESIGN.md。
const designHintPrefix = "<!-- 设计规范见同目录 DESIGN.md，进行 UI 相关工作时务必先阅读 -->\n\n"

// standardsSyncRequest POST /api/v1/standards/sync 请求体。
type standardsSyncRequest struct {
	WorkspacePath  string `json:"workspacePath"`
	CodingStandard string `json:"codingStandard"`
	DesignStandard string `json:"designStandard"`
}

// standardsClearRequest POST /api/v1/standards/clear 请求体。
type standardsClearRequest struct {
	WorkspacePath string `json:"workspacePath"`
}

// StandardsSync POST /api/v1/standards/sync
// 将工作空间的 AGENTS.md / DESIGN.md / CLAUDE.md 写入用户工作目录。
// 在会话创建时由 dh-backend 调用，确保 agent 能自动发现并加载规范。
func StandardsSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	var req standardsSyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body: "+err.Error())
		return
	}
	if req.WorkspacePath == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "workspacePath is required")
		return
	}

	if err := validateWorkspacePath(req.WorkspacePath); err != nil {
		WriteJSONError(w, http.StatusForbidden, 1, err.Error())
		return
	}

	dir := filepath.Clean(req.WorkspacePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "create workspace dir failed: "+err.Error())
		return
	}

	files := map[string]string{
		standardFileAgents: designHintPrefix + req.CodingStandard,
		standardFileDesign: req.DesignStandard,
		standardFileClaude: claudeIncludeTemplate,
	}

	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, fmt.Sprintf("write %s failed: %s", name, err.Error()))
			return
		}
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// StandardsClear POST /api/v1/standards/clear
// 删除用户工作目录中的 AGENTS.md / DESIGN.md / CLAUDE.md。
// 在会话结束或容器解绑时调用，防止规范文件残留。
func StandardsClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	var req standardsClearRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body: "+err.Error())
		return
	}
	if req.WorkspacePath == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "workspacePath is required")
		return
	}

	if err := validateWorkspacePath(req.WorkspacePath); err != nil {
		WriteJSONError(w, http.StatusForbidden, 1, err.Error())
		return
	}

	dir := filepath.Clean(req.WorkspacePath)
	for _, name := range []string{standardFileAgents, standardFileDesign, standardFileClaude} {
		path := filepath.Join(dir, name)
		// 文件不存在时忽略错误
		_ = os.Remove(path)
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// validateWorkspacePath 校验路径在 allowedRoots 或 filesRoot 之下，防止路径遍历。
func validateWorkspacePath(path string) error {
	cleaned := filepath.Clean(path)
	for _, root := range allowedRoots {
		if root == "" {
			continue
		}
		cleanRoot := filepath.Clean(root)
		if isPathUnder(cleaned, cleanRoot) {
			return nil
		}
	}
	if filesRoot != "" && isPathUnder(cleaned, filepath.Clean(filesRoot)) {
		return nil
	}
	return fmt.Errorf("workspacePath is outside allowed roots")
}

// isPathUnder 检查 path 是否在 root 目录之下（或等于 root）。
func isPathUnder(path, root string) bool {
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !startsWithDotDot(rel)
}

// startsWithDotDot 检查相对路径是否以 ".." 开头（即逃逸出 root）。
func startsWithDotDot(rel string) bool {
	return len(rel) >= 2 && rel[0] == '.' && rel[1] == '.'
}
