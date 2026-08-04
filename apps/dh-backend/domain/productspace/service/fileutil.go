package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/lib/pq"
)

// anonymousVisitorUserID 是需求分享页中匿名访客添加批注时使用的占位 user_id。
// 由于 product_prototype_comments.user_id 非空，且分享页免登录，统一使用此常量标识。
const anonymousVisitorUserID = "anonymous"

// invalidInput 将业务校验错误包装为 ErrInvalidInput，便于 handler 映射为 400。
func invalidInput(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %w", ErrInvalidInput, err)
}

// 预定义的 MIME 类型映射，避免魔法字符串。
var mimeTypeByExt = map[string]string{
	object.DocExtMarkdown: "text/markdown",
	object.DocExtText:     "text/plain",
	"png":                 "image/png",
	"jpg":                 "image/jpeg",
	"jpeg":                "image/jpeg",
	"pdf":                 "application/pdf",
	"html":                "text/html; charset=utf-8",
	"css":                 "text/css; charset=utf-8",
	"js":                  "application/javascript; charset=utf-8",
}

// isUniqueViolation 判断数据库错误是否为 PostgreSQL 唯一约束冲突（SQLSTATE 23505）。
func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		return pqErr.Code == "23505"
	}
	return false
}

// resolveProductSpacePathWithBase 返回产品空间根目录的绝对路径与相对路径对应的绝对路径，并校验路径逃逸。
func resolveProductSpacePathWithBase(workspaceRoot, workspaceID, userID, relativePath string) (string, string, error) {
	baseRoot, err := pathutil.ResolveWorkspaceRoot(workspaceRoot, userID, workspaceID)
	if err != nil {
		return "", "", fmt.Errorf("resolve workspace root failed: %w", err)
	}

	base := filepath.Join(baseRoot, object.ProductSpaceRoot)
	if err := rejectSymlink(base); err != nil {
		return "", "", fmt.Errorf("base directory symlink check failed: %w", err)
	}
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", "", fmt.Errorf("resolve base path failed: %w", err)
	}
	target := filepath.Join(absBase, relativePath)
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", "", fmt.Errorf("resolve target path failed: %w", err)
	}
	if !strings.HasPrefix(absTarget, absBase+string(filepath.Separator)) && absTarget != absBase {
		return "", "", errors.New(errMsgPathTraversal)
	}
	return absBase, absTarget, nil
}

// resolveProductSpacePath 返回相对路径对应的绝对路径，并校验路径逃逸。
func resolveProductSpacePath(workspaceRoot, workspaceID, userID, relativePath string) (string, error) {
	_, target, err := resolveProductSpacePathWithBase(workspaceRoot, workspaceID, userID, relativePath)
	return target, err
}

// safeMkdirAll 在 baseAbs 下安全地创建到达 targetAbs 所经过的每一级目录。
// safeMkdirAll 通过 personal-stub 在共享目录中递归创建目录。
// 架构合规：dh-backend 不直接写共享目录，委托 personal-stub 执行。
// 保留路径逃逸校验（targetAbs 必须在 baseAbs 下），防止恶意路径穿越。
func safeMkdirAll(ctx context.Context, baseAbs, targetAbs string) error {
	if !strings.HasPrefix(targetAbs, baseAbs+string(filepath.Separator)) {
		return errors.New(errMsgPathTraversal)
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.MkdirAll(ctx, targetAbs)
}

// stubReadFile 通过 personal-stub 读取文件内容，返回 []byte 以兼容原 os.ReadFile 调用。
// 架构合规：dh-backend 不直接读共享目录，统一委托 personal-stub。
func stubReadFile(ctx context.Context, path string) ([]byte, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil, errors.New("personal-stub client not initialized")
	}
	data, err := sc.ReadFile(ctx, path)
	if err != nil {
		return nil, err
	}
	return []byte(data), nil
}

// stubFileExists 通过 personal-stub 检查文件/目录是否存在。
func stubFileExists(ctx context.Context, path string) bool {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	ok, err := sc.FileExists(ctx, path)
	return err == nil && ok
}

