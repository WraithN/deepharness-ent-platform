package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
)

// DirEntry 表示目录中的一个条目。
type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// FileMkdir 创建目录（递归创建父目录，幂等操作）。
// POST /api/v1/files/mkdir  body: {"path": "..."}
func FileMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	if req.Path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	absPath := resolveAllowedPath(req.Path)
	if absPath == "" {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	if err := os.MkdirAll(absPath, 0755); err != nil {
		log.Printf("[Files] mkdir failed for %s: %v", absPath, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "创建目录失败")
		return
	}

	log.Printf("[Files] dir created: %s", absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"path":   absPath,
	})
}

// FileRemoveDir 递归删除目录及其所有内容。
// DELETE /api/v1/files/dir?path=...
func FileRemoveDir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	absPath := resolveAllowedPath(path)
	if absPath == "" {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			WriteJSONError(w, http.StatusNotFound, 1, "directory not found")
			return
		}
		WriteJSONError(w, http.StatusInternalServerError, 1, "failed to stat path")
		return
	}
	if !info.IsDir() {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is not a directory")
		return
	}

	if err := os.RemoveAll(absPath); err != nil {
		log.Printf("[Files] removedir failed for %s: %v", absPath, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "删除目录失败")
		return
	}

	log.Printf("[Files] dir removed: %s", absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"path":   absPath,
	})
}

// FileListDir 列出目录中的所有条目。
// GET /api/v1/files/list?path=...
func FileListDir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	absPath := resolveAllowedPath(path)
	if absPath == "" {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			WriteJSONError(w, http.StatusNotFound, 1, "directory not found")
			return
		}
		WriteJSONError(w, http.StatusInternalServerError, 1, "failed to stat path")
		return
	}
	if !info.IsDir() {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is not a directory")
		return
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		log.Printf("[Files] listdir failed for %s: %v", absPath, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "读取目录失败")
		return
	}

	result := make([]DirEntry, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		size := int64(0)
		if err == nil {
			size = info.Size()
		}
		result = append(result, DirEntry{
			Name:  e.Name(),
			IsDir: e.IsDir(),
			Size:  size,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return result[i].Name < result[j].Name
	})

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"path":    absPath,
		"entries": result,
	})
}

// resolveAllowedPath 将相对路径解析为绝对路径并检查是否在允许的根目录范围内。
// 返回空字符串表示路径不允许。
func resolveAllowedPath(path string) string {
	var absPath string
	if filepath.IsAbs(path) {
		absPath = filepath.Clean(path)
	} else {
		rootAbs, err := filepath.Abs(filesRoot)
		if err != nil {
			return ""
		}
		absPath = filepath.Join(rootAbs, path)
	}
	if !isPathAllowed(absPath) {
		parentDir := filepath.Dir(absPath)
		if info, err := os.Stat(parentDir); err == nil && info.IsDir() {
			AddAllowedRoot(parentDir)
		} else {
			return ""
		}
	}
	return absPath
}

// FileExists 检查文件或目录是否存在。
// GET /api/v1/files/exists?path=...
func FileExists(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	absPath := resolveAllowedPath(path)
	if absPath == "" {
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(map[string]any{"exists": false})
		return
	}

	_, err := os.Stat(absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"exists": err == nil,
	})
}
