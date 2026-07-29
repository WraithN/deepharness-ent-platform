package agent_review

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agent_review/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agent_review/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

var defaultAgentReviewService service.AgentReviewService

func Init(svc service.AgentReviewService) {
	defaultAgentReviewService = svc
}

func notifyNotInitialized(w http.ResponseWriter) {
	handler.WriteJSONError(w, http.StatusInternalServerError, 1, "agent_review service not initialized")
}

func Adopt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultAgentReviewService == nil {
		notifyNotInitialized(w)
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	var req object.AdoptReviewReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	report, err := defaultAgentReviewService.AdoptReviewReport(req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(report)
}

func ListReports(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultAgentReviewService == nil {
		notifyNotInitialized(w)
		return
	}
	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "workspaceId is required")
		return
	}
	reports, err := defaultAgentReviewService.ListAgentReviewReports(workspaceID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(reports)
}

func GetReport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultAgentReviewService == nil {
		notifyNotInitialized(w)
		return
	}
	reportID := extractIDFromPath(r.URL.Path, "reports")
	if reportID == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "report id not found in path")
		return
	}
	report, err := defaultAgentReviewService.GetAgentReviewReport(reportID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(report)
}

func UpdateIssueStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultAgentReviewService == nil {
		notifyNotInitialized(w)
		return
	}
	if r.Method != http.MethodPatch && r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	reportID := extractIDFromPath(r.URL.Path, "reports")
	if reportID == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "report id not found in path")
		return
	}
	var req object.UpdateIssueStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	report, err := defaultAgentReviewService.UpdateIssueStatus(reportID, req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(report)
}

func extractIDFromPath(path string, segment string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p == segment && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}
