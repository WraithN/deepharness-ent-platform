package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"gopkg.in/yaml.v3"
)

// 架构库目录/文件名常量（与 arch-repo-analysis skill 的产出结构保持一致）。
// L1=libraries.yaml，L2=modules/<lib>.yaml，介绍页=overviews/<lib>.yaml。
// L3 的 knowledge-graph.json 目录/文件名常量见 go-sdk 的 repository.ArchUnderstandDir/ArchKGFileName。
const (
	archLibrariesFile = "libraries.yaml"
	archModulesDir    = "modules"
	archOverviewsDir  = "overviews"
	archYamlExt       = ".yaml"
)

// ── 响应结构 ──

type archNode struct {
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	Kind         string            `json:"kind"`
	BusinessLine string            `json:"businessLine,omitempty"`
	Meta         map[string]string `json:"meta,omitempty"`
}

type archEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
}

type archView struct {
	Nodes []archNode `json:"nodes"`
	Edges []archEdge `json:"edges"`
}

// archGraphResponse 是 GET /arch/graph 的统一响应（层级查询）。
type archGraphResponse struct {
	Configured bool       `json:"configured"`
	Cloned     bool       `json:"cloned"`
	RepoID     string     `json:"repoId,omitempty"`
	RepoName   string     `json:"repoName,omitempty"`
	DrillLevel string     `json:"drillLevel,omitempty"` // libraries/modules/classes
	Lib        string     `json:"lib,omitempty"`
	Module     string     `json:"module,omitempty"`
	Nodes      []archNode `json:"nodes,omitempty"`
	Edges      []archEdge `json:"edges,omitempty"`
	Warnings   []string   `json:"warnings,omitempty"`
}

// ArchGraph 处理 GET /api/v1/workspaces/{id}/arch/graph。
// 按 level 参数（libraries/modules/classes）返回对应层级的节点与边：
// L1=开发库层（libraries.yaml）、L2=模块层（modules/<lib>.yaml）、
// L3=类视图（开发库 .understand-anything/knowledge-graph.json 按模块路径过滤）。
// 架构合规：文件读取经 stubclient 委托 personal-stub，不直接访问文件系统。
func ArchGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	repo, found, err := findArchRepo(workspaceID)
	if err != nil {
		handler.HandleServiceError(w, err, "workspace not found", "failed to list repositories")
		return
	}
	resp := &archGraphResponse{Configured: found}
	if !found {
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(resp)
		return
	}
	resp.RepoID = repo.ID
	resp.RepoName = repo.Name

	localPath := resolveUserLocalPathStatic(repo, userID)
	resp.Cloned = isArchRepoCloned(r.Context(), repo, localPath)
	if !resp.Cloned {
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(resp)
		return
	}

	// 解析已完成的判定：libraries.yaml 存在且有 parsedAt。
	level := r.URL.Query().Get("level")
	if level == "" {
		level = "libraries"
	}
	resp.DrillLevel = level

	switch level {
	case "libraries":
		data, warnings := loadLibraries(r.Context(), localPath)
		if data == nil {
			// 未解析：前端据此进入 not-parsed 状态
			handler.SetJSONHeader(w)
			json.NewEncoder(w).Encode(resp)
			return
		}
		resp.Nodes = libsToNodes(data.Libraries)
		resp.Edges = libDepsToEdges(data.Dependencies)
		resp.Warnings = warnings
	case "modules":
		libKey := r.URL.Query().Get("lib")
		resp.Lib = libKey
		data, warnings := loadModules(r.Context(), localPath, libKey)
		if data == nil {
			handler.SetJSONHeader(w)
			json.NewEncoder(w).Encode(resp)
			return
		}
		resp.Nodes = modulesToNodes(data.Modules)
		resp.Edges = moduleDepsToEdges(data.Dependencies)
		resp.Warnings = warnings
	case "classes":
		libKey := r.URL.Query().Get("lib")
		moduleKey := r.URL.Query().Get("module")
		resp.Lib = libKey
		resp.Module = moduleKey
		nodes, edges, warnings, err := loadClassesForModule(r.Context(), workspaceID, userID, localPath, libKey, moduleKey)
		if err != nil {
			handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, err.Error())
			return
		}
		resp.Nodes = nodes
		resp.Edges = edges
		resp.Warnings = warnings
	default:
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid level")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// ArchOverviewHandler 处理 GET /arch/overview?lib=<key>。
func ArchOverviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	libKey := r.URL.Query().Get("lib")
	if libKey == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing lib")
		return
	}
	repo, found, err := findArchRepo(workspaceID)
	if err != nil || !found {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "arch repo not found")
		return
	}
	localPath := resolveUserLocalPathStatic(repo, userID)
	ov, err := loadOverview(r.Context(), localPath, libKey)
	if err != nil || ov == nil {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "overview not found")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(ov)
}

