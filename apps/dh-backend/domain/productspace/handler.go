package productspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"

	gatewayhandler "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

// WorkItemDocLinker 抽象了 import_handler 对 workitem 服务的最小依赖。
type WorkItemDocLinker interface {
	GetWorkItem(ctx context.Context, workspaceID, workitemID string) (workitem.WorkItem, error)
	CreateDocLink(ctx context.Context, req CreateDocLinkRequest) error
	CreateDesignVersion(ctx context.Context, workspaceID, workitemID, docID string) (workitem.WorkItem, error)
}

// ProcessService 是 productspace handler 对流程服务的最小依赖，
// 用于在流程交付物分享接口中解析流程对应的工作项负责人。
type ProcessService interface {
	GetByID(ctx context.Context, id string) (processobject.Process, error)
}

// CreateDocLinkRequest 是 productspace 内部使用的文档关联请求，避免依赖 workitem/object。
type CreateDocLinkRequest struct {
	WorkspaceID        string
	WorkitemID         string
	ProductSpaceItemID string
	ItemType           string
}

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
.dh-annotate-mode [data-dh-id]:hover { outline: 2px dashed #ef4444 !important; }
.dh-marker-focus { background: #f59e0b !important; transform: translate(-50%, -50%) scale(1.8) !important; z-index: 10000 !important; animation: dh-marker-pulse 0.5s ease-in-out 4; }
@keyframes dh-marker-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1.8); } 50% { transform: translate(-50%, -50%) scale(2.6); } }`

	prototypeAnnotationScript = `(function() {
  var MARKER_CLASS = 'dh-prototype-marker';
  var annotateMode = false;
  // 分享页只读模式下标记可点击，点击后向父窗口回传批注 id 供展示详情。
  var markerClickable = false;

  function removeMarkers() {
    var nodes = document.querySelectorAll('.' + MARKER_CLASS);
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  // 创建单个标记节点，并绑定点击、悬停/离开事件。
  // 使用独立闭包，避免 var 循环导致所有回调引用同一 marker 对象。
  function createMarker(m) {
    var el = document.createElement('div');
    el.className = MARKER_CLASS;
    el.setAttribute('data-comment-id', m.id || '');
    el.style.position = 'absolute';
    el.style.left = (m.x || 0) + 'px';
    el.style.top = (m.y || 0) + 'px';
    el.style.minWidth = '22px';
    el.style.height = '22px';
    el.style.padding = '0 5px';
    el.style.background = '#ef4444';
    el.style.border = '2px solid #ffffff';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    el.style.zIndex = '9999';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.color = '#ffffff';
    el.style.fontSize = '12px';
    el.style.fontWeight = 'bold';
    el.style.lineHeight = '1';
    el.style.boxSizing = 'border-box';
    el.textContent = m.seq != null ? String(m.seq) : '';

    // 可点击模式下允许指针事件并绑定点击、悬停/离开回传，便于分享页查看批注详情
    if (markerClickable) {
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        window.parent.postMessage({ type: 'dh-marker-click', id: m.id || '' }, '*');
      });
      el.addEventListener('mouseenter', function(e) {
        window.parent.postMessage({ type: 'dh-marker-hover', id: m.id || '', clientX: e.clientX, clientY: e.clientY }, '*');
      });
      el.addEventListener('mouseleave', function() {
        window.parent.postMessage({ type: 'dh-marker-leave' }, '*');
      });
    } else {
      el.style.pointerEvents = 'none';
    }
    document.body.appendChild(el);
  }

  function renderMarkers(markers) {
    removeMarkers();
    if (!markers) return;
    for (var i = 0; i < markers.length; i++) {
      createMarker(markers[i]);
    }
  }

  function setAnnotateMode(active) {
    annotateMode = active;
    document.body.classList.toggle('dh-annotate-mode', active);
  }

  // 定位并高亮指定批注标记：滚动到标记位置并触发闪烁动画
  function focusMarker(id) {
    if (!id) return;
    var el = document.querySelector('.' + MARKER_CLASS + '[data-comment-id="' + id + '"]');
    if (!el) return;
    if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    el.classList.add('dh-marker-focus');
    setTimeout(function() { el.classList.remove('dh-marker-focus'); }, 2200);
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
    } else if (data.type === 'dh-set-marker-clickable') {
      markerClickable = !!data.active;
    } else if (data.type === 'dh-focus-marker') {
      focusMarker(data.id);
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
	itemSvc       service.ProductSpaceItemService
	folderSvc     service.ProductSpaceFolderService
	commentSvc    service.ProductSpaceCommentService
	fileSvc       service.ProductSpaceFileService
	protoShareSvc service.ProductSpacePrototypeShareService
	reqShareSvc   service.ProductSpaceRequirementShareService
	importSvc     service.ProductSpaceImportService
	cleanupSvc    service.ProductSpaceCleanupTaskService
	workItemSvc   WorkItemDocLinker
	processSvc    ProcessService
}

// NewHandler 创建 product-space HTTP 处理器。
func NewHandler(svc service.ProductSpaceService, processSvc ProcessService, workItemSvc WorkItemDocLinker) *Handler {
	return &Handler{
		itemSvc:       svc,
		folderSvc:     svc,
		commentSvc:    svc,
		fileSvc:       svc,
		protoShareSvc: svc,
		reqShareSvc:   svc,
		importSvc:     svc,
		cleanupSvc:    svc,
		workItemSvc:   workItemSvc,
		processSvc:    processSvc,
	}
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
