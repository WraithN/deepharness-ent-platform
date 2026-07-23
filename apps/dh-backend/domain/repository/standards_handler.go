package repository

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// 仓库规范文件（AGENTS.md / DESIGN.md）相关常量。
const (
	agentsMdFileName = "AGENTS.md"
	designMdFileName = "DESIGN.md"
)

// frontendDeps 是判定项目是否包含前端代码的依赖白名单。
var frontendDeps = []string{"react", "react-dom", "vue", "@angular/core", "svelte", "next", "nuxt"}

// standardFilesResponse 是仓库规范文件状态与内容的统一响应结构。
type standardFilesResponse struct {
	Cloned      bool     `json:"cloned"`
	HasFrontend bool     `json:"hasFrontend"`
	HasAgentsMd bool     `json:"hasAgentsMd"`
	HasDesignMd bool     `json:"hasDesignMd"`
	AgentsMd    string   `json:"agentsMd,omitempty"`
	DesignMd    string   `json:"designMd,omitempty"`
	Warnings    []string `json:"warnings,omitempty"`
}

// StandardFiles 处理 GET /api/v1/workspaces/{id}/repositories/{repoId}/standard-files。
// 只读：读取仓库本地目录中的 AGENTS.md / DESIGN.md，返回状态与内容。
func StandardFiles(w http.ResponseWriter, r *http.Request) {
	workspaceID, repoID, ok := parseWorkspaceAndRepo(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, defaultErrorCode, "method not allowed")
		return
	}
	repo, err := defaultService.Get(workspaceID, repoID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get repository")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(buildStandardFilesResponse(repo))
}

// StandardFilesInit 处理 POST /api/v1/workspaces/{id}/repositories/{repoId}/standard-files/init。
// 架构合规：不再直接执行 agent CLI，返回提示供前端通过聊天会话（/code 指令）下发。
// agent 在 gatewayd 容器中执行 init / 生成 DESIGN.md，文件写入共享目录。
func StandardFilesInit(w http.ResponseWriter, r *http.Request) {
	workspaceID, repoID, ok := parseWorkspaceAndRepo(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, defaultErrorCode, "method not allowed")
		return
	}
	repo, err := defaultService.Get(workspaceID, repoID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get repository")
		return
	}
	resp := buildStandardFilesResponse(repo)
	resp.Warnings = []string{
		"标准文件初始化已迁移到聊天会话：请通过 /code 指令让 agent 生成 AGENTS.md 和 DESIGN.md",
		"agent 在 gatewayd 容器中执行，文件写入共享目录后本接口可读取",
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// parseWorkspaceAndRepo 从路径中提取 workspaceID 与 repoID。
func parseWorkspaceAndRepo(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return "", "", false
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return "", "", false
	}
	return workspaceID, repoID, true
}

// buildStandardFilesResponse 读取仓库本地目录中的规范文件，组装状态响应。
func buildStandardFilesResponse(repo repository.Repository) *standardFilesResponse {
	resp := &standardFilesResponse{}
	if repo.LocalPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return resp
	}
	if info, err := os.Stat(repo.LocalPath); err != nil || !info.IsDir() {
		return resp
	}
	resp.Cloned = true
	resp.HasFrontend = detectFrontend(repo.LocalPath)
	resp.AgentsMd = readStandardFile(repo.LocalPath, agentsMdFileName)
	resp.DesignMd = readStandardFile(repo.LocalPath, designMdFileName)
	resp.HasAgentsMd = resp.AgentsMd != ""
	resp.HasDesignMd = resp.DesignMd != ""
	return resp
}

// readStandardFile 读取仓库根目录下的规范文件，不存在时返回空字符串。
func readStandardFile(repoPath, name string) string {
	data, err := os.ReadFile(filepath.Join(repoPath, name))
	if err != nil {
		return ""
	}
	return string(data)
}

// detectFrontend 启发式判定项目是否包含前端代码：
// 根目录 package.json 命中前端依赖白名单，或根目录存在 index.html。
func detectFrontend(repoPath string) bool {
	if hasFrontendDeps(repoPath) {
		return true
	}
	if _, err := os.Stat(filepath.Join(repoPath, "index.html")); err == nil {
		return true
	}
	return false
}

// hasFrontendDeps 解析根目录 package.json，检查 dependencies/devDependencies 是否命中前端白名单。
func hasFrontendDeps(repoPath string) bool {
	data, err := os.ReadFile(filepath.Join(repoPath, "package.json"))
	if err != nil {
		return false
	}
	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}
	for _, dep := range frontendDeps {
		if _, ok := pkg.Dependencies[dep]; ok {
			return true
		}
		if _, ok := pkg.DevDependencies[dep]; ok {
			return true
		}
	}
	return false
}
