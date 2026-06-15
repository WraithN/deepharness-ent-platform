package service

import (
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/project/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
)

// MockProjectService 是 ProjectService 的内存 mock 实现。
type MockProjectService struct {
	mu          sync.RWMutex
	projects    []object.Project
	repositories []object.Repository
}

// NewMockProjectService 创建预置示例数据的 MockProjectService。
func NewMockProjectService() *MockProjectService {
	return &MockProjectService{
		projects: []object.Project{
			{ID: "p1", TenantID: "t1", Name: "DeepHarness Platform", GitURL: "https://gitlab.com/company/deepharness.git", RepoType: project.RepoTypeDev, MeegoKey: "MEEGO-DH", CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
			{ID: "p2", TenantID: "t1", Name: "Meego 研发中心", GitURL: "https://gitlab.com/company/meego.git", RepoType: project.RepoTypeTest, MeegoKey: "MEEGO-RD", CreatedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
			{ID: "p3", TenantID: "t1", Name: "AI Agent Runtime", GitURL: "https://gitlab.com/company/agent-runtime.git", RepoType: project.RepoTypeDev, MeegoKey: "MEEGO-AGENT", CreatedAt: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)},
		},
		repositories: []object.Repository{
			{ID: "1", ProjectID: "p1", Name: "frontend-web", URL: "https://gitlab.com/company/frontend-web.git", Type: project.RepoTypeDev, DefaultBranch: "main", PreviewURL: "https://example.com", Branches: []string{"main", "develop", "feature/login", "fix/ui-bug"}},
			{ID: "2", ProjectID: "p1", Name: "backend-api", URL: "https://gitlab.com/company/backend-api.git", Type: project.RepoTypeDev, DefaultBranch: "main", PreviewURL: "https://httpbin.org/get", Branches: []string{"main", "feature/auth", "hotfix/db-crash"}},
			{ID: "3", ProjectID: "p1", Name: "ui-components", URL: "https://gitlab.com/company/ui-components.git", Type: project.RepoTypeDev, DefaultBranch: "main", PreviewURL: "https://example.com", Branches: []string{"main", "beta"}},
			{ID: "4", ProjectID: "p2", Name: "e2e-tests", URL: "https://gitlab.com/company/e2e-tests.git", Type: project.RepoTypeCase, DefaultBranch: "main", Branches: []string{"main", "test/auth"}},
			{ID: "5", ProjectID: "p2", Name: "api-tests", URL: "https://gitlab.com/company/api-tests.git", Type: project.RepoTypeCase, DefaultBranch: "main", Branches: []string{"main", "test/users"}},
			{ID: "6", ProjectID: "p3", Name: "prd-docs", URL: "https://gitlab.com/company/prd-docs.git", Type: project.RepoTypeProduct, DefaultBranch: "main", Branches: []string{"main", "v2.0"}},
		},
	}
}

// ListProjects 返回项目列表。
func (s *MockProjectService) ListProjects(filter ProjectFilter) ([]object.Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]object.Project, 0, len(s.projects))
	for _, p := range s.projects {
		if filter.TenantID != "" && p.TenantID != filter.TenantID {
			continue
		}
		if filter.RepoType != "" && p.RepoType != filter.RepoType {
			continue
		}
		result = append(result, p)
	}
	return result, nil
}

// GetProject 按 ID 返回项目详情。
func (s *MockProjectService) GetProject(id string) (object.Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, p := range s.projects {
		if p.ID == id {
			return p, nil
		}
	}
	return object.Project{}, errors.New("project not found")
}

// ListRepositories 返回仓库列表。
func (s *MockProjectService) ListRepositories(filter RepositoryFilter) ([]object.Repository, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]object.Repository, 0, len(s.repositories))
	for _, r := range s.repositories {
		if filter.ProjectID != "" && r.ProjectID != filter.ProjectID {
			continue
		}
		if filter.Type != "" && r.Type != filter.Type {
			continue
		}
		result = append(result, r)
	}
	return result, nil
}

// GetRepository 按 ID 返回仓库详情。
func (s *MockProjectService) GetRepository(id string) (object.Repository, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, r := range s.repositories {
		if r.ID == id {
			return r, nil
		}
	}
	return object.Repository{}, errors.New("repository not found")
}

// ListBranches 返回仓库分支列表。
func (s *MockProjectService) ListBranches(repoID string) ([]project.Branch, error) {
	repo, err := s.GetRepository(repoID)
	if err != nil {
		return nil, err
	}

	branches := make([]project.Branch, 0, len(repo.Branches))
	for _, name := range repo.Branches {
		branches = append(branches, project.Branch{
			Name:      name,
			IsDefault: name == repo.DefaultBranch,
			LastCommit: "mock-commit-" + name,
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		})
	}
	return branches, nil
}

