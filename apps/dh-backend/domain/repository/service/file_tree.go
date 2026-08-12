package service

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/gitutil"
)

// GetFileTree 获取仓库文件树，尊重 .gitignore，按指定顺序排序。
func (s *DBRepositoryService) GetFileTree(workspaceID, repoID, branch, userID string) ([]object.FileNode, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if err := s.ensureLocalPath(ctx, repo, userID); err != nil {
		return nil, err
	}

	localPath := s.resolveUserLocalPath(repo, userID)

	// Load .gitignore patterns
	ignorePatterns := loadGitignorePatterns(ctx, localPath)

	// Collect all file paths with directory info
	type pathInfo struct {
		path  string
		isDir bool
	}
	var paths []pathInfo
	treeSC := stubclient.FromContext(ctx)
	if treeSC == nil {
		return nil, fmt.Errorf("stubclient not initialized")
	}
	err = walkDir(ctx, treeSC, localPath, func(path string, entry stubclient.DirEntry) error {
		relPath, _ := filepath.Rel(localPath, path)
		isGitDir := relPath == ".git" || strings.HasPrefix(relPath, ".git"+string(filepath.Separator))
		if isGitDir || isIgnored(relPath, ignorePatterns) {
			if entry.IsDir {
				return filepath.SkipDir
			}
			return nil
		}
		paths = append(paths, pathInfo{path: relPath, isDir: entry.IsDir})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to walk directory: %w", err)
	}

	// Build tree using map of pointers
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

			n := &node{
				Name: part,
				Path: currentPath,
				Type: "folder",
			}
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

	// Convert to final FileNode structure recursively
	var convert func(*node) object.FileNode
	convert = func(n *node) object.FileNode {
		children := make([]object.FileNode, len(n.Children))
		for i, c := range n.Children {
			children[i] = convert(c)
		}
		return object.FileNode{
			Name:     n.Name,
			Path:     n.Path,
			Type:     n.Type,
			Children: children,
		}
	}

	result := make([]object.FileNode, len(roots))
	for i, r := range roots {
		result[i] = convert(r)
	}

	sortFileNodes(&result)

	return result, nil
}

// loadGitignorePatterns 读取 .gitignore 文件并返回所有模式
func loadGitignorePatterns(ctx context.Context, repoRoot string) []string {
	var patterns []string

	gitignorePath := filepath.Join(repoRoot, ".gitignore")
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return patterns
	}
	data, err := sc.ReadFile(ctx, gitignorePath)
	if err != nil {
		return patterns
	}

	lines := strings.Split(data, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip comments and empty lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}

	return patterns
}

// isIgnored 检查文件路径是否匹配 .gitignore 模式（简化版）
func isIgnored(path string, patterns []string) bool {
	for _, pattern := range patterns {
		matched, _ := filepath.Match(pattern, filepath.Base(path))
		if matched {
			return true
		}
		// Check for directory pattern or partial path match
		matched, _ = filepath.Match(pattern, path)
		if matched {
			return true
		}
		// Check prefix for recursive patterns
		if strings.HasSuffix(pattern, "/") && strings.HasPrefix(path, strings.TrimSuffix(pattern, "/")) {
			return true
		}
	}
	return false
}

// isHidden 检查是否为隐藏文件/目录（.开头）
func isHidden(name string) bool {
	return strings.HasPrefix(name, ".")
}

// sortFileNodes 按指定顺序排序：隐藏目录 -> 目录 -> 隐藏文件 -> 文件，字母序
func sortFileNodes(nodes *[]object.FileNode) {
	sort.Slice(*nodes, func(i, j int) bool {
		a := (*nodes)[i]
		b := (*nodes)[j]

		aIsFolder := a.Type == "folder"
		bIsFolder := b.Type == "folder"
		aIsHidden := isHidden(a.Name)
		bIsHidden := isHidden(b.Name)

		// 隐藏目录优先
		if aIsFolder && aIsHidden && (!bIsFolder || !bIsHidden) {
			return true
		}
		if bIsFolder && bIsHidden && (!aIsFolder || !aIsHidden) {
			return false
		}

		// 普通目录次之
		if aIsFolder && !aIsHidden && !bIsFolder {
			return true
		}
		if bIsFolder && !bIsHidden && !aIsFolder {
			return false
		}

		// 隐藏文件再次之
		if !aIsFolder && aIsHidden && !bIsHidden {
			return true
		}
		if !bIsFolder && bIsHidden && !aIsHidden {
			return false
		}

		// 同类型按字母排序（不区分大小写）
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})

	// 递归排序子目录
	for i := range *nodes {
		if len((*nodes)[i].Children) > 0 {
			sortFileNodes(&(*nodes)[i].Children)
		}
	}
}

// GetFileContent 获取文件内容。
func (s *DBRepositoryService) GetFileContent(workspaceID, repoID, branch, path, userID string) (*object.FileContent, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if err := s.ensureLocalPath(ctx, repo, userID); err != nil {
		return nil, err
	}

	localPath := s.resolveUserLocalPath(repo, userID)

	// 优先读取本地工作区文件（以便显示编辑后的内容）
	fullPath := filepath.Join(localPath, path)
	sc := stubclient.FromContext(ctx)
	var content string
	if sc != nil {
		if data, err := sc.ReadFile(ctx, fullPath); err == nil {
			content = data
		}
	}
	if content == "" {
		// 本地文件不存在时，从 git 读取
		targetBranch := branch
		if targetBranch == "" {
			targetBranch = repo.DefaultBranch
		}
		gitContent, err := gitutil.Exec(ctx, localPath, "show", fmt.Sprintf("%s:%s", targetBranch, path))
		if err != nil {
			return nil, fmt.Errorf("failed to get file content: %w", err)
		}
		content = gitContent
	}

	ext := strings.ToLower(filepath.Ext(path))
	language := map[string]string{
		".go":   "go",
		".js":   "javascript",
		".ts":   "typescript",
		".jsx":  "jsx",
		".tsx":  "tsx",
		".py":   "python",
		".java": "java",
		".rb":   "ruby",
		".php":  "php",
		".rs":   "rust",
		".cpp":  "cpp",
		".c":    "c",
		".h":    "c",
		".cs":   "csharp",
		".vue":  "vue",
		".html": "html",
		".css":  "css",
		".scss": "scss",
		".sql":  "sql",
		".sh":   "shell",
		".md":   "markdown",
		".json": "json",
		".yaml": "yaml",
		".yml":  "yaml",
	}[ext]
	if language == "" {
		language = "text"
	}

	return &object.FileContent{
		Path:     path,
		Name:     filepath.Base(path),
		Content:  content,
		Language: language,
		Encoding: "utf-8",
		Size:     int64(len(content)),
	}, nil
}

// SaveFileContent 保存文件内容到本地文件系统
func (s *DBRepositoryService) SaveFileContent(workspaceID, repoID, path, content, userID string) error {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if err := s.ensureLocalPath(ctx, repo, userID); err != nil {
		return err
	}

	localPath := s.resolveUserLocalPath(repo, userID)
	fullPath := filepath.Join(localPath, path)

	// 架构合规：通过 stubclient 写入文件（自动创建父目录），不直接操作共享目录
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return fmt.Errorf("personal-stub client not initialized")
	}
	if err := sc.WriteFile(ctx, fullPath, content); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}
