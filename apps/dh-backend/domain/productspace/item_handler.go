package productspace

import (
	"encoding/base64"
	"net/http"
	"strconv"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
)

// GetTree 处理 GET /api/v1/workspaces/{id}/product-space/tree，返回产品空间目录树。
func (h *Handler) GetTree(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	tree, err := h.itemSvc.GetTree(r.Context(), h.workspaceID(r), userID)
	if err != nil {
		h.handleServiceError(w, err, "failed to get product space tree")
		return
	}

	h.writeJSON(w, http.StatusOK, tree)
}

// CreateItem 处理 POST /api/v1/workspaces/{id}/product-space/items，创建文档或原型。
func (h *Handler) CreateItem(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	var req object.CreateItemRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if req.Type == "" || req.Title == "" {
		h.writeError(w, http.StatusBadRequest, errMsgTypeTitleRequired)
		return
	}

	item, err := h.itemSvc.CreateItem(r.Context(), h.workspaceID(r), userID, req)
	if err != nil {
		h.handleServiceError(w, err, "failed to create product space item")
		return
	}

	h.writeJSON(w, http.StatusCreated, item)
}

// ItemByID 处理 GET / DELETE /api/v1/workspaces/{id}/product-space/items/{itemId}。
func (h *Handler) ItemByID(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet, http.MethodDelete) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	workspaceID := h.workspaceID(r)
	itemID := h.itemID(r)

	switch r.Method {
	case http.MethodGet:
		item, data, err := h.itemSvc.GetItem(r.Context(), workspaceID, userID, itemID)
		if err != nil {
			h.handleServiceError(w, err, "failed to get product space item")
			return
		}

		resp := itemResponse{ProductSpaceItem: item}
		if item.Type == object.ItemTypePrototype {
			resp.Content = base64.StdEncoding.EncodeToString(data)
		} else {
			resp.Content = string(data)
		}
		h.writeJSON(w, http.StatusOK, resp)
	case http.MethodDelete:
		if err := h.itemSvc.DeleteItem(r.Context(), workspaceID, userID, itemID); err != nil {
			h.handleServiceError(w, err, "failed to delete product space item")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// UpdateContent 处理 PUT /api/v1/workspaces/{id}/product-space/items/{itemId}/content。
func (h *Handler) UpdateContent(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPut) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	var req object.UpdateContentRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	item, err := h.itemSvc.UpdateContent(r.Context(), h.workspaceID(r), userID, h.itemID(r), req)
	if err != nil {
		h.handleServiceError(w, err, "failed to update product space content")
		return
	}

	h.writeJSON(w, http.StatusOK, item)
}

// ListVersions 处理 GET /api/v1/workspaces/{id}/product-space/items/{itemId}/versions。
func (h *Handler) ListVersions(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	versions, err := h.itemSvc.ListVersions(r.Context(), h.workspaceID(r), userID, h.itemID(r))
	if err != nil {
		h.handleServiceError(w, err, "failed to list product space versions")
		return
	}

	h.writeJSON(w, http.StatusOK, versions)
}

// RestoreVersion 处理 POST /api/v1/workspaces/{id}/product-space/items/{itemId}/versions/{version}/restore。
func (h *Handler) RestoreVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	version, err := strconv.Atoi(r.PathValue("version"))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, errMsgInvalidVersion)
		return
	}

	item, err := h.itemSvc.RestoreVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
	if err != nil {
		h.handleServiceError(w, err, "failed to restore product space version")
		return
	}

	h.writeJSON(w, http.StatusOK, item)
}

// DownloadVersion 处理 GET /api/v1/workspaces/{id}/product-space/items/{itemId}/download。
// 通过 query 参数 version 指定版本，必须提供有效的版本号。
func (h *Handler) DownloadVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	version := -1
	if v := r.URL.Query().Get("version"); v != "" {
		version, err = strconv.Atoi(v)
		if err != nil {
			h.writeError(w, http.StatusBadRequest, errMsgInvalidVersion)
			return
		}
	}

	filename, data, err := h.itemSvc.DownloadVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
	if err != nil {
		h.handleServiceError(w, err, "failed to download product space version")
		return
	}

	contentType := http.DetectContentType(data)
	encoded := rfc5987Encode(filename)
	w.Header().Set("Content-Disposition", "attachment; filename*=utf-8''"+encoded)
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// Folders 处理 POST / DELETE /api/v1/workspaces/{id}/product-space/folders。
func (h *Handler) Folders(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost, http.MethodDelete) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	workspaceID := h.workspaceID(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	switch r.Method {
	case http.MethodPost:
		var req object.CreateFolderRequest
		if !h.decodeJSONBody(w, r, &req) {
			return
		}
		if req.Category == "" || req.Name == "" {
			h.writeError(w, http.StatusBadRequest, errMsgCategoryNameRequired)
			return
		}
		if err := h.folderSvc.CreateFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "failed to create product space folder")
			return
		}
		w.WriteHeader(http.StatusCreated)
	case http.MethodDelete:
		// DELETE 请求使用 query 参数而非请求体，避免部分代理/客户端不支持 DELETE body。
		q := r.URL.Query()
		req := object.DeleteFolderRequest{
			Category: q.Get("category"),
			Name:     q.Get("name"),
		}
		if req.Category == "" || req.Name == "" {
			h.writeError(w, http.StatusBadRequest, errMsgCategoryNameRequired)
			return
		}
		if err := h.folderSvc.DeleteFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "failed to delete product space folder")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// itemResponse 是 GetItem 的响应结构，包含条目元数据及其内容。
type itemResponse struct {
	*object.ProductSpaceItem
	Content string `json:"content"`
}
