package project

import "time"

// Project 表示代码项目
type Project struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenantId"`
	Name      string    `json:"name"`
	GitURL    string    `json:"gitUrl"`
	RepoType  RepoType  `json:"repoType"`
	MeegoKey  string    `json:"meegoKey"`
	CreatedAt time.Time `json:"createdAt"`
}

// RepoType 仓库类型
type RepoType string

const (
	RepoTypeDev     RepoType = "dev"
	RepoTypeTest    RepoType = "test"
	RepoTypeCase    RepoType = "case"
	RepoTypeProduct RepoType = "product"
)

// Repository 表示一个可被代码库页面操作的代码仓库实例。
type Repository struct {
	ID            string   `json:"id"`
	ProjectID     string   `json:"projectId"`
	Name          string   `json:"name"`
	URL           string   `json:"url"`
	Type          RepoType `json:"type"`
	DefaultBranch string   `json:"defaultBranch"`
	PreviewURL    string   `json:"previewUrl,omitempty"`
	Branches      []string `json:"branches,omitempty"`
}

// Branch 表示代码仓库的分支信息。
type Branch struct {
	Name       string `json:"name"`
	IsDefault  bool   `json:"isDefault"`
	LastCommit string `json:"lastCommit,omitempty"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

// FileNode 表示文件树中的节点。
type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Type     string     `json:"type"` // "file" | "folder"
	Children []FileNode `json:"children,omitempty"`
}

// FileContent 表示文件内容。
type FileContent struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	Language  string `json:"language"`
	Encoding  string `json:"encoding"`
	Size      int    `json:"size"`
	LastCommit string `json:"lastCommit,omitempty"`
}
