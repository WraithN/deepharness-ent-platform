package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// ──────────────── 常量 ────────────────

const (
	// gitInitCommitMessage 是新工程初始化 git 仓库时的提交消息。
	gitInitCommitMessage = "Initial commit by DeepHarness AI"
	// gitSyncCommitMessage 是同步工程到仓库时的默认提交消息。
	gitSyncCommitMessage = "Sync project by DeepHarness AI"
	// maxDiffOutputLen 限制 diff 输出最大长度，防止超大 diff 导致响应过大。
	maxDiffOutputLen = 512 * 1024 // 512KB
)

// ──────────────── 类型定义 ────────────────

// ProjectFileNode 工程文件树节点。
type ProjectFileNode struct {
	Name     string             `json:"name"`
	Path     string             `json:"path"`
	Type     string             `json:"type"` // "file" or "folder"
	Children []ProjectFileNode  `json:"children,omitempty"`
}

// ProjectCheckResponse 工程检查响应。
type ProjectCheckResponse struct {
	IsNew      bool   `json:"isNew"`
	HasDiff    bool   `json:"hasDiff"`
	FileCount  int    `json:"fileCount"`
	DirSize    int64  `json:"dirSize"`
	ProjectName string `json:"projectName"`
}

// ProjectDiffResponse 工程 diff 响应。
type ProjectDiffResponse struct {
	Diff      string `json:"diff"`
	HasChanges bool   `json:"hasChanges"`
}

// ProjectSyncRequest 同步工程请求。
type ProjectSyncRequest struct {
	Path        string `json:"path"`
	WorkspaceID string `json:"workspaceId"`
	CommitMsg   string `json:"commitMsg,omitempty"`
}

// ──────────────── 路径校验 ────────────────

// resolveProjectPath 从请求中解析工程路径，校验安全性并确认是目录。
func resolveProjectPath(r *http.Request) (string, int, string) {
	path := r.URL.Query().Get("path")
	if path == "" {
		return "", http.StatusBadRequest, "path is required"
	}

	absPath := filepath.Clean(path)
	if !filepath.IsAbs(absPath) {
		absPath = filepath.Join(getFilesRoot(), absPath)
	}

	if !isPathAllowed(absPath) {
		return "", http.StatusForbidden, "path outside allowed root"
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", http.StatusNotFound, "project directory not found"
		}
		return "", http.StatusInternalServerError, "failed to stat project directory"
	}
	if !info.IsDir() {
		return "", http.StatusBadRequest, "path is not a directory"
	}

	return absPath, 0, ""
}

// getFilesRoot 安全获取 filesRoot。
func getFilesRoot() string {
	if filesRoot != "" {
		return filesRoot
	}
	return "."
}

// ──────────────── Git 操作 ────────────────

// projectGitExec 在指定目录下执行 git 命令。
func projectGitExec(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s failed: %w (output: %s)", strings.Join(args, " "), err, string(out))
	}
	return string(out), nil
}

// hasGitRepo 检查目录是否已初始化为 git 仓库。
func hasGitRepo(dir string) bool {
	gitDir := filepath.Join(dir, ".git")
	info, err := os.Stat(gitDir)
	return err == nil && info.IsDir()
}