// repoTrees 保存每个仓库/分支的完整文件树 mock 数据。
var repoTrees = map[string][]project.FileNode{
	"1": {
		{Name: "src", Path: "src", Type: "folder", Children: []project.FileNode{
			{Name: "components", Path: "src/components", Type: "folder", Children: []project.FileNode{
				{Name: "Button.tsx", Path: "src/components/Button.tsx", Type: "file"},
				{Name: "Input.tsx", Path: "src/components/Input.tsx", Type: "file"},
			}},
			{Name: "pages", Path: "src/pages", Type: "folder", Children: []project.FileNode{
				{Name: "App.tsx", Path: "src/pages/App.tsx", Type: "file"},
				{Name: "index.tsx", Path: "src/pages/index.tsx", Type: "file"},
			}},
			{Name: "utils.ts", Path: "src/utils.ts", Type: "file"},
		}},
		{Name: "package.json", Path: "package.json", Type: "file"},
		{Name: "README.md", Path: "README.md", Type: "file"},
	},
	"2": {
		{Name: "cmd", Path: "cmd", Type: "folder", Children: []project.FileNode{
			{Name: "main.go", Path: "cmd/main.go", Type: "file"},
		}},
		{Name: "pkg", Path: "pkg", Type: "folder", Children: []project.FileNode{
			{Name: "handler.go", Path: "pkg/handler.go", Type: "file"},
		}},
		{Name: "go.mod", Path: "go.mod", Type: "file"},
	},
	"3": {
		{Name: "index.ts", Path: "index.ts", Type: "file"},
	},
	"4": {
		{Name: "tests", Path: "tests", Type: "folder", Children: []project.FileNode{
			{Name: "auth.spec.ts", Path: "tests/auth.spec.ts", Type: "file"},
		}},
	},
	"5": {
		{Name: "tests", Path: "tests", Type: "folder", Children: []project.FileNode{
			{Name: "users.test.ts", Path: "tests/users.test.ts", Type: "file"},
		}},
	},
	"6": {
		{Name: "docs", Path: "docs", Type: "folder", Children: []project.FileNode{
			{Name: "product-roadmap.md", Path: "docs/product-roadmap.md", Type: "file"},
			{Name: "user-research.md", Path: "docs/user-research.md", Type: "file"},
		}},
		{Name: "README.md", Path: "README.md", Type: "file"},
	},
}

// GetTree 返回指定仓库、分支、路径下的文件树。
func (s *MockProjectService) GetTree(repoID, branch, path string) ([]project.FileNode, error) {
	if _, err := s.GetRepository(repoID); err != nil {
		return nil, err
	}
	tree, ok := repoTrees[repoID]
	if !ok {
		return nil, errors.New("repository tree not found")
	}
	if path == "" || path == "/" {
		return tree, nil
	}

	// 在树中查找目标路径对应的子文件夹。
	parts := strings.Split(strings.Trim(path, "/"), "/")
	return findTreeNode(tree, parts), nil
}

func findTreeNode(nodes []project.FileNode, parts []string) []project.FileNode {
	if len(parts) == 0 {
		return nodes
	}
	for _, node := range nodes {
		if node.Type == "folder" && node.Name == parts[0] {
			return findTreeNode(node.Children, parts[1:])
		}
	}
	return nil
}

// fileContents 保存 mock 文件内容。
var fileContents = map[string]string{
	"src/components/Button.tsx":         "export const Button = () => <button>Click me</button>;",
	"src/components/Input.tsx":          "export const Input = () => <input type=\"text\" />;",
	"src/pages/App.tsx":                 "import React from \"react\";\n\nexport const App = () => {\n  return (\n    <div className=\"app\">\n      <h1>Hello World</h1>\n    </div>\n  );\n};",
	"src/pages/index.tsx":               "import { createRoot } from \"react-dom/client\";\nimport { App } from \"./App\";\n\ncreateRoot(document.getElementById(\"root\")!).render(<App />);",
	"src/utils.ts":                      "export const add = (a: number, b: number) => a + b;\nexport const classNames = (...classes: string[]) => classes.filter(Boolean).join(\" \");",
	"package.json":                      "{\n  \"name\": \"frontend-web\",\n  \"version\": \"1.0.0\",\n  \"dependencies\": {\n    \"react\": \"^18.2.0\"\n  }\n}",
	"README.md":                         "# Frontend Web\n\nThis is the main frontend application.",
	"cmd/main.go":                       "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Starting API server...\")\n}",
	"pkg/handler.go":                    "package pkg\n\nimport \"net/http\"\n\nfunc HandleRequest(w http.ResponseWriter, r *http.Request) {\n\tw.Write([]byte(\"OK\"))\n}",
	"go.mod":                            "module backend-api\n\ngo 1.20\n",
	"index.ts":                          "export * from \"./Button\";\nexport * from \"./Card\";",
	"tests/auth.spec.ts":                "describe('auth', () => { it('should login', () => {}); });",
	"tests/users.test.ts":               "describe('users', () => { it('should get users', () => {}); });",
	"docs/product-roadmap.md":           "# 产品路线图\n\n## Q3 目标\n- 完成核心功能模块开发\n- 上线用户增长策略",
	"docs/user-research.md":             "# 用户调研报告\n\n## 调研方法\n定性访谈 + 问卷调查",
}

// GetContent 返回指定仓库、分支、路径下的文件内容。
func (s *MockProjectService) GetContent(repoID, branch, path string) (project.FileContent, error) {
	if _, err := s.GetRepository(repoID); err != nil {
		return project.FileContent{}, err
	}
	content, ok := fileContents[path]
	if !ok {
		return project.FileContent{}, errors.New("file not found")
	}
	name := path
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		name = path[idx+1:]
	}
	return project.FileContent{
		Path:      path,
		Name:      name,
		Content:   content,
		Language:  detectLanguage(name),
		Encoding:  "utf-8",
		Size:      len(content),
		LastCommit: "mock-commit-" + branch,
	}, nil
}

func detectLanguage(name string) string {
	ext := ""
	if idx := strings.LastIndex(name, "."); idx >= 0 {
		ext = strings.ToLower(name[idx+1:])
	}
	switch ext {
	case "ts":
		return "typescript"
	case "tsx":
		return "tsx"
	case "js", "jsx":
		return "javascript"
	case "go":
		return "go"
	case "md":
		return "markdown"
	case "json":
		return "json"
	case "css":
		return "css"
	case "html":
		return "html"
	case "py":
		return "python"
	default:
		return "text"
	}
}