// stubListDir 通过 personal-stub 列出目录条目。
func stubListDir(ctx context.Context, path string) ([]stubclient.DirEntry, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil, errors.New("personal-stub client not initialized")
	}
	return sc.ListDir(ctx, path)
}

// stubFileInfo 通过 personal-stub 获取文件/目录信息。
func stubFileInfo(ctx context.Context, path string) (*stubclient.FileInfoResult, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil, errors.New("personal-stub client not initialized")
	}
	return sc.FileInfo(ctx, path)
}

// stubWriteFile 通过 personal-stub 写入文件内容。
// 架构合规：dh-backend 不直接写共享目录。
func stubWriteFile(ctx context.Context, path string, data []byte) error {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.WriteFile(ctx, path, string(data))
}

// stubDeleteFile 通过 personal-stub 删除文件，文件不存在时视为成功。
// 架构合规：dh-backend 不直接删除共享目录中的文件。
func stubDeleteFile(ctx context.Context, path string) error {
	if !stubFileExists(ctx, path) {
		return nil // 文件不存在，视为删除成功
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.DeleteFile(ctx, path)
}

// rollbackLogTag 是版本回滚补偿路径中日志的统一前缀，避免魔法字符串重复。
const rollbackLogTag = "[ProductSpace]"

// logRollbackDeleteErr 记录回滚补偿路径中文件删除失败的日志，不中断回滚流程。
// 回滚操作需尽力继续，仅记录日志便于后续排查文件系统状态不一致问题。
func logRollbackDeleteErr(path string, err error) {
	log.Printf("%s version rollback delete failed for %s: %v", rollbackLogTag, path, err)
}

// logRollbackWriteErr 记录回滚补偿路径中文件写入失败的日志，不中断回滚流程。
// 回滚操作需尽力继续，仅记录日志便于后续排查文件系统状态不一致问题。
func logRollbackWriteErr(path string, err error) {
	log.Printf("%s version rollback write failed for %s: %v", rollbackLogTag, path, err)
}

// validateRelativePath 校验相对路径基本规则。
// 显式拒绝任何包含 "." 或 ".." 路径段的相对路径，避免路径逃逸。
func validateRelativePath(relativePath string) error {
	if relativePath == "" {
		return errors.New(errMsgRelativePathEmpty)
	}
	if filepath.IsAbs(relativePath) {
		return errors.New(errMsgRelativePathAbs)
	}
	parts := strings.Split(filepath.ToSlash(relativePath), "/")
	for _, part := range parts {
		if part == "." || part == ".." {
			return errors.New(errMsgRelativePathDot)
		}
	}
	cleaned := filepath.Clean(relativePath)
	if strings.HasPrefix(cleaned, "..") {
		return errors.New(errMsgRelativePathDot)
	}
	return nil
}

// normalizeDeliverablePath 将 agent 标记中的绝对路径转换为相对于 workspaceRoot 下 userId/workspaceID 的相对路径。
// agent 输出中的标记格式为 [[FILE:{workspaceRoot}/{userId}/{workspaceID}/rest/of/path]]，
// 而 ImportProcessDeliverable 期望的是 "rest/of/path" 这样的相对路径。
// 非绝对路径直接原样返回。
func normalizeDeliverablePath(workspaceRoot, workspaceID, path string) (string, error) {
	if !filepath.IsAbs(path) {
		return path, nil
	}
	if !isPathUnderWorkspaceRoot(path, workspaceRoot) {
		return "", errors.New("deliverable path is outside workspace root")
	}
	relToRoot := strings.TrimPrefix(path, workspaceRoot)
	relToRoot = strings.TrimPrefix(relToRoot, "/")
	parts := strings.SplitN(relToRoot, "/", 3)
	if len(parts) < 3 {
		return "", errors.New("deliverable path does not contain user and workspace subdirectories")
	}
	if parts[1] != workspaceID {
		return "", fmt.Errorf("deliverable path workspace ID mismatch: expected %s, got %s", workspaceID, parts[1])
	}
	return parts[2], nil
}

// isPathUnderWorkspaceRoot 校验绝对路径是否位于 workspaceRoot 之下。
// 用于清理任务等需要先拼接相对路径再访问文件系统的场景，防止路径逃逸。
func isPathUnderWorkspaceRoot(absPath, workspaceRoot string) bool {
	cleanedAbs := filepath.Clean(absPath)
	cleanedRoot := filepath.Clean(workspaceRoot)
	if cleanedAbs == cleanedRoot {
		return true
	}
	prefix := cleanedRoot + string(filepath.Separator)
	return strings.HasPrefix(cleanedAbs, prefix)
}

// buildRelativePath 构造相对路径：category/[folder/]filename.ext。
// folder 支持多级子目录，如 "a/b"。
func buildRelativePath(category, folder, name, ext string) string {
	filename := name
	if ext != "" {
		filename = name + "." + ext
	}
	if folder == "" {
		return filepath.Join(category, filename)
	}
	return filepath.Join(category, folder, filename)
}

// splitFolderPath 将 folder 路径拆分为各级目录名，空路径返回空切片。
func splitFolderPath(folder string) []string {
	if folder == "" {
		return nil
	}
	parts := strings.Split(filepath.ToSlash(folder), "/")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// buildVersionRelativePath 构造版本文件的相对路径：versions/{category}/{folder}/{name}-vN.ext。
func buildVersionRelativePath(category, folder, name, ext string, version int) string {
	filename := buildVersionFileName(name, ext, version)
	if folder == "" {
		return filepath.Join(object.ProductSpaceVersionsDir, category, filename)
	}
	return filepath.Join(object.ProductSpaceVersionsDir, category, folder, filename)
}

// buildVersionFileName 构造版本文件名：name-vN.ext。
func buildVersionFileName(name, ext string, version int) string {
	return name + versionSuffix + strconv.Itoa(version) + "." + ext
}

// copyFile 将 src 文件完整复制到 dst。
// 架构合规：通过 personal-stub 读取源文件、写入目标文件，不直接操作共享目录。
func copyFile(ctx context.Context, src, dst string) error {
	data, err := stubReadFile(ctx, src)
	if err != nil {
		return err
	}
	return stubWriteFile(ctx, dst, data)
}

// sanitizeName 清理名称中的文件系统危险字符，防止跨目录或非法文件名。
// 显式拒绝 "." 与 ".."，避免通过文件夹名称逃逸到父目录；拒绝 "%"，避免与 LIKE 通配符混淆。
// "_" 是常见文件名字符，且 escapeLikePattern 已将其转义，因此允许使用。
func sanitizeName(name string) (string, error) {
	cleaned := strings.TrimSpace(name)
	if cleaned == "" || cleaned == "." || cleaned == ".." {
		return "", errors.New("invalid name")
	}
	cleaned = filepath.Base(cleaned)
	if cleaned == "." || cleaned == ".." {
		return "", errors.New("invalid name")
	}
	if strings.ContainsAny(cleaned, "%") {
		return "", errors.New("name cannot contain wildcard characters")
	}
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
		"\x00", "",
	)
	cleaned = replacer.Replace(cleaned)
	if cleaned == "" {
		return "", errors.New("invalid name")
	}
	return cleaned, nil
}

// sanitizeFolderPath 清理由 "/" 分隔的多级目录路径。
// 对每一段分别调用 sanitizeName，并拒绝空段、"."、".." 与路径逃逸。
func sanitizeFolderPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("invalid folder path")
	}
	// 统一使用正斜杠作为路径分隔符，便于数据库存储与前端展示。
	path = filepath.ToSlash(path)
	if strings.HasPrefix(path, "/") || strings.Contains(path, "..") {
		return "", errors.New("invalid folder path")
	}
	segments := strings.Split(path, "/")
	cleaned := make([]string, 0, len(segments))
	for _, seg := range segments {
		if seg == "" {
			continue
		}
		s, err := sanitizeName(seg)
		if err != nil {
			return "", fmt.Errorf("invalid folder segment %q: %w", seg, err)
		}
		cleaned = append(cleaned, s)
	}
	if len(cleaned) == 0 {
		return "", errors.New("invalid folder path")
	}
	return strings.Join(cleaned, "/"), nil
}

