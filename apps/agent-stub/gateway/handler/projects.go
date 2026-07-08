package handler

import (
	"encoding/json"
	"errors"
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
	// aicodingMarker 是 AI Coding 平台协助生成代码的 Git 提交标记。
	// 所有由本平台触发的 git commit 均会带上该标记，便于在 git 历史中识别 AI 辅助提交。
	aicodingMarker = "[AICoding]"
	// gitInitCommitMessage 是新工程初始化 git 仓库时的提交消息。
	gitInitCommitMessage = "Initial commit by DeepHarness AI " + aicodingMarker
	// gitSyncCommitMessage 是同步工程到仓库时的默认提交消息。
	gitSyncCommitMessage = "Sync project by DeepHarness AI " + aicodingMarker
	// defaultRemoteName 是推送到远程仓库时使用的默认 remote 名称。
	defaultRemoteName = "origin"
	// sshStrictOptions 是 git ssh 命令的安全选项，禁用主机密钥检查（开发环境）。
	sshStrictOptions = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes"
	// maxDiffOutputLen 限制 diff 输出最大长度，防止超大 diff 导致响应过大。
	maxDiffOutputLen = 512 * 1024 // 512KB
	// maxDiffFileSize 限制单个文件 diff 内容的最大字节数，超过则跳过该文件。
	maxDiffFileSize = 256 * 1024 // 256KB
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
	Diff       string           `json:"diff"`
	HasChanges bool             `json:"hasChanges"`
	Files      []FileDiffEntry  `json:"files,omitempty"`
}

// FileDiffEntry 单个文件的 diff 信息（用于 side-by-side 对比视图）。
type FileDiffEntry struct {
	Path       string `json:"path"`
	Status     string `json:"status"` // "modified", "added", "deleted"
	OldContent string `json:"oldContent"`
	NewContent string `json:"newContent"`
}

