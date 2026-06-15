package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/project/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
)

// ProjectFilter 定义项目列表查询条件。
type ProjectFilter struct {
	TenantID string
	RepoType project.RepoType
}

// ProjectService 定义 project 模块的服务接口。
type ProjectService interface {
	ListProjects(filter ProjectFilter) ([]object.Project, error)
	GetProject(id string) (object.Project, error)

	// Repository 相关接口，服务于代码库 / 工程代码页面。
	ListRepositories(filter RepositoryFilter) ([]object.Repository, error)
	GetRepository(id string) (object.Repository, error)
	ListBranches(repoID string) ([]project.Branch, error)
	GetTree(repoID, branch, path string) ([]project.FileNode, error)
	GetContent(repoID, branch, path string) (project.FileContent, error)
}

// RepositoryFilter 定义仓库列表查询条件。
type RepositoryFilter struct {
	ProjectID string
	Type      project.RepoType
}