// hasUncommittedChanges 检查 git 仓库是否有未提交的更改。
func hasUncommittedChanges(dir string) (bool, error) {
	status, err := projectGitExec(dir, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(status) != "", nil
}

// initGitRepo 在工程目录中初始化 git 仓库并提交所有文件作为基线。
func initGitRepo(dir string) error {
	if _, err := projectGitExec(dir, "init"); err != nil {
		return fmt.Errorf("git init failed: %w", err)
	}
	if _, err := projectGitExec(dir, "add", "."); err != nil {
		return fmt.Errorf("git add failed: %w", err)
	}
	if _, err := projectGitExec(dir, "commit", "-m", gitInitCommitMessage); err != nil {
		// 空仓库提交可能失败，忽略
		log.Printf("[Projects] initial commit skipped (possibly empty repo): %v", err)
	}
	return nil
}

// commitAllChanges 提交工程目录中的所有更改。
func commitAllChanges(dir, message string) error {
	msg := message
	if msg == "" {
		msg = gitSyncCommitMessage
	}
	if _, err := projectGitExec(dir, "add", "."); err != nil {
		return fmt.Errorf("git add failed: %w", err)
	}
	if _, err := projectGitExec(dir, "commit", "-m", msg); err != nil {
		if strings.Contains(err.Error(), "nothing to commit") {
			return nil
		}
		return fmt.Errorf("git commit failed: %w", err)
	}
	return nil
}

// ──────────────── 文件树构建 ────────────────

// loadProjectGitignorePatterns 读取工程目录下的 .gitignore 文件并返回模式列表。
func loadProjectGitignorePatterns(projectRoot string) []string {
	var patterns []string
	gitignorePath := filepath.Join(projectRoot, ".gitignore")
	data, err := os.ReadFile(gitignorePath)
	if err != nil {
		return patterns
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}
	return patterns
}

// isProjectPathIgnored 检查路径是否匹配 .gitignore 模式（简化版）。
func isProjectPathIgnored(path string, patterns []string) bool {
	for _, pattern := range patterns {
		matched, _ := filepath.Match(pattern, filepath.Base(path))
		if matched {
			return true
		}
		matched, _ = filepath.Match(pattern, path)
		if matched {
			return true
		}
		if strings.HasSuffix(pattern, "/") && strings.HasPrefix(path, strings.TrimSuffix(pattern, "/")) {
			return true
		}
	}
	return false
}

// buildProjectTree 递归构建工程文件树。
func buildProjectTree(rootDir string) ([]ProjectFileNode, error) {
	ignorePatterns := loadProjectGitignorePatterns(rootDir)

	type pathInfo struct {
		path  string
		isDir bool
	}
	var paths []pathInfo

	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if path == rootDir {
			return nil
		}
		relPath, _ := filepath.Rel(rootDir, path)
		isGitDir := relPath == ".git" || strings.HasPrefix(relPath, ".git"+string(filepath.Separator))
		if isGitDir || isProjectPathIgnored(relPath, ignorePatterns) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		paths = append(paths, pathInfo{path: relPath, isDir: info.IsDir()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to walk project directory: %w", err)
	}

	// 用 map 构建树结构
	type node struct {
		Name     string
		Path     string
		Type     string
		Children []*node
	}
	rootMap := make(map[string]*node)
	var roots []*node

	for _, p := range paths {
		parts := strings.Split(p.path, string(filepath.Separator))
		currentPath := ""
		var parent *node
		for i, part := range parts {
			currentPath = filepath.Join(currentPath, part)
			isLeaf := i == len(parts)-1

			if existing, ok := rootMap[currentPath]; ok {
				parent = existing
				continue
			}

			n := &node{Name: part, Path: currentPath, Type: "folder"}
			if isLeaf && !p.isDir {
				n.Type = "file"
			}
			rootMap[currentPath] = n

			if parent == nil {
				roots = append(roots, n)
			} else {
				parent.Children = append(parent.Children, n)
			}
			parent = n
		}
	}

	// 递归转换为 ProjectFileNode
	var convert func(*node) ProjectFileNode
	convert = func(n *node) ProjectFileNode {
		children := make([]ProjectFileNode, len(n.Children))
		for i, c := range n.Children {
			children[i] = convert(c)
		}
		return ProjectFileNode{
			Name:     n.Name,
			Path:     n.Path,
			Type:     n.Type,
			Children: children,
		}
	}

	result := make([]ProjectFileNode, len(roots))
	for i, r := range roots {
		result[i] = convert(r)
	}
	sortProjectNodes(&result)
	return result, nil
}

// sortProjectNodes 递归排序文件树节点：目录在前、文件在后，同类型按名称排序。
func sortProjectNodes(nodes *[]ProjectFileNode) {
	sort.Slice(*nodes, func(i, j int) bool {
		a, b := (*nodes)[i], (*nodes)[j]
		if a.Type != b.Type {
			return a.Type == "folder"
		}
		return a.Name < b.Name
	})
	for i := range *nodes {
		if len((*nodes)[i].Children) > 0 {
			sortProjectNodes(&(*nodes)[i].Children)
		}
	}
}

// countProjectFiles 统计工程目录中的文件数量（排除 .git）。
func countProjectFiles(rootDir string) (int, int64) {
	count := 0
	var size int64
	filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if path == rootDir {
			return nil
		}
		relPath, _ := filepath.Rel(rootDir, path)
		if relPath == ".git" || strings.HasPrefix(relPath, ".git"+string(filepath.Separator)) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !info.IsDir() {
			count++
			size += info.Size()
		}
		return nil
	})
	return count, size
}

