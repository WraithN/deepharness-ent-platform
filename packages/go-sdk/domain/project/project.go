package project

import "time"

// Project 表示代码项目
type Project struct {
	ID          string
	TenantID    string
	Name        string
	GitURL      string
	RepoType    RepoType
	MeegoKey    string
	CreatedAt   time.Time
}

// RepoType 仓库类型
type RepoType string

const (
	RepoTypeDev   RepoType = "dev"
	RepoTypeTest  RepoType = "test"
)
