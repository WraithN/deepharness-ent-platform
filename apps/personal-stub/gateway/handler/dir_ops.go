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

// WalkDirEntry 是文件树遍历中的一个节点。
type WalkDirEntry struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// FileWalkDir 递归遍历目录，返回所有文件/子目录的扁平列表。
// GET /api/v1/files/walk?path=...
func FileWalkDir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	root := r.URL.Query().Get("path")
	if root == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	absRoot := resolveAllowedPath(root)
	if absRoot == "" {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	var entries []WalkDirEntry
	err := filepath.Walk(absRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // 跳过无法访问的条目
		}
		entries = append(entries, WalkDirEntry{
			Path:  path,
			Name:  info.Name(),
			IsDir: info.IsDir(),
			Size:  info.Size(),
		})
		return nil
	})
	if err != nil {
		log.Printf("[Files] walk failed for %s: %v", absRoot, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "遍历目录失败")
		return
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"path":    absRoot,
		"entries": entries,
	})
}

// FileGlob 返回匹配指定 pattern 的文件路径列表。
// GET /api/v1/files/glob?pattern=...
func FileGlob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	pattern := r.URL.Query().Get("pattern")
	if pattern == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "pattern is required")
		return
	}

	// 将 pattern 解析为绝对路径形式（若为相对路径则基于 filesRoot）
	var absPattern string
	if filepath.IsAbs(pattern) {
		absPattern = filepath.Clean(pattern)
	} else {
		rootAbs, err := filepath.Abs(filesRoot)
		if err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, "server root not configured")
			return
		}
		absPattern = filepath.Join(rootAbs, pattern)
	}

	matches, err := filepath.Glob(absPattern)
	// filepath.Glob 的唯一可能错误是 pattern 语法错误
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid glob pattern: "+err.Error())
		return
	}

	// 只返回允许路径范围内的结果
	var allowed []string
	for _, m := range matches {
		if isPathAllowed(m) {
			allowed = append(allowed, m)
		}
	}
	if allowed == nil {
		allowed = []string{}
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"pattern": absPattern,
		"matches": allowed,
	})
}

// FileInfoResp 是文件/目录的详细信息。
type FileInfoResp struct {
	Exists   bool   `json:"exists"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	ModTime  string `json:"modTime"`
	BaseName string `json:"baseName"`
}

// FileInfo 返回指定路径的文件/目录详细信息。
// GET /api/v1/files/info?path=...
func FileInfo(w http.ResponseWriter, r *http.Request) {
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
		json.NewEncoder(w).Encode(FileInfoResp{Exists: false})
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(FileInfoResp{Exists: false})
		return
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(FileInfoResp{
		Exists:   true,
		IsDir:    info.IsDir(),
		Size:     info.Size(),
		ModTime:  info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
		BaseName: info.Name(),
	})
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
