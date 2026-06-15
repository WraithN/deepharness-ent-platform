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
	RepoTypeDev   RepoType = "dev"
	RepoTypeTest  RepoType = "test"
)
