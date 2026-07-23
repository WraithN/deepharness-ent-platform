package productspace

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"

	gatewayhandler "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
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

// 注入到原型页面中的标注脚本与样式，用于在 iframe 预览中实现点击标注和标记回显。
const (
	prototypeAnnotationStyle = `.dh-annotate-mode, .dh-annotate-mode * { cursor: crosshair !important; }
.dh-annotate-mode [data-dh-id]:hover { outline: 2px dashed #ef4444 !important; }`

	prototypeAnnotationScript = `(function() {
  var MARKER_CLASS = 'dh-prototype-marker';
  var annotateMode = false;

  function removeMarkers() {
    var nodes = document.querySelectorAll('.' + MARKER_CLASS);
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  function renderMarkers(markers) {
    removeMarkers();
    if (!markers) return;
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var el = document.createElement('div');
      el.className = MARKER_CLASS;
      el.style.position = 'absolute';
      el.style.left = (m.x || 0) + 'px';
      el.style.top = (m.y || 0) + 'px';
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.background = '#ef4444';
      el.style.border = '2px solid #ffffff';
      el.style.borderRadius = '50%';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      el.style.zIndex = '9999';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.pointerEvents = 'none';
      el.title = (m.userName || '') + ': ' + (m.content || '');
      document.body.appendChild(el);
    }
  }

  function setAnnotateMode(active) {
    annotateMode = active;
    document.body.classList.toggle('dh-annotate-mode', active);
  }

  function getSelector(el) {
    var dh = el.closest ? el.closest('[data-dh-id]') : null;
    if (dh && dh.getAttribute('data-dh-id')) return '[data-dh-id="' + dh.getAttribute('data-dh-id') + '"]';
    if (el.id) return '#' + el.id;
    var path = [];
    var node = el;
    while (node && node !== document.body) {
      var tag = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.split(/\\s+/).filter(function(c) { return c && c.indexOf('dh-') !== 0; }).join('.');
        if (cls) tag += '.' + cls;
      }
      path.unshift(tag);
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  window.addEventListener('message', function(e) {
    var data = e.data || {};
    if (data.type === 'dh-render-markers') {
      renderMarkers(data.markers);
    } else if (data.type === 'dh-set-annotate-mode') {
      setAnnotateMode(!!data.active);
    }
  });

  document.addEventListener('click', function(e) {
    if (!annotateMode) return;
    e.preventDefault();
    e.stopPropagation();
    var target = e.target;
    var selector = getSelector(target);
    var rect = target.getBoundingClientRect();
    var x = rect.left + rect.width / 2 + window.scrollX;
    var y = rect.top + rect.height / 2 + window.scrollY;
    var text = (target.innerText || target.textContent || '').slice(0, 200);
    window.parent.postMessage({
      type: 'dh-annotate-click',
      selector: selector,
      targetText: text,
      x: x,
      y: y
    }, '*');
  }, true);
})();`
)

// injectPrototypeAnnotationScript 将标注脚本与样式注入 HTML 页面，优先放在 </body> 前。
func injectPrototypeAnnotationScript(html []byte) []byte {
	block := []byte(
		"<style>" + gatewayhandler.ScaffoldCSS + "</style>" +
			"<script>" + gatewayhandler.ScaffoldJS + "</script>" +
			"<style>" + prototypeAnnotationStyle + "</style>" +
			"<script id=\"dh-prototype-annotation-script\">" + prototypeAnnotationScript + "</script>",
	)
	if bytes.Contains(html, []byte("</body>")) {
		return bytes.Replace(html, []byte("</body>"), append(block, []byte("</body>")...), 1)
	}
	if bytes.Contains(html, []byte("</html>")) {
		return bytes.Replace(html, []byte("</html>"), append(block, []byte("</html>")...), 1)
	}
	return append(html, block...)
}

// Handler 是 product-space 模块的 HTTP 处理器。
type Handler struct {
	svc service.ProductSpaceService
}

// NewHandler 创建 product-space HTTP 处理器。
func NewHandler(svc service.ProductSpaceService) *Handler {
	return &Handler{svc: svc}
}

// decodeJSONBody 解析请求 JSON 体，遇到请求体过大时返回 413，其他解析错误返回 400。
func (h *Handler) decodeJSONBody(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			h.writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		h.writeError(w, http.StatusBadRequest, errMsgInvalidRequestBody)
		return false
	}
	return true
}

// rfc5987Encode 对字符串进行 RFC 5987 编码，用于 Content-Disposition 的 filename* 参数。
func rfc5987Encode(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') ||
			r == '-' || r == '.' || r == '_' || r == '~' {
			b.WriteRune(r)
		} else {
			for _, bb := range []byte(string(r)) {
				b.WriteString(fmt.Sprintf("%%%02X", bb))
			}
		}
	}
	return b.String()
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
	if !h.decodeJSONBody(w, r, &req) {
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
	if !h.decodeJSONBody(w, r, &req) {
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

	filename, data, err := h.svc.DownloadVersion(r.Context(), h.workspaceID(r), userID, h.itemID(r), version)
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
		if err := h.svc.CreateFolder(r.Context(), workspaceID, userID, req); err != nil {
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
		if err := h.svc.DeleteFolder(r.Context(), workspaceID, userID, req); err != nil {
			h.handleServiceError(w, err, "failed to delete product space folder")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

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
		comments, err := h.svc.ListComments(r.Context(), workspaceID, userID, itemID)
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
		comment, err := h.svc.AddComment(r.Context(), workspaceID, userID, itemID, req)
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

	data, contentType, err := h.svc.ServeFile(r.Context(), workspaceID, userID, path)
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

// handleServiceError 统一处理服务层错误，按错误类型映射为对应的 HTTP 状态码。
func (h *Handler) handleServiceError(w http.ResponseWriter, err error, defaultMsg string) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		h.writeError(w, http.StatusNotFound, errMsgNotFound)
	case errors.Is(err, service.ErrForbidden):
		h.writeError(w, http.StatusForbidden, errMsgForbidden)
	case errors.Is(err, service.ErrInvalidInput):
		msg := strings.TrimPrefix(err.Error(), service.ErrInvalidInput.Error()+": ")
		h.writeError(w, http.StatusBadRequest, msg)
	case errors.Is(err, service.ErrConflict):
		msg := strings.TrimPrefix(err.Error(), service.ErrConflict.Error()+": ")
		h.writeError(w, http.StatusConflict, msg)
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
