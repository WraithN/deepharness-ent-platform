package handler

import (
	"encoding/json"
	"net/http"
	"strings"
)

// ErrorResponse 统一错误响应结构。
type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// SetJSONHeader 设置响应 Content-Type 为 application/json。
func SetJSONHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
}

// WriteJSONError 写入 JSON 格式错误响应。
func WriteJSONError(w http.ResponseWriter, status, code int, message string) {
	SetJSONHeader(w)
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorResponse{Code: code, Message: message})
}

// HandleServiceError 统一处理服务层错误，识别 not found 返回 404。
func HandleServiceError(w http.ResponseWriter, err error, notFoundMsg, defaultMsg string) {
	if strings.Contains(err.Error(), "not found") {
		WriteJSONError(w, http.StatusNotFound, 1, notFoundMsg)
		return
	}
	WriteJSONError(w, http.StatusInternalServerError, 1, defaultMsg)
}

// DecodeJSONBody 解码 JSON 请求体，失败时返回 400。
func DecodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return false
	}
	return true
}

// PathValueOr404 提取路径参数，为空时返回 400。
func PathValueOr404(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	v := r.PathValue(name)
	if v == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "missing "+name)
		return "", false
	}
	return v, true
}