// ── 解析触发与状态查询（dev-lib-analysis）──

// archParseSkillPath 是共享目录中 dev-lib-analysis 技能说明的相对路径，
// 解析指令会引导 agent 阅读该技能并按其规范产出。
const archParseSkillPath = "shares/skills/dev-lib-analysis/SKILL.md"

// archParseLockTTL 是解析锁的存活上限。超过该时长仍未完成
// （libraries.yaml 无 parsedAt）即视为死锁，由 status 轮询惰性清理。
// 动机：agent 崩溃或异常退出时没有失败回调清理锁的路径，
// 锁会永久残留导致后续解析请求一直 409。
const archParseLockTTL = 30 * time.Minute

// buildParsePrompt 构造 dev-lib-analysis 技能指令（预填到 agent 会话）。
func buildParsePrompt(archRepoName string) string {
	return "请阅读共享目录 " + archParseSkillPath + " 技能说明，按其规范对 dev-jobs/ 下全部开发库" +
		"（type=dev）进行解析，产出 libraries.yaml、modules/、overviews/ 写入架构库 dev-jobs/" +
		archRepoName + "。"
}

// parseStatusResponse 解析状态响应。
type parseStatusResponse struct {
	Parsing  bool     `json:"parsing"`
	Parsed   bool     `json:"parsed"` // libraries.yaml 存在且有 parsedAt
	Warnings []string `json:"warnings"`
}

// ArchParseSessionCreator 由会话 handler 实现，用于创建并启动一个 agent 会话。
// 实现时在 session handler 上提供 CreateAndRun：创建会话 + 以 prompt 作为首条消息
// 触发 agent run，返回 sessionID（参考 gateway/handler/session.go:Sessions 与 agui_run.go:AgentRun）。
type ArchParseSessionCreator interface {
	CreateAndRun(ctx context.Context, workspaceID, userID, prompt string) (string, error)
}

// archParseSessionCreator 包级注入点，由 server.go 装配时通过 InitArchParseSessionCreator 注入。
var archParseSessionCreator ArchParseSessionCreator

// InitArchParseSessionCreator 注入实现（在 server.go 调用）。
func InitArchParseSessionCreator(c ArchParseSessionCreator) { archParseSessionCreator = c }

