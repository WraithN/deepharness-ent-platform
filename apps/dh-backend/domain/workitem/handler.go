package workitem

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

var defaultWorkItemService = service.NewMockWorkItemService()

// WorkItems 处理工作项集合请求：GET 列表、POST 创建（当前仅实现 GET）。
func WorkItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		filter := parseWorkItemFilter(r)
		items, err := defaultWorkItemService.ListWorkItems(filter)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list workitems"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(items)
	case http.MethodPost:
		http.Error(w, `{"code":1,"message":"not implemented"}`, http.StatusNotImplemented)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// WorkItemByID 处理单个工作项请求：GET 详情、PUT 更新、DELETE 删除（当前仅实现 GET）。
func WorkItemByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		item, err := defaultWorkItemService.GetWorkItem(id)
		if err != nil {
			http.Error(w, `{"code":1,"message":"workitem not found"}`, http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(item)
	case http.MethodPut, http.MethodDelete:
		http.Error(w, `{"code":1,"message":"not implemented"}`, http.StatusNotImplemented)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// UpdateWorkItemStatus 处理 PATCH /api/v1/workitems/{id}/status。
func UpdateWorkItemStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		Status workitem.Status `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	item, err := defaultWorkItemService.UpdateWorkItemStatus(id, req.Status)
	if err != nil {
		http.Error(w, `{"code":1,"message":"workitem not found"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(item)
}

// parseWorkItemFilter 从查询参数解析工作项过滤条件。
func parseWorkItemFilter(r *http.Request) service.WorkItemFilter {
	q := r.URL.Query()
	return service.WorkItemFilter{
		ProjectID:  q.Get("projectId"),
		Type:       workitem.Type(q.Get("type")),
		Status:     workitem.Status(q.Get("status")),
		AssigneeID: q.Get("assigneeId"),
	}
}
