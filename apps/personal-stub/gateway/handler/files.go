package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// filesRoot 是文件读取 API 允许访问的安全根目录，
// 在 server.go 中通过 SetFilesRoot 初始化为 cfg.WorkspaceRoot。
var filesRoot string

// allowedRoots 是除 filesRoot 外额外允许访问的根目录列表。
// 通过 SetAllowedRoots 设置，通常包含 workspaceRoot（agent 工作目录的根）。
var allowedRoots []string

// SetFilesRoot 设置文件读取 API 的安全根目录。
func SetFilesRoot(root string) {
	filesRoot = root
}

// SetAllowedRoots 设置额外允许访问的根目录列表。
// agent 在 repositoryRoot 下的子目录中创建文件，这些路径需要能被文件 API 访问。
func SetAllowedRoots(roots []string) {
	allowedRoots = roots
}

// AddAllowedRoot 动态添加一个允许访问的根目录（如预览项目路径）。
func AddAllowedRoot(root string) {
	for _, r := range allowedRoots {
		if r == root {
			return
		}
	}
	allowedRoots = append(allowedRoots, root)
}

// isPathAllowed 检查 absPath 是否在允许访问的根目录范围内。
func isPathAllowed(absPath string) bool {
	allRoots := make([]string, 0, len(allowedRoots)+1)
	if filesRoot != "" {
		if rootAbs, err := filepath.Abs(filesRoot); err == nil {
			allRoots = append(allRoots, rootAbs)
		}
	}
	allRoots = append(allRoots, allowedRoots...)

	sep := string(filepath.Separator)
	for _, root := range allRoots {
		rootClean, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		if absPath == rootClean || strings.HasPrefix(absPath, rootClean+sep) {
			return true
		}
	}
	return false
}

func safeFilePath(r *http.Request) (string, int, string) {
	path := r.URL.Query().Get("path")
	if path == "" {
		return "", http.StatusBadRequest, "path is required"
	}

	var absPath string
	if filepath.IsAbs(path) {
		absPath = filepath.Clean(path)
	} else {
		rootAbs, err := filepath.Abs(filesRoot)
		if err != nil {
			return "", http.StatusInternalServerError, "server root not configured"
		}
		absPath = filepath.Join(rootAbs, path)
	}

	if !isPathAllowed(absPath) {
		// 路径不在 allowedRoots 内时，若父目录确实存在则动态加入白名单。
		// 这与 resolveProjectPath 的行为一致，允许访问 workspaceRoot 之外的工程文件。
		parentDir := filepath.Dir(absPath)
		if info, err := os.Stat(parentDir); err == nil && info.IsDir() {
			AddAllowedRoot(parentDir)
		} else {
			return "", http.StatusForbidden, "path outside allowed root"
		}
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

	// 解析文件版本信息，供前端展示版本选择器。
	baseName, version, ext := parseFileVersion(filepath.Base(absPath))
	versions := findFileVersions(absPath)

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"path":     absPath,
		"name":     filepath.Base(absPath),
		"content":  string(content),
		"language": languageFromExt(absPath),
		"encoding": "utf-8",
		"size":     info.Size(),
		// 版本信息
		"baseName": baseName,
		"ext":      ext,
		"version":  version,
		"versions": versions,
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

// FileVersions 返回指定文件的所有版本列表。
// 通过扫描同目录下相同 baseName + ext 的文件来检测版本。
func FileVersions(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := safeFilePath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	versions := findFileVersions(absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"versions": versions,
	})
}

// SaveToFeishu 保存文件到飞书知识库（当前为占位实现）。
func SaveToFeishu(w http.ResponseWriter, r *http.Request) {
	absPath, status, msg := safeFilePath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	log.Printf("[Files] save to feishu requested: %s", absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"message": "已接收保存到飞书知识库的请求（待接入真实 API）",
		"path":    absPath,
	})
}