// ArchParse 处理 POST /api/v1/workspaces/{id}/arch/parse。
// 触发开发库解析：加锁防重复 + 创建 agent 会话发送 dev-lib-analysis 指令。
func ArchParse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	repo, found, err := findArchRepo(workspaceID)
	if err != nil || !found {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "arch repo not found")
		return
	}
	// 未同步守卫：架构库尚未克隆到用户目录时解析无从谈起，
	// 返回 409 提示先走同步流程（与 ArchGraph 的 cloned 判定同款）。
	localPath := resolveUserLocalPathStatic(repo, userID)
	if !isArchRepoCloned(r.Context(), repo, localPath) {
		handler.WriteJSONError(w, http.StatusConflict, handler.ErrCodeGeneral, "架构库未同步，请先同步")
		return
	}
	// 加锁防重复
	if defaultService.HasParseLock(r.Context(), workspaceID, userID, repo.Name) {
		handler.WriteJSONError(w, http.StatusConflict, handler.ErrCodeGeneral, "解析正在进行中")
		return
	}
	// 防御：未注入会话创建器时返回 500，避免 nil 指针 panic（注入在 Task 6 路由装配时完成）。
	if archParseSessionCreator == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "解析会话创建器未初始化")
		return
	}
	// 创建 agent 会话并发送指令（委托现有会话+agent run 机制）
	sessionID, err := archParseSessionCreator.CreateAndRun(r.Context(), workspaceID, userID, buildParsePrompt(repo.Name))
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "创建解析会话失败: "+err.Error())
		return
	}
	// 写锁（含 sessionID 便于状态查询关联会话）
	if err := defaultService.WriteParseLock(r.Context(), workspaceID, userID, repo.Name, sessionID); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "写入解析锁失败: "+err.Error())
		return
	}
	// 异步清理：会话结束后由 status 轮询检测 parsedAt 后清锁（见 ArchParseStatus）
	handler.SetJSONHeader(w)
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"sessionId": sessionID})
}

