package object

import "time"

// ReviewIssue 定义 PR 评审问题。
type ReviewIssue struct {
	ID       string `json:"id"`
	File     string `json:"file"`
	Line     int    `json:"line"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// ReviewResult 定义 PR 评审结果。
type ReviewResult struct {
	ID        string        `json:"id"`
	Repo      string        `json:"repo"`
	PRID      int           `json:"prId"`
	Title     string        `json:"title"`
	Summary   string        `json:"summary"`
	Issues    []ReviewIssue `json:"issues"`
	CreatedAt time.Time     `json:"createdAt"`
}