// rejectSymlink 校验指定路径本身不是符号链接；路径不存在时视为安全。
// 架构例外：此函数是安全校验（防止路径遍历攻击），仅检查文件系统属性，
// 不读写文件内容。stubclient/personal-stub 未提供符号链接检测 API，
// 故保留 os.Lstat 调用。TODO: 后续可给 personal-stub 增加 Lstat 端点。
func rejectSymlink(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("symlinks are not allowed")
	}
	return nil
}

// escapeLikePattern 对字符串中的 LIKE 通配符与转义字符进行转义，配合 ESCAPE '\' 使用。
// 注意：SQL 语句中写 ESCAPE '\'，在 PostgreSQL 标准字符串语义下会被解析为两个反斜杠，
// 导致“invalid escape string”。因此查询端使用 ESCAPE '\”（单个反斜杠），本函数将转义字符输出为 "\\"。
func escapeLikePattern(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	s = strings.ReplaceAll(s, "_", "\\_")
	return s
}

// parseExtFromName 从名称中解析扩展名（小写）。
func parseExtFromName(name string) string {
	idx := strings.LastIndex(name, ".")
	if idx <= 0 || idx == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[idx+1:])
}

// stripExt 去掉名称中的扩展名部分（扩展名比较不区分大小写）。
func stripExt(name, ext string) string {
	suffix := "." + ext
	if strings.HasSuffix(strings.ToLower(name), strings.ToLower(suffix)) {
		return name[:len(name)-len(suffix)]
	}
	return name
}

