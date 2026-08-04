// Package handler 提供 crawler cookie 管理的 HTTP 接口。
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

// CrawlerHandler 处理 crawler session 相关请求。
type CrawlerHandler struct {
	svc *service.CrawlerCookieService
}

// NewCrawlerHandler 创建 crawler handler。
func NewCrawlerHandler(svc *service.CrawlerCookieService) *CrawlerHandler {
	return &CrawlerHandler{svc: svc}
}

// SaveCookies 保存指定 workspace + domain 的 cookie 列表。
// POST /api/v1/workspaces/{workspaceId}/crawler-sessions
func (h *CrawlerHandler) SaveCookies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return
	}

	var req object.SaveCookiesRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	if req.Domain == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "domain is required")
		return
	}

	if err := h.svc.Save(userID, workspaceID, req.Domain, req.Cookies); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}

	handler.SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// GetCookies 读取指定 workspace + domain 的 cookie 列表。
// GET /api/v1/workspaces/{workspaceId}/crawler-sessions/{domain}
func (h *CrawlerHandler) GetCookies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	domain, ok := handler.PathValueOr404(w, r, "domain")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return
	}

	cookies, err := h.svc.Load(userID, workspaceID, domain)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	if cookies == nil {
		cookies = []object.Cookie{}
	}

	handler.SetJSONHeader(w)
	_ = json.NewEncoder(w).Encode(map[string]any{"domain": domain, "cookies": cookies})
}
