package productspace

import (
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
)

// CreateRequirementShare 处理 POST /api/v1/workspaces/{id}/requirement-shares：
// 创建需求级统一分享链接（文档+原型），需 PM 权限，幂等。
func (h *Handler) CreateRequirementShare(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodPost) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
	var req object.CreateRequirementShareRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}
	if req.DocID == "" && req.ProductFolder == "" {
		h.writeError(w, http.StatusBadRequest, "doc_id 或 product_folder 至少提供一个")
		return
	}

	share, err := h.reqShareSvc.CreateRequirementShare(r.Context(), h.workspaceID(r), userID, req)
	if err != nil {
		h.handleServiceError(w, err, "failed to create requirement share")
		return
	}
	h.writeJSON(w, http.StatusCreated, share)
}

// GetOrCreateRequirementShare 处理 GET /api/v1/workspaces/{id}/requirement-shares/view：
// 为工作空间任意成员获取需求级分享链接（无需 PM 权限），幂等。
// 查询参数：doc_id、product_folder、proto_item_id、title、allow_comments（可选）。
func (h *Handler) GetOrCreateRequirementShare(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	userID, err := h.userID(r)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, errMsgUnauthorized)
		return
	}

	q := r.URL.Query()
	req := object.CreateRequirementShareRequest{
		DocID:         q.Get("doc_id"),
		ProductFolder: q.Get("product_folder"),
		ProtoItemID:   q.Get("proto_item_id"),
		Title:         q.Get("title"),
		AllowComments: q.Get("allow_comments") == "true",
	}
	if req.DocID == "" && req.ProductFolder == "" && req.ProtoItemID == "" {
		h.writeError(w, http.StatusBadRequest, "doc_id、product_folder 或 proto_item_id 至少提供一个")
		return
	}

	share, err := h.reqShareSvc.GetOrCreateRequirementShare(r.Context(), h.workspaceID(r), userID, req)
	if err != nil {
		h.handleServiceError(w, err, "failed to get or create requirement share")
		return
	}
	h.writeJSON(w, http.StatusOK, share)
}

// SharedRequirement 处理 GET /api/v1/requirement-shares/{token}：
// 免登录获取需求级统一分享视图（文档+原型）。
func (h *Handler) SharedRequirement(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	token := r.PathValue("token")
	if token == "" {
		h.writeError(w, http.StatusBadRequest, "missing share token")
		return
	}

	view, err := h.reqShareSvc.GetSharedRequirement(token)
	if err != nil {
		h.handleServiceError(w, err, "failed to get shared requirement")
		return
	}
	h.writeJSON(w, http.StatusOK, view)
}

// ServeSharedRequirementFile 处理 GET /api/v1/requirement-shares/{token}/files/{path...}：
// 免登录 serve 需求分享中的原型文件，HTML 自动注入标注脚本与样式。
func (h *Handler) ServeSharedRequirementFile(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet) {
		return
	}

	token := r.PathValue("token")
	path := r.PathValue("path")
	if token == "" || path == "" {
		h.writeError(w, http.StatusBadRequest, "token and path are required")
		return
	}

	data, contentType, err := h.reqShareSvc.ServeSharedRequirementFile(token, path)
	if err != nil {
		h.handleServiceError(w, err, "failed to serve shared requirement file")
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

// RequirementShareComments 处理 GET / POST /api/v1/requirement-shares/{token}/pages/{itemId}/comments：
// 免登录查看/新增需求分享中指定原型页面的批注。
func (h *Handler) RequirementShareComments(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet, http.MethodPost) {
		return
	}

	token := r.PathValue("token")
	itemID := r.PathValue("itemId")
	if token == "" || itemID == "" {
		h.writeError(w, http.StatusBadRequest, "token and itemId are required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		comments, err := h.reqShareSvc.ListRequirementShareComments(token, itemID)
		if err != nil {
			h.handleServiceError(w, err, "failed to list requirement share comments")
			return
		}
		h.writeJSON(w, http.StatusOK, comments)
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
		var req object.AddCommentRequest
		if !h.decodeJSONBody(w, r, &req) {
			return
		}
		comment, err := h.reqShareSvc.AddRequirementSharePrototypeComment(token, itemID, req)
		if err != nil {
			h.handleServiceError(w, err, "failed to add requirement share prototype comment")
			return
		}
		h.writeJSON(w, http.StatusCreated, comment)
	}
}

// RequirementShareDocComments 处理 GET / POST /api/v1/requirement-shares/{token}/doc-comments：
// 免登录查看/新增需求分享中文档的文本批注。
func (h *Handler) RequirementShareDocComments(w http.ResponseWriter, r *http.Request) {
	if !h.requireMethod(w, r, http.MethodGet, http.MethodPost) {
		return
	}

	token := r.PathValue("token")
	if token == "" {
		h.writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		comments, err := h.reqShareSvc.ListRequirementShareDocComments(token)
		if err != nil {
			h.handleServiceError(w, err, "failed to list requirement share doc comments")
			return
		}
		h.writeJSON(w, http.StatusOK, comments)
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
		var req object.AddRequirementShareDocCommentRequest
		if !h.decodeJSONBody(w, r, &req) {
			return
		}
		comment, err := h.reqShareSvc.AddRequirementShareDocComment(token, req)
		if err != nil {
			h.handleServiceError(w, err, "failed to add requirement share doc comment")
			return
		}
		h.writeJSON(w, http.StatusCreated, comment)
	}
}
