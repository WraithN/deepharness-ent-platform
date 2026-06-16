package repository

import "time"

// Repository 表示工作空间下的一个 Git 仓库。
type Repository struct {
	ID            string      `json:"id"`
	WorkspaceID   string      `json:"workspaceId"`
	Name          string      `json:"name"`
	URL           string      `json:"url"`
	Type          RepoType    `json:"type"`
	DefaultBranch string      `json:"defaultBranch"`
	SSHKey        string      `json:"sshKey,omitempty"`
	LocalPath     string      `json:"localPath,omitempty"`
	CloneStatus   CloneStatus `json:"cloneStatus"`
	LastSyncAt    *time.Time  `json:"lastSyncAt,omitempty"`
	ErrorMessage  string      `json:"errorMessage,omitempty"`
	Config        any         `json:"config,omitempty"`
	CreatedAt     time.Time   `json:"createdAt"`
	UpdatedAt     time.Time   `json:"updatedAt"`
}

// RepoType 仓库类型。
type RepoType string

const (
	RepoTypeDev     RepoType = "dev"
	RepoTypeTest    RepoType = "test"
	RepoTypeCase    RepoType = "case"
	RepoTypeProduct RepoType = "product"
)

// CloneStatus 表示本地克隆状态。
type CloneStatus string

const (
	CloneStatusPending CloneStatus = "pending"
	CloneStatusCloning CloneStatus = "cloning"
	CloneStatusCloned  CloneStatus = "cloned"
	CloneStatusFailed  CloneStatus = "failed"
)
