package workitem

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

var defaultWorkItemService service.WorkItemService

// Init 设置 WorkItem 服务实现。
func Init(svc service.WorkItemService) {
	defaultWorkItemService = svc
}

// WorkItems 处理工作项集合请求：GET 列表、POST 创建（当前仅实现 GET）。
func WorkItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodGet:
		filter := parseWorkItemFilter(r)
		items, err := defaultWorkItemService.ListWorkItems(filter)
		if err != nil {
			log.Printf("[WorkItem] ListWorkItems failed: %v", err)
			http.Error(w, `{"code":1,"message":"failed to list workitems"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(items)
	case http.MethodPost:
		var req object.CreateWorkItemRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Printf("[WorkItem] invalid create request: %v", err)
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		item, err := defaultWorkItemService.CreateWorkItem(req)
		if err != nil {
			log.Printf("[WorkItem] CreateWorkItem failed: %v", err)
			http.Error(w, `{"code":1,"message":"创建需求失败"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(item)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// WorkItemByID 处理单个工作项请求：GET 详情、PUT 更新、DELETE 删除（当前仅实现 GET）。
func WorkItemByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
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

// UpdateWorkItemAssignee 处理 PATCH /api/v1/workitems/{id}/assignee。
func UpdateWorkItemAssignee(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		AssigneeID string `json:"assigneeId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	item, err := defaultWorkItemService.UpdateWorkItemAssignee(id, req.AssigneeID)
	if err != nil {
		http.Error(w, `{"code":1,"message":"workitem not found"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(item)
}

// UpdateWorkItemStatus 处理 PATCH /api/v1/workitems/{id}/status。
func UpdateWorkItemStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
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

// DocLinks 处理 GET / POST /api/v1/workitems/{id}/doc-links。
// GET 返回需求关联的全部文档/原型列表；POST 新建关联。
func DocLinks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		links, err := defaultWorkItemService.ListDocLinks(id)
		if err != nil {
			log.Printf("[WorkItem] ListDocLinks failed: %v", err)
			http.Error(w, `{"code":1,"message":"failed to list doc links"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(links)
	case http.MethodPost:
		var req object.CreateDocLinkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		link, err := defaultWorkItemService.CreateDocLink(id, req)
		if err != nil {
			log.Printf("[WorkItem] CreateDocLink failed: %v", err)
			http.Error(w, `{"code":1,"message":"failed to create doc link"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(link)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// DocLinkByID 处理 DELETE /api/v1/workitems/{id}/doc-links/{itemId}。
func DocLinkByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
	workitemID := r.PathValue("id")
	itemID := r.PathValue("itemId")
	if workitemID == "" || itemID == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id or item id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := defaultWorkItemService.DeleteDocLink(workitemID, itemID); err != nil {
			http.Error(w, `{"code":1,"message":"doc link not found"}`, http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ListDesignVersions 处理 GET /api/v1/workitems/{id}/design-versions。
// 返回指定需求的产品设计版本列表（包含文档与原型快照）。
func ListDesignVersions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
	workitemID := r.PathValue("id")
	if workitemID == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id"}`, http.StatusBadRequest)
		return
	}

	versions, err := defaultWorkItemService.ListDesignVersions(workitemID)
	if err != nil {
		log.Printf("[WorkItem] ListDesignVersions failed: %v", err)
		http.Error(w, `{"code":1,"message":"failed to list design versions"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(object.ListDesignVersionsResponse{Versions: versions})
}

// ListRequirementsWithDesignItems 处理 GET /api/v1/workspaces/{id}/workitems-with-design-items。
// 返回工作空间下包含文档或原型关联的需求列表，按需求更新时间倒序，
// 每个需求聚合最新的一篇文档与最新的一个原型。
func ListRequirementsWithDesignItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"code":1,"message":"missing workspace id"}`, http.StatusBadRequest)
		return
	}

	items, err := defaultWorkItemService.ListRequirementsWithDesignItems(workspaceID)
	if err != nil {
		log.Printf("[WorkItem] ListRequirementsWithDesignItems failed: %v", err)
		http.Error(w, `{"code":1,"message":"failed to list requirements with design items"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(items)
}
