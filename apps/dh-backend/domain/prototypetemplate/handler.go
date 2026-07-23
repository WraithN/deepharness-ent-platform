// Package prototypetemplate 处理原型工程模版模块的 HTTP 请求。
package prototypetemplate

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/prototypetemplate/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/prototypetemplate/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

// 上传相关常量。
const (
	// maxUploadMemory 限制 multipart 表单在内存中保留的大小，超出部分由 Go 自动落盘。
	maxUploadMemory = 32 << 20
	// maxZipSize 限制单个 zip 文件大小（50MB），模版源码不应包含 node_modules。
	maxZipSize = 50 << 20
)

var defaultPrototypeTemplateService service.PrototypeTemplateService

// 上传校验错误，集中定义以便统一文案。
var (
	errNameRequired  = errString("name is required")
	errFileRequired  = errString("zip file is required")
	errZipOnly       = errString("only .zip files are accepted")
	errZipTooLarge   = errString("zip file exceeds 50MB limit")
)

// errString 是一个简单的错误类型，避免重复 errors.New 样板。
type errString string

func (e errString) Error() string { return string(e) }

// Init 注入原型工程模版服务实例。
func Init(svc service.PrototypeTemplateService) {
	defaultPrototypeTemplateService = svc
}

// Templates 处理 /api/v1/proto-templates 的 GET（列表）与 POST（上传 zip）。
// 仅超级管理员可访问。
func Templates(w http.ResponseWriter, r *http.Request) {
	if !identity.RequireSuperAdmin(w, r) {
		return
	}
	if defaultPrototypeTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "prototype template service not initialized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		list, err := defaultPrototypeTemplateService.List()
		if err != nil {
			handler.HandleServiceError(w, err, "prototype template not found", "failed to list prototype templates")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		t, err := parseUpload(r)
		if err != nil {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
			return
		}
		created, err := defaultPrototypeTemplateService.CreateWithZip(t.name, t.description, t.tags, t.zipData)
		if err != nil {
			handleTemplateError(w, err)
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(created)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// TemplateByID 处理 /api/v1/proto-templates/{id} 的 GET（详情）、PUT（改元信息）、DELETE（删除）。
func TemplateByID(w http.ResponseWriter, r *http.Request) {
	if !identity.RequireSuperAdmin(w, r) {
		return
	}
	if defaultPrototypeTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "prototype template service not initialized")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		t, err := defaultPrototypeTemplateService.Get(id)
		if err != nil {
			handler.HandleServiceError(w, err, "prototype template not found", "failed to get prototype template")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(t)
	case http.MethodPut:
		var req object.UpdateMetaRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		updated, err := defaultPrototypeTemplateService.UpdateMeta(id, req)
		if err != nil {
			handleTemplateError(w, err)
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(updated)
	case http.MethodDelete:
		if err := defaultPrototypeTemplateService.Delete(id); err != nil {
			handler.HandleServiceError(w, err, "prototype template not found", "failed to delete prototype template")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// TemplateInstall 处理 /api/v1/proto-templates/{id}/install 的 POST（安装/更新依赖）。
// 同步执行 pnpm install，返回更新后的模版（含 install_log）。
func TemplateInstall(w http.ResponseWriter, r *http.Request) {
	if !identity.RequireSuperAdmin(w, r) {
		return
	}
	if defaultPrototypeTemplateService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "prototype template service not initialized")
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	t, err := defaultPrototypeTemplateService.InstallDeps(id)
	if err != nil {
		handler.HandleServiceError(w, err, "prototype template not found", "failed to install dependencies")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(t)
}

// uploadForm 收集上传表单解析结果。
type uploadForm struct {
	name        string
	description string
	tags        string
	zipData     []byte
}

// parseUpload 解析 multipart 上传表单，校验文件名与大小后读取 zip 内容。
func parseUpload(r *http.Request) (uploadForm, error) {
	if err := r.ParseMultipartForm(maxUploadMemory); err != nil {
		return uploadForm{}, err
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		return uploadForm{}, errNameRequired
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return uploadForm{}, errFileRequired
	}
	defer file.Close()
	if !strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		return uploadForm{}, errZipOnly
	}
	if header.Size > maxZipSize {
		return uploadForm{}, errZipTooLarge
	}
	zipData, err := io.ReadAll(io.LimitReader(file, maxZipSize+1))
	if err != nil {
		return uploadForm{}, err
	}
	if len(zipData) > maxZipSize {
		return uploadForm{}, errZipTooLarge
	}
	return uploadForm{
		name:        name,
		description: r.FormValue("description"),
		tags:        r.FormValue("tags"),
		zipData:     zipData,
	}, nil
}

// parseID 从路径参数 {id} 解析 int64，失败返回 400。
func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid id")
		return 0, false
	}
	return id, true
}

// handleTemplateError 统一处理模版服务错误：校验错误返回 400，not found 返回 404，其余返回 500。
func handleTemplateError(w http.ResponseWriter, err error) {
	msg := err.Error()
	if strings.Contains(msg, "required") || strings.Contains(msg, "already exists") {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, msg)
		return
	}
	handler.HandleServiceError(w, err, "prototype template not found", "failed to operate prototype template")
}
