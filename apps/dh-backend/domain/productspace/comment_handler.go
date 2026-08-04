package productspace

import (
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
)

// Comments 处理 GET / POST /api/v1/workspaces/{id}/product-space/items/{itemId}/comments。
// GET 返回批注列表，POST 新增批注并返回包含用户名的完整对象。
func (h *Handler) Comments(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet, http.MethodPost) {
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
		comments, err := h.commentSvc.ListComments(r.Context(), workspaceID, userID, itemID)
		if err != nil {
			h.handleServiceError(w, err, "failed to list prototype comments")
			return
		}
		h.writeJSON(w, http.StatusOK, comments)
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
		var req object.AddCommentRequest
		if !h.decodeJSONBody(w, r, &req) {
			return
		}
		comment, err := h.commentSvc.AddComment(r.Context(), workspaceID, userID, itemID, req)
		if err != nil {
			h.handleServiceError(w, err, "failed to add prototype comment")
			return
		}
		h.writeJSON(w, http.StatusCreated, comment)
	}
}

// ServePrototype 处理 GET /api/v1/workspaces/{id}/product-space/serve/{path...}。
// 静态服务原型页面及其资源；返回 HTML 时自动注入标注脚本与样式。
func (h *Handler) ServePrototype(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	workspaceID := h.workspaceID(r)
	path := r.PathValue("path")
	if path == "" {
		h.writeError(w, http.StatusBadRequest, "serve path is required")
		return
	}

	data, contentType, err := h.fileSvc.ServeFile(r.Context(), workspaceID, userID, path)
	if err != nil {
		h.handleServiceError(w, err, "failed to serve prototype file")
		return
	}

	if strings.Contains(contentType, "text/html") {
		data = injectPrototypeAnnotationScript(data)
	}

	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
