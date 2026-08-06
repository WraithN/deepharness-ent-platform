package object

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// CreateRepositoryRequest 创建仓库请求。仓库名称由 URL 解析，SSH Key 由用户 Profile 提供。
type CreateRepositoryRequest struct {
	URL           string `json:"url"`
	Type          string `json:"type"`
	DefaultBranch string `json:"defaultBranch"`
}

// UpdateRepositoryRequest 更新仓库请求。
type UpdateRepositoryRequest struct {
	URL           string `json:"url,omitempty"`
	Type          string `json:"type,omitempty"`
	DefaultBranch string `json:"defaultBranch,omitempty"`
}

// SetRemoteURLRequest 设置远程 origin URL 请求。
type SetRemoteURLRequest struct {
	URL string `json:"url"`
}

// ScannedRepository 扫描发现的本地仓库。
type ScannedRepository struct {
	Name              string     `json:"name"`
	Path              string     `json:"path"`
	URL               string     `json:"url"`
	CurrentBranch     string     `json:"currentBranch"`
	LastCommit        string     `json:"lastCommit"`
	LastCommitMessage string     `json:"lastCommitMessage"`
	LastCommitTime    *time.Time `json:"lastCommitTime,omitempty"`
	IsCloned          bool       `json:"isCloned"`
}

// CommitStats 提交统计信息。
type CommitStats struct {
	TotalCommits int        `json:"totalCommits"`
	LastWeek     int        `json:"lastWeek"`
	LastMonth    int        `json:"lastMonth"`
	LastCommit   *time.Time `json:"lastCommit,omitempty"`
	FirstCommit  *time.Time `json:"firstCommit,omitempty"`
}

// BranchInfo 分支信息。
type BranchInfo struct {
	Name           string     `json:"name"`
	IsCurrent      bool       `json:"isCurrent"`
	IsRemote       bool       `json:"isRemote"`
	LastCommit     string     `json:"lastCommit"`
	LastCommitTime *time.Time `json:"lastCommitTime,omitempty"`
	Ahead          int        `json:"ahead"`
	Behind         int        `json:"behind"`
}

// CommitterStat 贡献者提交统计。
type CommitterStat struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Commits int    `json:"commits"`
}

// DailyCommit 单日提交数量。
type DailyCommit struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// LanguageStat 语言统计信息。
type LanguageStat struct {
	Name       string  `json:"name"`
	Files      int     `json:"files"`
	Bytes      int64   `json:"bytes"`
	Percentage float64 `json:"percentage"`
	Color      string  `json:"color"`
}

// RepositoryDetails 仓库详细信息。
type RepositoryDetails struct {
	Repository           repository.Repository `json:"repository"`
	CommitStats          CommitStats           `json:"commitStats"`
	Branches             []BranchInfo          `json:"branches"`
	Contributors         []string              `json:"contributors"`
	FileCount            int                   `json:"fileCount"`
	SizeBytes            int64                 `json:"sizeBytes"`
	Language             string                `json:"language"`
	EffectiveLinesOfCode int                   `json:"effectiveLinesOfCode"`
	CommitterStats       []CommitterStat       `json:"committerStats"`
	WeeklyCommits        []DailyCommit         `json:"weeklyCommits"`
	LanguageStats        []LanguageStat        `json:"languageStats"`
}

// FileNode 文件树节点。
type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Type     string     `json:"type"` // "file" or "folder"
	Children []FileNode `json:"children,omitempty"`
}

// FileContent 文件内容。
type FileContent struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	Language string `json:"language"`
	Encoding string `json:"encoding"`
	Size     int64  `json:"size"`
}

// UserRepoStatus 表示一个配置仓库在用户 projects 目录中的同步状态。
type UserRepoStatus struct {
	RepositoryID  string `json:"repositoryId"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Type          string `json:"type"`
	DefaultBranch string `json:"defaultBranch"`
	Synced        bool   `json:"synced"`
	SyncStatus    string `json:"syncStatus"`
	Progress      int    `json:"progress"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}

// STATE_SYNCING / STATE_SYNCED / STATE_FAILED 为用户仓库同步状态常量。
const (
	STATE_SYNCING = "syncing"
	STATE_SYNCED  = "synced"
	STATE_FAILED  = "failed"
)
