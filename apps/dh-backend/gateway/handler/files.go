package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// filesRoot 是文件读取 API 允许访问的安全根目录，
// 在 server.go 中通过 SetFilesRoot 初始化为 cfg.AGUIWorkspace。
var filesRoot string

// SetFilesRoot 设置文件读取 API 的安全根目录。
func SetFilesRoot(root string) {
	filesRoot = root
}

func safeFilePath(r *http.Request) (string, int, string) {
	path := r.URL.Query().Get("path")
	if path == "" {
		return "", http.StatusBadRequest, "path is required"
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", http.StatusBadRequest, "invalid path"
	}

	rootAbs, err := filepath.Abs(filesRoot)
	if err != nil {
		return "", http.StatusInternalServerError, "server root not configured"
	}

	sep := string(filepath.Separator)
	// 允许根目录本身，以及根目录下的任何子路径；禁止 ../ 越界。
	if absPath != rootAbs && !strings.HasPrefix(absPath, rootAbs+sep) {
		return "", http.StatusForbidden, "path outside allowed root"
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", http.StatusNotFound, "file not found"
		}
		return "", http.StatusInternalServerError, "failed to stat file"
	}
	if info.IsDir() {
		return "", http.StatusBadRequest, "path is a directory"
	}

	return absPath, 0, ""
}

// FileContent 读取指定文件内容并返回 JSON（用于前端预览）。
func FileContent(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := safeFilePath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	content, err := os.ReadFile(absPath)
	if err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "failed to read file")
		return
	}

	info, _ := os.Stat(absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"path":     absPath,
		"name":     filepath.Base(absPath),
		"content":  string(content),
		"language": languageFromExt(absPath),
		"encoding": "utf-8",
		"size":     info.Size(),
	})
}

// FileDownload 直接返回文件内容并触发浏览器下载。
func FileDownload(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := safeFilePath(r)
	if status != 0 {
		http.Error(w, msg, status)
		return
	}

	w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(absPath)+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, absPath)
}

// SaveToFeishu 保存文件到飞书知识库（当前为占位实现）。
func SaveToFeishu(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := safeFilePath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	// TODO: 接入真实飞书知识库 API，将 absPath 文件上传。
	log.Printf("[Files] save to feishu requested: %s", absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"message": "已接收保存到飞书知识库的请求（待接入真实 API）",
		"path":    absPath,
	})
}

func languageFromExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".go":
		return "go"
	case ".ts", ".tsx":
		return "typescript"
	case ".js", ".jsx":
		return "javascript"
	case ".md", ".markdown":
		return "markdown"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".css":
		return "css"
	case ".html":
		return "html"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".sh":
		return "bash"
	default:
		return ""
	}
}
