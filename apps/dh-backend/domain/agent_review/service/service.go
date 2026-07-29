package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agent_review/object"
)

type AgentReviewService interface {
	AdoptReviewReport(req object.AdoptReviewReportRequest) (object.AgentReviewReport, error)
	ListAgentReviewReports(workspaceID string) ([]object.AgentReviewReport, error)
	GetAgentReviewReport(id string) (object.AgentReviewReport, error)
	UpdateIssueStatus(reportID string, req object.UpdateIssueStatusRequest) (object.AgentReviewReport, error)
}
