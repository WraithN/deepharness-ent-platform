package productspace

import (
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
)

// CreateShare 处理 POST /api/v1/workspaces/{id}/product-space/share：
// 为指定产品（prototypes 一级目录）创建免登录分享链接，需 PM 权限，幂等。
func (h *Handler) CreateShare(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
	var req object.CreatePrototypeShareRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}
	if req.ProductFolder == "" {
		h.writeError(w, http.StatusBadRequest, "product_folder is required")
		return
	}

	share, err := h.protoShareSvc.CreatePrototypeShare(r.Context(), h.workspaceID(r), userID, req.ProductFolder)
	if err != nil {
		h.handleServiceError(w, err, "failed to create prototype share")
		return
	}
	h.writeJSON(w, http.StatusCreated, share)
}

// SharedPrototype 处理 GET /api/v1/shares/proto/{token}：免登录获取分享产品信息与页面列表。
func (h *Handler) SharedPrototype(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	token := r.PathValue("token")
	if token == "" {
		h.writeError(w, http.StatusBadRequest, "missing share token")
		return
	}

	view, err := h.protoShareSvc.GetSharedPrototype(token)
	if err != nil {
		h.handleServiceError(w, err, "failed to get shared prototype")
		return
	}
	h.writeJSON(w, http.StatusOK, view)
}

// ServeSharedPrototype 处理 GET /api/v1/shares/proto/{token}/files/{path...}：
// 免登录 serve 产品目录下文件，HTML 自动注入标注脚本与样式。
func (h *Handler) ServeSharedPrototype(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	token := r.PathValue("token")
	path := r.PathValue("path")
	if token == "" || path == "" {
		h.writeError(w, http.StatusBadRequest, "token and path are required")
		return
	}

	data, contentType, err := h.protoShareSvc.ServeSharedFile(token, path)
	if err != nil {
		h.handleServiceError(w, err, "failed to serve shared prototype file")
		return
	}

	if strings.Contains(contentType, "text/html") {
		data = rewritePrototypeAssetPaths(data)
		data = injectPrototypeAnnotationScript(data)
	}

	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// SharedPrototypeComments 处理 GET /api/v1/shares/proto/{token}/pages/{itemId}/comments：
// 免登录查看指定页面的批注列表。
func (h *Handler) SharedPrototypeComments(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	token := r.PathValue("token")
	itemID := r.PathValue("itemId")
	if token == "" || itemID == "" {
		h.writeError(w, http.StatusBadRequest, "token and itemId are required")
		return
	}

	comments, err := h.protoShareSvc.ListSharedComments(token, itemID)
	if err != nil {
		h.handleServiceError(w, err, "failed to list shared prototype comments")
		return
	}
	h.writeJSON(w, http.StatusOK, comments)
}
