package productspace

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

// Handler 是 product-space 模块的 HTTP 处理器。
type Handler struct {
	svc service.ProductSpaceService
}

// NewHandler 创建 product-space HTTP 处理器。
func NewHandler(svc service.ProductSpaceService) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes 向 ServeMux 注册 product-space 相关路由。
// 所有路由均位于 /api/v1/workspaces/{id}/product-space 下，调用方应使用 auth 中间件保护。
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	base := "/api/v1/workspaces/"
	mux.HandleFunc(base+"{id}/product-space/tree", h.GetTree)
	mux.HandleFunc(base+"{id}/product-space/items", h.CreateItem)
	mux.HandleFunc(base+"{id}/product-space/items/{itemId}", h.ItemByID)
	mux.HandleFunc(base+"{id}/product-space/items/{itemId}/content", h.UpdateContent)
	mux.HandleFunc(base+"{id}/product-space/items/{itemId}/versions", h.ListVersions)
	mux.HandleFunc(base+"{id}/product-space/items/{itemId}/versions/{version}/restore", h.RestoreVersion)
	mux.HandleFunc(base+"{id}/product-space/items/{itemId}/download", h.DownloadVersion)
	mux.HandleFunc(base+"{id}/product-space/folders", h.Folders)
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
		return "", errors.New("unauthorized")
	}
	return userID, nil
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (h *Handler) writeError(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, map[string]string{"error": message})
}

// GetTree 处理 GET /api/v1/workspaces/{id}/product-space/tree，返回产品空间目录树。
func (h *Handler) GetTree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	tree, err := h.svc.GetTree(r.Context(), h.workspaceID(r), userID)
	if err != nil {
		h.handleServiceError(w, err, "product space not found", "failed to get product space tree")
		return
	}

	h.writeJSON(w, http.StatusOK, tree)
}

// CreateItem 处理 POST /api/v1/workspaces/{id}/product-space/items，创建文档或原型。
func (h *Handler) CreateItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var req object.CreateItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Type == "" || req.Title == "" {
		h.writeError(w, http.StatusBadRequest, "type and title are required")
		return
	}

	item, err := h.svc.CreateItem(r.Context(), h.workspaceID(r), userID, req)
	if err != nil {
		h.handleServiceError(w, err, "product space item not found", "failed to create product space item")
		return
	}

	h.writeJSON(w, http.StatusCreated, item)
}

// ItemByID 处理 GET / DELETE /api/v1/workspaces/{id}/product-space/items/{itemId}。
func (h *Handler) ItemByID(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	workspaceID := h.workspaceID(r)
	itemID := h.itemID(r)

	switch r.Method {
	case http.MethodGet:
		item, data, err := h.svc.GetItem(r.Context(), workspaceID, userID, itemID)
		if err != nil {
			h.handleServiceError(w, err, "product space item not found", "failed to get product space item")
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
			h.handleServiceError(w, err, "product space item not found", "failed to delete product space item")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// UpdateContent 处理 PUT /api/v1/workspaces/{id}/product-space/items/{itemId}/content。
func (h *Handler) UpdateContent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var req object.UpdateContentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	item, err := h.svc.UpdateContent(r.Context(), h.workspaceID(r), userID, h.itemID(r), req)
	if err != nil {
		h.handleServiceError(w, err, "product space item not found", "failed to update product space content")
		return
	}

	h.writeJSON(w, http.StatusOK, item)
}

// ListVersions 处理 GET /api/v1/workspaces/{id}/product-space/items/{itemId}/versions。
func (h *Handler) ListVersions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	versions, err := h.svc.ListVersions(r.Context(), h.workspaceID(r), userID, h.itemID(r))
	if err != nil {
		h.handleServiceError(w, err, "product space item not found", "failed to list product space versions")
		return
	}

	h.writeJSON(w, http.StatusOK, versions)
}

// RestoreVersion 处理 POST /api/v1/workspaces/{id}/product-space/items/{itemId}/versions/{version}/restore。
func (h *Handler) RestoreVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	version, err := strconv.Atoi(r.PathValue("version"))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid version")
		return
	}

	item, err := h.svc.RestoreVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
	if err != nil {
		h.handleServiceError(w, err, "product space version not found", "failed to restore product space version")
		return
	}

	h.writeJSON(w, http.StatusOK, item)
}

// DownloadVersion 处理 GET /api/v1/workspaces/{id}/product-space/items/{itemId}/download。
// 通过 query 参数 version 指定版本，缺省时下载当前版本。
func (h *Handler) DownloadVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	version := -1
	if v := r.URL.Query().Get("version"); v != "" {
		version, err = strconv.Atoi(v)
		if err != nil {
			h.writeError(w, http.StatusBadRequest, "invalid version")
			return
		}
	}

	filename, data, err := h.svc.DownloadVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
	if err != nil {
		h.handleServiceError(w, err, "product space item or version not found", "failed to download product space version")
		return
	}

	contentType := http.DetectContentType(data)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// Folders 处理 POST / DELETE /api/v1/workspaces/{id}/product-space/folders。
func (h *Handler) Folders(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	workspaceID := h.workspaceID(r)

	switch r.Method {
	case http.MethodPost:
		var req object.CreateFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if req.Category == "" || req.Name == "" {
			h.writeError(w, http.StatusBadRequest, "category and name are required")
			return
		}
		if err := h.svc.CreateFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "product space folder not found", "failed to create product space folder")
			return
		}
		w.WriteHeader(http.StatusCreated)
	case http.MethodDelete:
		var req object.DeleteFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if req.Category == "" || req.Name == "" {
			h.writeError(w, http.StatusBadRequest, "category and name are required")
			return
		}
		if err := h.svc.DeleteFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "product space folder not found", "failed to delete product space folder")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleServiceError 统一处理服务层错误，识别 not found 返回 404。
func (h *Handler) handleServiceError(w http.ResponseWriter, err error, notFoundMsg, defaultMsg string) {
	if strings.Contains(err.Error(), "not found") {
		h.writeError(w, http.StatusNotFound, notFoundMsg)
		return
	}
	h.writeError(w, http.StatusInternalServerError, defaultMsg)
}

// itemResponse 是 GetItem 的响应结构，包含条目元数据及其内容。
type itemResponse struct {
	*object.ProductSpaceItem
	Content string `json:"content"`
}
