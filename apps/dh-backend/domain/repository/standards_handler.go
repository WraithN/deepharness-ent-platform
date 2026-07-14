package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// 仓库规范文件（AGENTS.md / DESIGN.md）相关常量。
const (
	// agentsMdFileName 是工程规范文件名，由 opencode init 生成。
	agentsMdFileName = "AGENTS.md"
	// designMdFileName 是设计规范文件名，由 agent 按提示词生成。
	designMdFileName = "DESIGN.md"
	// claudeMdFileName 是 claude code /init 的默认产出，生成后需重命名为 AGENTS.md。
	claudeMdFileName = "CLAUDE.md"
	// standardInitTimeout 是智能检测（clone + agent 生成）的整体超时。
	standardInitTimeout = 10 * time.Minute
	// clonePollInterval 是等待异步克隆完成的轮询间隔。
	clonePollInterval = 2 * time.Second
	// opencodeBin / claudeBin 是本机 agent CLI 可执行文件名。
	opencodeBin = "opencode"
	claudeBin   = "claude"
	// designMdPrompt 指示 agent 分析前端工程并生成设计规范文档，只写文件不输出解释。
	designMdPrompt = "分析当前项目的前端代码（组件结构、样式体系、设计 token 等），在项目根目录生成 DESIGN.md 设计规范文档（Markdown 格式，包含色彩、字体、间距、组件规范等可直接落地的条目）。只写入 DESIGN.md 文件，不要修改其他文件，不要输出解释。"
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
// 流程：确保克隆 → 检测前端 → agent init 生成 AGENTS.md →（有前端时）提示词生成 DESIGN.md。
// 单个文件生成失败不阻断整体，失败原因写入响应 warnings。
func StandardFilesInit(w http.ResponseWriter, r *http.Request) {
	workspaceID, repoID, ok := parseWorkspaceAndRepo(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, defaultErrorCode, "method not allowed")
		return
	}
	// 确保仓库已克隆到本地（未克隆则触发同步并轮询等待）。
	if err := ensureCloned(workspaceID, repoID); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, defaultErrorCode, err.Error())
		return
	}
	repo, err := defaultService.Get(workspaceID, repoID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get repository")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), standardInitTimeout)
	defer cancel()

	var warnings []string
	if err := runAgentsMdInit(ctx, repo.LocalPath); err != nil {
		log.Printf("[Standards] AGENTS.md init failed for repo %s: %v", repoID, err)
		warnings = append(warnings, "AGENTS.md 生成失败: "+err.Error())
	}
	// 仅当检测到前端代码时才生成设计规范。
	if detectFrontend(repo.LocalPath) {
		if err := runDesignMdGenerate(ctx, repo.LocalPath); err != nil {
			log.Printf("[Standards] DESIGN.md generate failed for repo %s: %v", repoID, err)
			warnings = append(warnings, "DESIGN.md 生成失败: "+err.Error())
		}
	}

	resp := buildStandardFilesResponse(repo)
	resp.Warnings = warnings
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

// ensureCloned 确保仓库已克隆到本地；未克隆时触发异步同步并轮询等待完成。
// 复用现有 Sync（内部异步 clone/pull 并回写 clone_status），轮询复用整体超时预算。
func ensureCloned(workspaceID, repoID string) error {
	repo, err := defaultService.Get(workspaceID, repoID)
	if err != nil {
		return fmt.Errorf("仓库不存在: %w", err)
	}
	if repo.CloneStatus == repository.CloneStatusCloned && repo.LocalPath != "" {
		return nil
	}
	if err := defaultService.Sync(workspaceID, repoID, ""); err != nil {
		return fmt.Errorf("触发仓库克隆失败: %w", err)
	}
	deadline := time.Now().Add(standardInitTimeout)
	for time.Now().Before(deadline) {
		time.Sleep(clonePollInterval)
		repo, err = defaultService.Get(workspaceID, repoID)
		if err != nil {
			return fmt.Errorf("查询克隆状态失败: %w", err)
		}
		if repo.CloneStatus == repository.CloneStatusCloned {
			return nil
		}
		if repo.CloneStatus == repository.CloneStatusFailed {
			return fmt.Errorf("仓库克隆失败: %s", repo.ErrorMessage)
		}
	}
	return fmt.Errorf("仓库克隆超时（%v）", standardInitTimeout)
}

// runAgentsMdInit 优先用 opencode init 生成 AGENTS.md，失败时兜底 claude code /init。
// claude 产出 CLAUDE.md 时会重命名为 AGENTS.md，保持规范文件名统一。
func runAgentsMdInit(ctx context.Context, repoPath string) error {
	if err := execAgent(ctx, repoPath, opencodeBin, "run", "--command", "init"); err == nil {
		if readStandardFile(repoPath, agentsMdFileName) != "" {
			return nil
		}
		log.Printf("[Standards] opencode init succeeded but %s not found, fallback to claude", agentsMdFileName)
	} else {
		log.Printf("[Standards] opencode init failed: %v, fallback to claude", err)
	}
	if err := execAgent(ctx, repoPath, claudeBin, "-p", "/init", "--dangerously-skip-permissions"); err != nil {
		return fmt.Errorf("opencode 与 claude 均不可用: %w", err)
	}
	if readStandardFile(repoPath, agentsMdFileName) != "" {
		return nil
	}
	return renameClaudeMdIfExists(repoPath)
}

// runDesignMdGenerate 通过提示词驱动 agent 生成 DESIGN.md（优先 opencode，claude 兜底）。
func runDesignMdGenerate(ctx context.Context, repoPath string) error {
	if err := execAgent(ctx, repoPath, opencodeBin, "run", designMdPrompt); err == nil {
		if readStandardFile(repoPath, designMdFileName) != "" {
			return nil
		}
		log.Printf("[Standards] opencode design run finished but %s not found, fallback to claude", designMdFileName)
	} else {
		log.Printf("[Standards] opencode design run failed: %v, fallback to claude", err)
	}
	if err := execAgent(ctx, repoPath, claudeBin, "-p", designMdPrompt, "--dangerously-skip-permissions"); err != nil {
		return fmt.Errorf("opencode 与 claude 均不可用: %w", err)
	}
	if readStandardFile(repoPath, designMdFileName) == "" {
		return fmt.Errorf("agent 执行完成但未生成 %s", designMdFileName)
	}
	return nil
}

// execAgent 在仓库目录下执行 agent CLI 命令，检查可执行文件存在后运行并收集输出。
func execAgent(ctx context.Context, repoPath, bin string, args ...string) error {
	if _, err := exec.LookPath(bin); err != nil {
		return fmt.Errorf("%s 未安装", bin)
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = repoPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s 执行失败: %w (%s)", bin, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// renameClaudeMdIfExists 将 claude 产出的 CLAUDE.md 重命名为 AGENTS.md。
func renameClaudeMdIfExists(repoPath string) error {
	claudePath := filepath.Join(repoPath, claudeMdFileName)
	if _, err := os.Stat(claudePath); err != nil {
		return fmt.Errorf("agent 执行完成但未生成 %s", agentsMdFileName)
	}
	if err := os.Rename(claudePath, filepath.Join(repoPath, agentsMdFileName)); err != nil {
		return fmt.Errorf("重命名 %s 失败: %w", claudeMdFileName, err)
	}
	return nil
}
