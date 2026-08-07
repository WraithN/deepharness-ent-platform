package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// commandRequest 是创建/更新自定义指令的请求体。
type commandRequest struct {
	Cmd           string `json:"cmd"`
	Label         string `json:"label"`
	Desc          string `json:"desc"`
	Icon          string `json:"icon"`
	AllowTask     bool   `json:"allowTask"`
	AllowRepos    bool   `json:"allowRepos"`
	RequireRepos  bool   `json:"requireRepos"`
	RequireTask   bool   `json:"requireTask"`
	MaxRepos      int    `json:"maxRepos"`
	Enabled       bool   `json:"enabled"`
	Template      string `json:"template"`
	CometTemplate string `json:"cometTemplate"`
}

// 指令校验相关常量。
const (
	commandPrefixSlash = "/"
)

// superAdminChecker 由 server 注入的超管校验函数，避免 handler 包循环依赖 identity 包。
var superAdminChecker func(http.ResponseWriter, *http.Request) bool

// SetSuperAdminChecker 注入超管校验函数，在 server 初始化阶段调用。
func SetSuperAdminChecker(fn func(http.ResponseWriter, *http.Request) bool) {
	superAdminChecker = fn
}

// requireSuperAdmin 校验超管权限，未通过时已写入错误响应。
func requireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	if superAdminChecker == nil {
		WriteJSONError(w, http.StatusForbidden, ErrCodeForbidden, "super admin checker not configured")
		return false
	}
	return superAdminChecker(w, r)
}

// validateCommandRequest 校验创建/更新指令的请求字段，无错返回空串。
// isCreate=true 时校验 cmd 前缀；false 时跳过（cmd 来自路径参数）。
func validateCommandRequest(req *commandRequest, isCreate bool) string {
	if isCreate {
		if !strings.HasPrefix(req.Cmd, commandPrefixSlash) {
			return "cmd must start with /"
		}
		if strings.TrimSpace(strings.TrimPrefix(req.Cmd, commandPrefixSlash)) == "" {
			return "cmd cannot be empty"
		}
	}
	if strings.TrimSpace(req.Label) == "" {
		return "label is required"
	}
	if strings.TrimSpace(req.Template) == "" {
		return "template is required"
	}
	return ""
}

// isYamlBuiltinCommand 判断 cmd 是否为 yaml 系统指令。
func isYamlBuiltinCommand(cmd string) bool {
	for _, c := range loadYamlCommands() {
		if c.Cmd == cmd {
			return true
		}
	}
	return false
}

// handleCreateCommand 处理 POST /api/v1/commands，创建自定义指令（超管）。
func handleCreateCommand(w http.ResponseWriter, r *http.Request) {
	if !requireSuperAdmin(w, r) {
		return
	}
	var req commandRequest
	if !DecodeJSONBody(w, r, &req) {
		return
	}
	if msg := validateCommandRequest(&req, true); msg != "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, msg)
		return
	}
	// 冲突校验：cmd 不能是系统指令或已存在的自定义指令。
	if isYamlBuiltinCommand(req.Cmd) {
		WriteJSONError(w, http.StatusConflict, ErrCodeGeneral, "cmd conflicts with built-in command")
		return
	}
	if _, ok := findCommandConfig(req.Cmd); ok {
		WriteJSONError(w, http.StatusConflict, ErrCodeGeneral, "cmd already exists")
		return
	}
	if commandStoreInstance == nil {
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "command store not initialized")
		return
	}
	dc := dbCommand{
		Cmd:           req.Cmd,
		Label:         req.Label,
		Desc:          req.Desc,
		Icon:          req.Icon,
		AllowTask:     req.AllowTask,
		AllowRepos:    req.AllowRepos,
		RequireRepos:  req.RequireRepos,
		RequireTask:   req.RequireTask,
		MaxRepos:      req.MaxRepos,
		Enabled:       req.Enabled,
		Template:      req.Template,
		CometTemplate: req.CometTemplate,
		IsBuiltin:     false,
	}
	if err := commandStoreInstance.createCustom(dc); err != nil {
		log.Printf("[Commands] createCustom failed: %v", err)
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "failed to create command")
		return
	}
	invalidateCommandCache()
	created, ok := findCommandConfig(req.Cmd)
	if !ok {
		created = dbCommandToConfig(dc)
	}
	SetJSONHeader(w)
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

