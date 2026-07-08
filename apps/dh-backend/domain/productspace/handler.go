package productspace

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"strconv"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

const (
	// maxRequestBodySize 限制请求体大小为 70MB，足以覆盖 50MB 原型文件的 base64 编码。
	maxRequestBodySize = 70 * 1024 * 1024

	errMsgMethodNotAllowed     = "method not allowed"
	errMsgInvalidRequestBody   = "invalid request body"
	errMsgTypeTitleRequired    = "type and title are required"
	errMsgCategoryNameRequired = "category and name are required"
	errMsgInvalidVersion       = "invalid version"
	errMsgNotFound             = "not found"
	errMsgForbidden            = "forbidden"
	errMsgUnauthorized         = "unauthorized"
)

// Handler 是 product-space 模块的 HTTP 处理器。
type Handler struct {
	svc service.ProductSpaceService
}

// NewHandler 创建 product-space HTTP 处理器。
func NewHandler(svc service.ProductSpaceService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) workspaceID(r *http.Request) string {
	return r.PathValue("id")
}

func (h *Handler) itemID(r *http.Request) string {
	return r.PathValue("itemId")
}

func (h *Handler) userID(r *http.Request) (string, error) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok || userID == "" {
		return "", errors.New(errMsgUnauthorized)
	}
	return userID, nil
}

// requireMethod 校验请求方法是否在允许列表中，不在则返回 405。
func (h *Handler) requireMethod(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, m := range methods {
		if r.Method == m {
			return true
		}
	}
	h.writeError(w, http.StatusMethodNotAllowed, errMsgMethodNotAllowed)
	return false
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (h *Handler) writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"code":    status,
		"message": message,
	})
}

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

	tree, err := h.svc.GetTree(r.Context(), h.workspaceID(r), userID)
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, errMsgInvalidRequestBody)
		return
	}

	if req.Type == "" || req.Title == "" {
		h.writeError(w, http.StatusBadRequest, errMsgTypeTitleRequired)
		return
	}

	item, err := h.svc.CreateItem(r.Context(), h.workspaceID(r), userID, req)
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
		item, data, err := h.svc.GetItem(r.Context(), workspaceID, userID, itemID)
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
		if err := h.svc.DeleteItem(r.Context(), workspaceID, userID, itemID); err != nil {
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, errMsgInvalidRequestBody)
		return
	}

	item, err := h.svc.UpdateContent(r.Context(), h.workspaceID(r), userID, h.itemID(r), req)
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

	versions, err := h.svc.ListVersions(r.Context(), h.workspaceID(r), userID, h.itemID(r))
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

	item, err := h.svc.RestoreVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
	if err != nil {
		h.handleServiceError(w, err, "failed to restore product space version")
		return
	}

	h.writeJSON(w, http.StatusOK, item)
}

// DownloadVersion 处理 GET /api/v1/workspaces/{id}/product-space/items/{itemId}/download。
// 通过 query 参数 version 指定版本，缺省时下载当前版本。
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

	filename, data, err := h.svc.DownloadVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
	if err != nil {
		h.handleServiceError(w, err, "failed to download product space version")
		return
	}

	contentType := http.DetectContentType(data)
	encoded := mime.QEncoding.Encode("utf-8", filename)
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
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, errMsgInvalidRequestBody)
			return
		}
		if req.Category == "" || req.Name == "" {
			h.writeError(w, http.StatusBadRequest, errMsgCategoryNameRequired)
			return
		}
		if err := h.svc.CreateFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "failed to create product space folder")
			return
		}
		w.WriteHeader(http.StatusCreated)
	case http.MethodDelete:
		var req object.DeleteFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, errMsgInvalidRequestBody)
			return
		}
		if req.Category == "" || req.Name == "" {
			h.writeError(w, http.StatusBadRequest, errMsgCategoryNameRequired)
			return
		}
		if err := h.svc.DeleteFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "failed to delete product space folder")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleServiceError 统一处理服务层错误，按错误类型映射为对应的 HTTP 状态码。
func (h *Handler) handleServiceError(w http.ResponseWriter, err error, defaultMsg string) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		h.writeError(w, http.StatusNotFound, errMsgNotFound)
	case errors.Is(err, service.ErrForbidden):
		h.writeError(w, http.StatusForbidden, errMsgForbidden)
	case errors.Is(err, service.ErrInvalidInput):
		h.writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrConflict):
		h.writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrUnauthorized):
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
	default:
		h.writeError(w, http.StatusInternalServerError, defaultMsg)
	}
}

// itemResponse 是 GetItem 的响应结构，包含条目元数据及其内容。
type itemResponse struct {
	*object.ProductSpaceItem
	Content string `json:"content"`
}