// ──────────────── HTTP Handlers ────────────────

// ProjectTree 获取工程文件树。
// GET /api/v1/projects/tree?path=/abs/path/to/project
func ProjectTree(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := resolveProjectPath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	tree, err := buildProjectTree(absPath)
	if err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "failed to build project tree")
		return
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(tree)
}

// ProjectDiff 获取工程的 git diff。
// GET /api/v1/projects/diff?path=/abs/path/to/project
func ProjectDiff(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := resolveProjectPath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	if !hasGitRepo(absPath) {
		// 没有 git 仓库，返回无 diff
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(ProjectDiffResponse{Diff: "", HasChanges: false})
		return
	}

	// 获取未暂存和已暂存的 diff
	diff, err := projectGitExec(absPath, "diff", "HEAD")
	if err != nil {
		// 可能是没有提交记录，尝试只获取 unstaged diff
		diff, err = projectGitExec(absPath, "diff")
		if err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, "failed to get git diff")
			return
		}
	}

	// 限制 diff 输出大小
	if len(diff) > maxDiffOutputLen {
		diff = diff[:maxDiffOutputLen] + "\n... (diff truncated, too large)"
	}

	hasChanges := strings.TrimSpace(diff) != ""

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(ProjectDiffResponse{Diff: diff, HasChanges: hasChanges})
}

// ProjectCheck 检查工程是否为新建或已有工程。
// 如果是新建工程（无 .git），自动初始化 git 仓库并提交基线。
// GET /api/v1/projects/check?path=/abs/path/to/project
func ProjectCheck(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := resolveProjectPath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	projectName := filepath.Base(absPath)
	fileCount, dirSize := countProjectFiles(absPath)

	isNew := !hasGitRepo(absPath)
	hasDiff := false

	if isNew {
		// 新工程：初始化 git 仓库，提交所有文件作为基线
		if err := initGitRepo(absPath); err != nil {
			log.Printf("[Projects] failed to init git for %s: %v", absPath, err)
		}
	} else {
		// 已有工程：检查是否有未提交的更改
		changed, err := hasUncommittedChanges(absPath)
		if err != nil {
			log.Printf("[Projects] failed to check git status for %s: %v", absPath, err)
		}
		hasDiff = changed
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(ProjectCheckResponse{
		IsNew:       isNew,
		HasDiff:     hasDiff,
		FileCount:   fileCount,
		DirSize:     dirSize,
		ProjectName: projectName,
	})
}

// ProjectSync 同步工程：提交所有更改并初始化 git（如果尚未初始化）。
// POST /api/v1/projects/sync
// Body: {"path": "/abs/path/to/project", "workspaceId": "ws-default", "commitMsg": "optional message"}
func ProjectSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	var req ProjectSyncRequest
	if !DecodeJSONBody(w, r, &req) {
		return
	}
	if req.Path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	absPath := filepath.Clean(req.Path)
	if !filepath.IsAbs(absPath) {
		absPath = filepath.Join(getFilesRoot(), absPath)
	}
	if !isPathAllowed(absPath) {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil || !info.IsDir() {
		WriteJSONError(w, http.StatusNotFound, 1, "project directory not found")
		return
	}

	// 初始化 git（如果尚未初始化）
	if !hasGitRepo(absPath) {
		if err := initGitRepo(absPath); err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, fmt.Sprintf("failed to init git: %v", err))
			return
		}
	}

	// 提交所有更改
	if err := commitAllChanges(absPath, req.CommitMsg); err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, fmt.Sprintf("failed to commit: %v", err))
		return
	}

	// 获取提交后的 HEAD hash
	headHash, err := projectGitExec(absPath, "rev-parse", "HEAD")
	if err != nil {
		headHash = ""
	}

	log.Printf("[Projects] sync success: %s, workspace=%s, commit=%s", absPath, req.WorkspaceID, strings.TrimSpace(headHash))

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"path":        absPath,
		"projectName": filepath.Base(absPath),
		"commitHash":  strings.TrimSpace(headHash),
		"message":     "项目已同步，Git 仓库已更新",
	})
}