// ProjectSyncRequest 同步工程请求。
type ProjectSyncRequest struct {
	Path         string `json:"path"`
	WorkspaceID  string `json:"workspaceId"`
	CommitMsg    string `json:"commitMsg,omitempty"`
	RemoteURL    string `json:"remoteUrl,omitempty"`
	RemoteBranch string `json:"remoteBranch,omitempty"`
	SSHKey       string `json:"sshKey,omitempty"`
	RemoteName   string `json:"remoteName,omitempty"`
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

	// 路径不在 allowedRoots 内时，若目录确实存在则动态加入白名单。
	// 这允许 agent 在 workspaceRoot 之外创建的工程也能被访问（开发平台场景）。
	if !isPathAllowed(absPath) {
		if info, err := os.Stat(absPath); err == nil && info.IsDir() {
			AddAllowedRoot(absPath)
		} else {
			return "", http.StatusForbidden, "path outside allowed root"
		}
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
// 提交消息会自动追加 AICoding 平台标记，确保 AI 辅助生成的代码在 git 历史中可识别。
func commitAllChanges(dir, message string) error {
	msg := message
	if msg == "" {
		msg = gitSyncCommitMessage
	}
	if !strings.Contains(msg, aicodingMarker) {
		msg = strings.TrimSpace(msg) + " " + aicodingMarker
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

// isSSHURL 判断 Git URL 是否使用 SSH 协议（支持 ssh:// 与 git@host:path 两种形式）。
func isSSHURL(rawURL string) bool {
	return strings.HasPrefix(rawURL, "ssh://") || (strings.Contains(rawURL, "@") && strings.Contains(rawURL, ":"))
}

// ensureGitRemote 确保本地仓库存在指定名称的 remote，若 URL 不一致则更新。
func ensureGitRemote(dir, remoteName, remoteURL string) error {
	// 先检查该 remote 是否已存在。
	_, err := projectGitExec(dir, "remote", "get-url", remoteName)
	if err != nil {
		// remote 不存在，直接添加。
		if _, err := projectGitExec(dir, "remote", "add", remoteName, remoteURL); err != nil {
			return fmt.Errorf("git remote add failed: %w", err)
		}
		return nil
	}
	// remote 已存在，更新 URL 避免配置变更后不同步。
	if _, err := projectGitExec(dir, "remote", "set-url", remoteName, remoteURL); err != nil {
		return fmt.Errorf("git remote set-url failed: %w", err)
	}
	return nil
}

// currentGitBranch 获取当前仓库所在分支，detached HEAD 或新初始化仓库可能返回空字符串。
func currentGitBranch(dir string) (string, error) {
	out, err := projectGitExec(dir, "branch", "--show-current")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// ensureLocalBranch 确保本地存在并签出目标分支。
// 若当前已在目标分支则跳过；若目标分支已存在则签出；否则将当前分支重命名为目标分支。
func ensureLocalBranch(dir, branch string) error {
	if branch == "" {
		return nil
	}
	current, err := currentGitBranch(dir)
	if err != nil {
		return fmt.Errorf("detect current branch failed: %w", err)
	}
	if current == branch {
		return nil
	}
	// 检查目标分支是否已存在。
	_, err = projectGitExec(dir, "rev-parse", "--verify", branch)
	if err == nil {
		if _, err := projectGitExec(dir, "checkout", branch); err != nil {
			return fmt.Errorf("checkout branch %s failed: %w", branch, err)
		}
		return nil
	}
	// 不存在则重命名当前分支。
	if _, err := projectGitExec(dir, "branch", "-M", branch); err != nil {
		return fmt.Errorf("rename branch to %s failed: %w", branch, err)
	}
	return nil
}

// pushToRemote 将当前分支推送到远程仓库。
// 当提供了 SSH 私钥且远程为 SSH 协议时，会写入临时密钥文件并配置 GIT_SSH_COMMAND。
func pushToRemote(dir, remoteName, remoteURL, branch, sshKey string) error {
	if remoteName == "" {
		remoteName = defaultRemoteName
	}
	if branch == "" {
		return errors.New("branch is required for push")
	}

	cmd := exec.Command("git", "push", "-u", remoteName, branch)
	cmd.Dir = dir

	useSSHKey := sshKey != "" && isSSHURL(remoteURL)
	if useSSHKey {
		keyFile, err := os.CreateTemp("", "git-ssh-key-*.pem")
		if err != nil {
			return fmt.Errorf("create temp ssh key file failed: %w", err)
		}
		keyPath := keyFile.Name()
		// 立即关闭文件句柄，避免 Windows 占用；后续用 WriteFile 重新写入。
		_ = keyFile.Close()
		defer os.Remove(keyPath)

		if err := os.WriteFile(keyPath, []byte(sshKey), 0600); err != nil {
			return fmt.Errorf("write ssh key file failed: %w", err)
		}

		cmd.Env = append(os.Environ(), fmt.Sprintf("GIT_SSH_COMMAND=ssh -i %s %s", keyPath, sshStrictOptions))
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git push failed: %w (output: %s)", err, string(out))
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

// ProjectDiff 获取工程的 git diff，对比当前分支与 master/main 分支的差异。
// 返回 unified diff 文本和按文件拆分的 old/new 内容（用于 side-by-side 视图）。
// GET /api/v1/projects/diff?path=/abs/path/to/project
func ProjectDiff(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := resolveProjectPath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	if !hasGitRepo(absPath) {
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(ProjectDiffResponse{Diff: "", HasChanges: false})
		return
	}

	// 获取默认基准分支（master 或 main），用于对比当前分支的差异。
	baseBranch := detectBaseBranch(absPath)

	var diff string
	if baseBranch != "" {
		// 对比工作区（含未提交修改）与基准分支的差异。
		d, err := projectGitExec(absPath, "diff", baseBranch)
		if err != nil {
			diff, _ = projectGitExec(absPath, "diff", "HEAD")
		} else {
			diff = d
		}
	} else {
		diff, _ = projectGitExec(absPath, "diff", "HEAD")
	}

	// 限制 diff 输出大小
	if len(diff) > maxDiffOutputLen {
		diff = diff[:maxDiffOutputLen] + "\n... (diff truncated, too large)"
	}

	hasChanges := strings.TrimSpace(diff) != ""

	// 获取按文件拆分的 diff 信息（用于 side-by-side 对比视图）。
	fileDiffs := buildFileDiffEntries(absPath, baseBranch, maxDiffFileSize)

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(ProjectDiffResponse{
		Diff:       diff,
		HasChanges: hasChanges,
		Files:      fileDiffs,
	})
}

// buildFileDiffEntries 获取变更文件列表及其 old/new 内容，用于 side-by-side diff 视图。
// 跳过二进制文件和超过 maxDiffFileSize 的文件，避免响应过大。
func buildFileDiffEntries(dir, baseBranch string, maxSize int) []FileDiffEntry {
	if baseBranch == "" {
		return nil
	}

	// 获取变更文件列表（带状态标记）。
	// 格式：M\tfile  /  A\tfile  /  D\tfile
	out, err := projectGitExec(dir, "diff", "--name-status", baseBranch)
	if err != nil {
		return nil
	}

	var entries []FileDiffEntry
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) < 2 {
			continue
		}
		statusCode := parts[0]
		filePath := parts[1]

		// 处理重命名（R100\told\tnew 格式），取新文件路径。
		if strings.HasPrefix(statusCode, "R") {
			renameParts := strings.SplitN(parts[1], "\t", 2)
			if len(renameParts) == 2 {
				filePath = renameParts[1]
			}
		}

		status := mapGitStatus(statusCode)
		entry := FileDiffEntry{Path: filePath, Status: status}

		// 获取旧内容（基准分支版本），新增文件无旧内容。
		if status != "added" {
			old, err := projectGitExec(dir, "show", baseBranch+":"+filePath)
			if err == nil && len(old) <= maxSize {
				entry.OldContent = old
			}
		}

		// 获取新内容（工作区版本），删除文件无新内容。
		if status != "deleted" {
			new, err := os.ReadFile(filepath.Join(dir, filePath))
			if err == nil && len(new) <= maxSize {
				entry.NewContent = string(new)
			}
		}

		entries = append(entries, entry)
	}

	return entries
}

// mapGitStatus 将 git diff --name-status 的状态码映射为语义化状态。
func mapGitStatus(code string) string {
	switch {
	case strings.HasPrefix(code, "A"):
		return "added"
	case strings.HasPrefix(code, "D"):
		return "deleted"
	case strings.HasPrefix(code, "R"):
		return "renamed"
	default:
		return "modified"
	}
}

// detectBaseBranch 检测 git 仓库的基准分支（master 或 main）。
// 优先检查 main，再检查 master，返回存在的分支名。
func detectBaseBranch(dir string) string {
	for _, branch := range []string{"main", "master"} {
		// 检查分支是否存在（本地或远程）
		out, err := projectGitExec(dir, "rev-parse", "--verify", branch)
		if err == nil && strings.TrimSpace(out) != "" {
			return branch
		}
		// 检查远程分支
		out, err = projectGitExec(dir, "rev-parse", "--verify", "origin/"+branch)
		if err == nil && strings.TrimSpace(out) != "" {
			return "origin/" + branch
		}
	}
	return ""
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

	pushed := false
	message := "项目已同步，Git 仓库已更新"

	// 若请求携带远程仓库信息，则设置 remote 并推送。
	if req.RemoteURL != "" {
		remoteName := req.RemoteName
		if remoteName == "" {
			remoteName = defaultRemoteName
		}
		if err := ensureGitRemote(absPath, remoteName, req.RemoteURL); err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, fmt.Sprintf("failed to configure remote: %v", err))
			return
		}

		branch := req.RemoteBranch
		if branch == "" {
			// 未指定分支时优先使用当前分支，兜底使用 main。
			if current, err := currentGitBranch(absPath); err == nil && current != "" {
				branch = current
			} else {
				branch = "main"
			}
		}
		if err := ensureLocalBranch(absPath, branch); err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, fmt.Sprintf("failed to prepare branch: %v", err))
			return
		}

		if err := pushToRemote(absPath, remoteName, req.RemoteURL, branch, req.SSHKey); err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, fmt.Sprintf("failed to push: %v", err))
			return
		}
		pushed = true
		message = "项目已同步并推送至远程仓库"
	}

	log.Printf("[Projects] sync success: %s, workspace=%s, commit=%s, pushed=%v", absPath, req.WorkspaceID, strings.TrimSpace(headHash), pushed)

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"path":        absPath,
		"projectName": filepath.Base(absPath),
		"commitHash":  strings.TrimSpace(headHash),
		"pushed":      pushed,
		"message":     message,
	})
}
