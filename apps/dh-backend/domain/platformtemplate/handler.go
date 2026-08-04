// Package platformtemplate 处理平台模板模块的 HTTP 请求。
package platformtemplate

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/platformtemplate/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/platformtemplate/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

var defaultPlatformTemplateService service.PlatformTemplateService

// Init 注入平台模板服务实例。
func Init(svc service.PlatformTemplateService) {
	defaultPlatformTemplateService = svc
}

// Templates 处理 /api/v1/templates 的 GET（列表）与 POST（创建）。
// GET 允许已登录用户访问：超级管理员返回全部模板，其他用户仅返回已发布模板。
func Templates(w http.ResponseWriter, r *http.Request) {
	if defaultPlatformTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "platform template service not initialized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		category := r.URL.Query().Get("category")
		if category == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "category is required")
			return
		}
		// 已登录即可查看；具体可见范围由 super admin 身份决定
		if _, ok := middleware.UserIDFromContext(r.Context()); !ok {
			handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
			return
		}
		publishedOnly := !identity.IsSuperAdmin(r)
		if r.URL.Query().Get("published") == "true" {
			publishedOnly = true
		}
		templates, err := defaultPlatformTemplateService.ListByCategory(category, publishedOnly)
		if err != nil {
			handleTemplateError(w, err, "template not found", "failed to list templates")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(templates)
	case http.MethodPost:
		if !identity.RequireSuperAdmin(w, r) {
			return
		}
		var req object.PlatformTemplate
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		created, err := defaultPlatformTemplateService.Create(req)
		if err != nil {
			handleTemplateError(w, err, "template not found", "failed to create template")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(created)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// TemplateByKey 处理 /api/v1/templates/{key} 的 PUT（更新）与 DELETE（删除）。
func TemplateByKey(w http.ResponseWriter, r *http.Request) {
	if !identity.RequireSuperAdmin(w, r) {
		return
	}
	if defaultPlatformTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "platform template service not initialized")
		return
	}

	key, ok := handler.PathValueOr404(w, r, "key")
	if !ok {
		return
	}
	category := r.URL.Query().Get("category")
	if category == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "category is required")
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req object.PlatformTemplate
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		updated, err := defaultPlatformTemplateService.Update(key, category, req)
		if err != nil {
			handleTemplateError(w, err, "template not found", "failed to update template")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(updated)
	case http.MethodDelete:
		if err := defaultPlatformTemplateService.Delete(key, category); err != nil {
			handleTemplateError(w, err, "template not found", "failed to delete template")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// TemplatePublish 处理 /api/v1/templates/{key}/publish 的 PUT（发布/下架）。
func TemplatePublish(w http.ResponseWriter, r *http.Request) {
	if !identity.RequireSuperAdmin(w, r) {
		return
	}
	if defaultPlatformTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "platform template service not initialized")
		return
	}
	if r.Method != http.MethodPut {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	key, ok := handler.PathValueOr404(w, r, "key")
	if !ok {
		return
	}
	category := r.URL.Query().Get("category")
	if category == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "category is required")
		return
	}

	var req struct {
		Published bool `json:"published"`
	}
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	if err := defaultPlatformTemplateService.Publish(key, category, req.Published); err != nil {
		handleTemplateError(w, err, "template not found", "failed to publish template")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// reorderRequest 是模板排序请求体。
type reorderRequest struct {
	Keys []string `json:"keys"`
}

// TemplatesOrder 处理 /api/v1/templates/order 的 PUT（排序）。
func TemplatesOrder(w http.ResponseWriter, r *http.Request) {
	if !identity.RequireSuperAdmin(w, r) {
		return
	}
	if defaultPlatformTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "platform template service not initialized")
		return
	}
	if r.Method != http.MethodPut {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	category := r.URL.Query().Get("category")
	if category == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "category is required")
		return
	}

	var req reorderRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	if err := defaultPlatformTemplateService.UpdateOrder(category, req.Keys); err != nil {
		handleTemplateError(w, err, "template not found", "failed to reorder templates")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// isValidationError 判断服务层错误是否为可预见的业务校验错误。
func isValidationError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "required") ||
		strings.Contains(msg, "invalid category") ||
		strings.Contains(msg, "already exists") ||
		strings.Contains(msg, "limit reached") ||
		strings.Contains(msg, "published templates") ||
		strings.Contains(msg, "not published")
}

// handleTemplateError 统一处理模板服务错误：校验错误返回 400，not found 返回 404，其余返回 500。
func handleTemplateError(w http.ResponseWriter, err error, notFoundMsg, defaultMsg string) {
	if isValidationError(err) {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, err.Error())
		return
	}
	handler.HandleServiceError(w, err, notFoundMsg, defaultMsg)
}
