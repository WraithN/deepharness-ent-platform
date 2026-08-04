package productspace

import (
	"errors"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
)

// ImportPrototype 处理 POST /api/v1/workspaces/{id}/product-space/import-prototype。
// 将磁盘上 /proto-make 生成的原型工程目录正式采纳到产品空间；
// 若请求携带 workitemId，还会将导入的原型页面关联到该需求，并生成一次产品设计版本。
func (h *Handler) ImportPrototype(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	var req object.ImportPrototypeRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}
	if req.Folder == "" {
		h.writeError(w, http.StatusBadRequest, "folder is required")
		return
	}

	workspaceID := h.workspaceID(r)
	importedIDs, err := h.importSvc.ImportPrototype(r.Context(), workspaceID, userID, req.Folder)
	if err != nil {
		h.handleServiceError(w, err, "failed to import prototype")
		return
	}

	// 关联需求并生成设计版本：在 handler 层编排，避免 productspace service 与 workitem service 循环依赖。
	// 只要提供了 workitemId，每次采纳都会生成一次产品设计版本快照。
	if req.WorkitemID != "" && h.workItemSvc != nil {
		for _, itemID := range importedIDs {
			linkErr := h.workItemSvc.CreateDocLink(r.Context(), CreateDocLinkRequest{
				WorkitemID:         req.WorkitemID,
				ProductSpaceItemID: itemID,
				WorkspaceID:        workspaceID,
				ItemType:           "prototype",
			})
			if linkErr != nil {
				log.Printf("[ProductSpace] create doc link failed for workitem %s item %s: %v", req.WorkitemID, itemID, linkErr)
			}
		}

		_, dvErr := h.workItemSvc.CreateDesignVersion(r.Context(), workspaceID, req.WorkitemID, "采纳原型")
		if dvErr != nil {
			log.Printf("[ProductSpace] create design version failed for workitem %s: %v", req.WorkitemID, dvErr)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// ImportDoc 处理 POST /api/v1/workspaces/{id}/product-space/import-doc。
// 将用户个人工作目录中的文档文件采纳到产品空间 docs 目录；
// 若请求携带 workitemId，还会将文档关联到该需求并生成一次产品设计版本。
// 需求标题会作为 docs 下的子目录，便于在产品空间中对齐"对应的需求文档"。
func (h *Handler) ImportDoc(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	var req object.ImportDocRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}
	if req.Path == "" {
		h.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	workspaceID := h.workspaceID(r)

	// 若关联需求，使用需求标题作为 docs 下的子目录，形成"对应需求文档"的目录结构。
	if req.WorkitemID != "" && h.workItemSvc != nil {
		wi, err := h.workItemSvc.GetWorkItem(r.Context(), workspaceID, req.WorkitemID)
		if err != nil {
			h.handleServiceError(w, err, "failed to get workitem")
			return
		}
		if req.Folder == "" {
			req.Folder = wi.Title
		}
	}

	item, err := h.importSvc.ImportDoc(r.Context(), workspaceID, userID, req)
	if err != nil {
		h.handleServiceError(w, err, "failed to import doc")
		return
	}

	// 关联需求并生成设计版本：在 handler 层编排，避免 productspace service 与 workitem service 循环依赖。
	if req.WorkitemID != "" && h.workItemSvc != nil {
		linkErr := h.workItemSvc.CreateDocLink(r.Context(), CreateDocLinkRequest{
			ProductSpaceItemID: item.ID,
			WorkspaceID:        workspaceID,
			ItemType:           "doc",
			WorkitemID:         req.WorkitemID,
		})
		if linkErr != nil {
			log.Printf("[ProductSpace] create doc link failed for workitem %s item %s: %v", req.WorkitemID, item.ID, linkErr)
		}

		_, dvErr := h.workItemSvc.CreateDesignVersion(r.Context(), workspaceID, req.WorkitemID, "采纳文档")
		if dvErr != nil {
			log.Printf("[ProductSpace] create design version failed for workitem %s: %v", req.WorkitemID, dvErr)
		}
	}

	h.writeJSON(w, http.StatusOK, item)
}

// ImportDocStatus 处理 GET /api/v1/workspaces/{id}/product-space/import-doc/status。
// 按源文件路径查询该文档是否已被采纳到产品空间，供前端持久化展示"已采纳"状态。
func (h *Handler) ImportDocStatus(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	workspaceID := h.workspaceID(r)
	path := r.URL.Query().Get("path")
	if path == "" {
		h.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	item, err := h.importSvc.GetDocImportStatus(r.Context(), workspaceID, userID, path)
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			h.writeJSON(w, http.StatusOK, map[string]interface{}{
				"adopted": false,
				"item":    nil,
			})
			return
		}
		h.handleServiceError(w, err, "failed to get doc import status")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"adopted": true,
		"item":    item,
	})
}

// ShareProcessDeliverableRequest 是流程交付物分享接口的请求体。
type ShareProcessDeliverableRequest struct {
	Type string `json:"type"` // file | project
	Path string `json:"path"`
}

// ShareProcessDeliverable 处理 POST /api/v1/processes/{id}/deliverables/share。
// 按流程所有者（工作项负责人）身份将流程产物导入产品空间并创建需求级分享链接，
// 使任意工作空间成员均可查看该流程的交付物（无需 PM 权限或产物所有者身份）。
func (h *Handler) ShareProcessDeliverable(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	processID := r.PathValue("id")
	if processID == "" {
		h.writeError(w, http.StatusBadRequest, "process id is required")
		return
	}
	if h.processSvc == nil {
		h.writeError(w, http.StatusInternalServerError, "process service not initialized")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
	var req ShareProcessDeliverableRequest
	if !h.decodeJSONBody(w, r, &req) {
		log.Printf("[ShareProcessDeliverable] decodeJSONBody failed for process %s", processID)
		return
	}
	if req.Path == "" {
		log.Printf("[ShareProcessDeliverable] empty path for process %s, req=%+v", processID, req)
		h.writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	if req.Type != "file" && req.Type != "project" {
		log.Printf("[ShareProcessDeliverable] invalid type %q for process %s", req.Type, processID)
		h.writeError(w, http.StatusBadRequest, "type must be file or project")
		return
	}

	ctx := r.Context()
	process, err := h.processSvc.GetByID(ctx, processID)
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			h.writeError(w, http.StatusNotFound, errMsgNotFound)
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to get process")
		return
	}
	if process.WorkitemID == "" {
		log.Printf("[ShareProcessDeliverable] process %s has no WorkitemID", processID)
		h.writeError(w, http.StatusBadRequest, "process has no associated workitem")
		return
	}

	workitem, err := h.workItemSvc.GetWorkItem(ctx, process.WorkspaceID, process.WorkitemID)
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			h.writeError(w, http.StatusNotFound, errMsgNotFound)
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to get workitem")
		return
	}
	ownerUserID := workitem.AssigneeID
	if ownerUserID == "" {
		ownerUserID = userID
	}

	share, err := h.importSvc.ImportProcessDeliverable(ctx, process.WorkspaceID, userID, ownerUserID, workitem.Title, req.Type, req.Path)
	if err != nil {
		h.handleServiceError(w, err, "failed to share process deliverable")
		return
	}
	h.writeJSON(w, http.StatusOK, share)
}