// versionRegex 匹配文件名中的版本后缀，如 report-v2.md -> baseName="report", version=2
var versionRegex = regexp.MustCompile(`^(.+)-v(\d+)(\.[^.]+)$`)

// fileVersionInfo 描述一个文件的版本信息。
type fileVersionInfo struct {
	Version int    `json:"version"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
}

// parseFileVersion 从文件名中解析 baseName、版本号和扩展名。
// 例如：report-v2.md -> ("report", 2, ".md")
//
//	report.md    -> ("report", 0, ".md")  // 0 表示无版本后缀（首版）
func parseFileVersion(filename string) (baseName string, version int, ext string) {
	ext = filepath.Ext(filename)
	nameWithoutExt := strings.TrimSuffix(filename, ext)

	matches := versionRegex.FindStringSubmatch(filename)
	if len(matches) == 4 {
		baseName = matches[1]
		version, _ = strconv.Atoi(matches[2])
		ext = matches[3]
		return baseName, version, ext
	}

	return nameWithoutExt, 0, ext
}

// findFileVersions 扫描同目录下相同 baseName + ext 的所有版本文件。
// 返回按版本号升序排列的列表。无版本后缀的文件（如 report.md）视为 version 0。
func findFileVersions(absPath string) []fileVersionInfo {
	dir := filepath.Dir(absPath)
	filename := filepath.Base(absPath)

	baseName, currentVersion, ext := parseFileVersion(filename)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return []fileVersionInfo{{Version: currentVersion, Name: filename, Path: absPath}}
	}

	// 构建匹配 pattern：baseName-v*.ext 或 baseName.ext
	var versions []fileVersionInfo

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		entryName := entry.Name()
		entryBase, entryVer, entryExt := parseFileVersion(entryName)
		// 必须同 baseName 同 ext 才算同系列版本
		if entryBase != baseName || entryExt != ext {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		versions = append(versions, fileVersionInfo{
			Version: entryVer,
			Name:    entryName,
			Path:    filepath.Join(dir, entryName),
			Size:    info.Size(),
		})
	}

	// 如果没有任何版本文件（理论上至少有当前文件），返回当前文件
	if len(versions) == 0 {
		versions = []fileVersionInfo{{Version: currentVersion, Name: filename, Path: absPath}}
	}

	// 按版本号升序排列
	sort.Slice(versions, func(i, j int) bool {
		return versions[i].Version < versions[j].Version
	})

	return versions
}

const DEFAULT_FILE_MODE = 0644

// FileWrite 写入文件内容到磁盘（路径需在允许的根目录范围内）。
func FileWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}

	if req.Path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}

	var absPath string
	if filepath.IsAbs(req.Path) {
		absPath = filepath.Clean(req.Path)
	} else {
		rootAbs, err := filepath.Abs(filesRoot)
		if err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, "server root not configured")
			return
		}
		absPath = filepath.Join(rootAbs, req.Path)
	}

	if !isPathAllowed(absPath) {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("[Files] mkdir failed for %s: %v", dir, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "写入文件失败：无法创建目录")
		return
	}

	if err := os.WriteFile(absPath, []byte(req.Content), DEFAULT_FILE_MODE); err != nil {
		log.Printf("[Files] write failed for %s: %v", absPath, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "写入文件失败")
		return
	}

	log.Printf("[Files] file written: %s (%d bytes)", absPath, len(req.Content))
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"path":    absPath,
		"written": len(req.Content),
	})
}

// FileDelete 删除指定文件（路径需在允许的根目录范围内，不支持删除目录）。
func FileDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	absPath, status, msg := safeFilePath(r)
	if status != 0 {
		WriteJSONError(w, status, 1, msg)
		return
	}

	if err := os.Remove(absPath); err != nil {
		log.Printf("[Files] delete failed for %s: %v", absPath, err)
		WriteJSONError(w, http.StatusInternalServerError, 1, "删除文件失败")
		return
	}

	log.Printf("[Files] file deleted: %s", absPath)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"path":   absPath,
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