// parseAndValidateExt 根据条目类型解析并校验扩展名。
func parseAndValidateExt(itemType, title string) (string, error) {
	ext := parseExtFromName(title)
	switch itemType {
	case object.ItemTypeDoc:
		if ext == "" {
			ext = object.DocExtMarkdown
		}
		if !object.AllowedDocExts[ext] {
			return "", errors.New(errMsgInvalidExtension)
		}
	case object.ItemTypePrototype:
		if ext == "" {
			return "", errors.New(errMsgInvalidExtension)
		}
		if !object.AllowedPrototypeExts[ext] {
			return "", errors.New(errMsgInvalidExtension)
		}
	default:
		return "", errors.New(errMsgInvalidItemType)
	}
	return ext, nil
}

// mimeTypeForExt 返回扩展名对应的 MIME 类型，未知扩展名默认返回二进制流。
func mimeTypeForExt(ext string) string {
	if mime, ok := mimeTypeByExt[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}

// typeToCategoryDir 将条目类型映射到顶层目录。
func typeToCategoryDir(itemType string) (string, error) {
	switch itemType {
	case object.ItemTypeDoc:
		return object.ProductSpaceDocsDir, nil
	case object.ItemTypePrototype:
		return object.ProductSpacePrototypesDir, nil
	default:
		return "", errors.New(errMsgInvalidItemType)
	}
}

// validateCategory 校验文件夹操作中的分类。
func validateCategory(category string) error {
	if category == object.ProductSpaceDocsDir || category == object.ProductSpacePrototypesDir {
		return nil
	}
	return errors.New(errMsgInvalidCategory)
}

// parseRelativePath 将数据库中存储的相对路径解析为目录与文件名信息。
// 支持多级子目录，返回的 folder 为中间目录路径（以 "/" 连接），可能为空。
func parseRelativePath(relativePath string) (category, folder, name, ext string, err error) {
	parts := strings.Split(filepath.ToSlash(relativePath), "/")
	if len(parts) < 2 {
		return "", "", "", "", fmt.Errorf("invalid relative path format: %s", relativePath)
	}
	category = parts[0]
	filename := parts[len(parts)-1]
	if len(parts) > 2 {
		folder = strings.Join(parts[1:len(parts)-1], "/")
	}
	ext = parseExtFromName(filename)
	name = stripExt(filename, ext)
	return category, folder, name, ext, nil
}