// CommandByCmdHandler 处理 /api/v1/commands/{cmd} 请求。
// GET 返回单条指令；PUT 更新（系统指令仅 enabled，自定义指令全字段）；DELETE 删除自定义指令。
// 注意：指令名以 / 开头，但 URL 路径参数中省略前导 /，此处自动补回。
func CommandByCmdHandler(w http.ResponseWriter, r *http.Request) {
	cmd, ok := PathValueOr404(w, r, "cmd")
	if !ok {
		return
	}
	if !strings.HasPrefix(cmd, commandPrefixSlash) {
		cmd = commandPrefixSlash + cmd
	}
	switch r.Method {
	case http.MethodGet:
		handleGetCommand(w, cmd)
	case http.MethodPut:
		handleUpdateCommand(w, r, cmd)
	case http.MethodDelete:
		handleDeleteCommand(w, r, cmd)
	default:
		WriteJSONError(w, http.StatusMethodNotAllowed, ErrCodeGeneral, "method not allowed")
	}
}

// handleGetCommand 返回单条指令配置。
func handleGetCommand(w http.ResponseWriter, cmd string) {
	c, ok := findCommandConfig(cmd)
	if !ok {
		WriteJSONError(w, http.StatusNotFound, ErrCodeGeneral, "command not found")
		return
	}
	SetJSONHeader(w)
	_ = json.NewEncoder(w).Encode(c)
}

// handleUpdateCommand 更新指令：系统指令仅 enabled，自定义指令全字段。
func handleUpdateCommand(w http.ResponseWriter, r *http.Request, cmd string) {
	if !requireSuperAdmin(w, r) {
		return
	}
	var req commandRequest
	if !DecodeJSONBody(w, r, &req) {
		return
	}
	existing, ok := findCommandConfig(cmd)
	if !ok {
		WriteJSONError(w, http.StatusNotFound, ErrCodeGeneral, "command not found")
		return
	}
	if commandStoreInstance == nil {
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "command store not initialized")
		return
	}
	if existing.IsBuiltin {
		// 系统指令：核心字段来自 yaml 不可修改，仅持久化 enabled override。
		if err := commandStoreInstance.upsertBuiltinOverride(cmd, req.Enabled); err != nil {
			log.Printf("[Commands] upsertBuiltinOverride failed: %v", err)
			WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "failed to update command")
			return
		}
	} else {
		// 自定义指令：全字段更新。
		if msg := validateCommandRequest(&req, false); msg != "" {
			WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, msg)
			return
		}
		dc := dbCommand{
			Cmd:           cmd,
			Label:         req.Label,
			Desc:          req.Desc,
			Icon:          req.Icon,
			AllowTask:     req.AllowTask,
			AllowRepos:    req.AllowRepos,
			RequireRepos:  req.RequireRepos,
			RequireTask:   req.RequireTask,
			MaxRepos:      req.MaxRepos,
			Enabled:       req.Enabled,
			Template:      req.Template,
			CometTemplate: req.CometTemplate,
			IsBuiltin:     false,
		}
		if err := commandStoreInstance.updateCustom(dc); err != nil {
			log.Printf("[Commands] updateCustom failed: %v", err)
			WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "failed to update command")
			return
		}
	}
	invalidateCommandCache()
	updated, ok := findCommandConfig(cmd)
	if !ok {
		updated = existing
	}
	SetJSONHeader(w)
	_ = json.NewEncoder(w).Encode(updated)
}

// handleDeleteCommand 删除自定义指令；系统指令不可删。
func handleDeleteCommand(w http.ResponseWriter, r *http.Request, cmd string) {
	if !requireSuperAdmin(w, r) {
		return
	}
	existing, ok := findCommandConfig(cmd)
	if !ok {
		WriteJSONError(w, http.StatusNotFound, ErrCodeGeneral, "command not found")
		return
	}
	if existing.IsBuiltin {
		WriteJSONError(w, http.StatusForbidden, ErrCodeForbidden, "cannot delete built-in command")
		return
	}
	if commandStoreInstance == nil {
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "command store not initialized")
		return
	}
	if err := commandStoreInstance.deleteCustom(cmd); err != nil {
		log.Printf("[Commands] deleteCustom failed: %v", err)
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "failed to delete command")
		return
	}
	invalidateCommandCache()
	w.WriteHeader(http.StatusNoContent)
}
