package pragent

import "context"

// Agent PR-Agent 抽象
type Agent interface {
	Review(ctx context.Context, repo string, prID int) (*ReviewResult, error)
}

// ReviewResult 评审结果
type ReviewResult struct {
	Summary string
	Issues  []Issue
}

// Issue 代码问题
type Issue struct {
	File     string
	Line     int
	Severity string
	Message  string
}