// ArchParseStatus 处理 GET /api/v1/workspaces/{id}/arch/parse/status。
// 查询解析状态：锁状态 + libraries.yaml 是否有 parsedAt。
// 若锁存在但 libraries.yaml 已有 parsedAt（agent 已完成），清锁并返回 parsed=true。
func ArchParseStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	repo, found, err := findArchRepo(workspaceID)
	if err != nil || !found {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "arch repo not found")
		return
	}
	localPath := resolveUserLocalPathStatic(repo, userID)
	resp := &parseStatusResponse{}
	data, _ := loadLibraries(r.Context(), localPath)
	if data != nil && data.ParsedAt != "" {
		resp.Parsed = true
		resp.Warnings = data.Warnings
		// agent 已完成，清理残留锁
		if defaultService.HasParseLock(r.Context(), workspaceID, userID, repo.Name) {
			defaultService.DeleteParseLock(r.Context(), workspaceID, userID, repo.Name)
		}
	} else {
		resp.Parsing = defaultService.HasParseLock(r.Context(), workspaceID, userID, repo.Name)
		// TTL 死锁清理：锁存在但已超时（agent 崩溃无失败清理路径），
		// 惰性删锁并返回 parsing=false，避免永久 409。
		if resp.Parsing && isStaleParseLock(r.Context(), workspaceID, userID, repo.Name) {
			log.Printf("[ArchParseStatus] stale parse lock cleared (ttl=%v): ws=%s repo=%s", archParseLockTTL, workspaceID, repo.Name)
			defaultService.DeleteParseLock(r.Context(), workspaceID, userID, repo.Name)
			resp.Parsing = false
		}
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// isStaleParseLock 判定解析锁是否已超时（死锁）。
// 锁内记录了解析启动时间戳（见 service.WriteParseLock），超过 archParseLockTTL 即视为死锁。
// 读取失败（如锁内容损坏、personal-stub 不可用）时不误判，保持 parsing 状态等待下次轮询。
func isStaleParseLock(ctx context.Context, workspaceID, userID, archRepoName string) bool {
	_, startedAt, err := defaultService.ReadParseLock(ctx, workspaceID, userID, archRepoName)
	if err != nil {
		log.Printf("[ArchParseStatus] read parse lock failed: %v", err)
		return false
	}
	return time.Since(startedAt) > archParseLockTTL
}

// loadClassesForModule 解析 lib+module 对应的类视图：
// 先读 modules/<lib>.yaml 取 module 的 path 前缀，再读开发库 knowledge-graph.json 过滤。
func loadClassesForModule(ctx context.Context, workspaceID, userID, archRepoPath, libKey, moduleKey string) ([]archNode, []archEdge, []string, error) {
	md, warnings := loadModules(ctx, archRepoPath, libKey)
	if md == nil {
		return nil, nil, warnings, fmt.Errorf("modules/%s.yaml 不存在", libKey)
	}
	var prefix string
	for _, m := range md.Modules {
		if m.Key == moduleKey {
			prefix = m.Path
			break
		}
	}
	if prefix == "" {
		return nil, nil, warnings, fmt.Errorf("module %s not found in %s", moduleKey, libKey)
	}
	// 定位开发库的 knowledge-graph.json：用户 dev-jobs 目录下 <libKey>/.understand-anything/knowledge-graph.json
	kgPath := resolveDevLibKGPath(ctx, workspaceID, userID, libKey)
	if kgPath == "" {
		return nil, nil, append(warnings, "开发库路径解析失败"), nil
	}
	view, w := loadClassView(ctx, kgPath, prefix)
	if view == nil {
		return nil, nil, append(warnings, w...), nil
	}
	return view.Nodes, view.Edges, append(warnings, w...), nil
}

// resolveDevLibKGPath 定位开发库在用户目录下的 knowledge-graph.json 路径。
// 委托 service 层拼接 dev-jobs/<libKey>/.understand-anything/knowledge-graph.json。
func resolveDevLibKGPath(ctx context.Context, workspaceID, userID, libKey string) string {
	return defaultService.DevLibKGPath(ctx, workspaceID, userID, libKey)
}

// libsToNodes 将开发库列表转换为画布节点。
func libsToNodes(libs []ArchLibrary) []archNode {
	nodes := make([]archNode, 0, len(libs))
	for _, l := range libs {
		nodes = append(nodes, archNode{
			ID: l.Key, Label: l.Name, Kind: "library",
			Meta: map[string]string{"summary": l.Summary, "path": l.Path, "languages": strings.Join(l.Languages, ",")},
		})
	}
	return nodes
}

// libDepsToEdges 将开发库间依赖转换为画布边。
func libDepsToEdges(deps []ArchLibDependency) []archEdge {
	edges := make([]archEdge, 0, len(deps))
	for _, d := range deps {
		edges = append(edges, archEdge{Source: d.From, Target: d.To, Label: d.Kind, Kind: d.Kind})
	}
	return edges
}

// modulesToNodes 将模块列表转换为画布节点。
func modulesToNodes(mods []ArchModule) []archNode {
	nodes := make([]archNode, 0, len(mods))
	for _, m := range mods {
		nodes = append(nodes, archNode{
			ID: m.Key, Label: m.Name, Kind: "module",
			Meta: map[string]string{"summary": m.Summary, "path": m.Path, "fileCount": strconv.Itoa(m.FileCount)},
		})
	}
	return nodes
}

// moduleDepsToEdges 将模块间依赖转换为画布边。
func moduleDepsToEdges(deps []ArchModuleDependency) []archEdge {
	edges := make([]archEdge, 0, len(deps))
	for _, d := range deps {
		edges = append(edges, archEdge{Source: d.From, Target: d.To, Label: d.Kind, Kind: d.Kind})
	}
	return edges
}

// findArchRepo 返回工作空间内第一个架构库（type=arch）。
func findArchRepo(workspaceID string) (repository.Repository, bool, error) {
	repos, err := defaultService.List(workspaceID)
	if err != nil {
		return repository.Repository{}, false, err
	}
	for _, repo := range repos {
		if repo.Type == repository.RepoTypeArch {
			return repo, true, nil
		}
	}
	return repository.Repository{}, false, nil
}

// isArchRepoCloned 判定架构库在当前用户目录下是否已克隆。
func isArchRepoCloned(ctx context.Context, repo repository.Repository, localPath string) bool {
	if localPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	fi, err := sc.FileInfo(ctx, localPath)
	return err == nil && fi.Exists && fi.IsDir
}

// parseYamlFile 解析单个 YAML 文件；失败时记录 warning 并跳过（不阻断整体出图）。
func parseYamlFile[T any](fileName, content string, out *T, warnings *[]string) bool {
	if err := yaml.Unmarshal([]byte(content), out); err != nil {
		log.Printf("[ArchGraph] parse %s failed: %v", fileName, err)
		*warnings = append(*warnings, fileName+" 解析失败，已跳过")
		return false
	}
	return true
}
