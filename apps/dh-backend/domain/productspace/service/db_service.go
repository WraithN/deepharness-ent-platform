package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	productdocobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

const (
	defaultFilePerm = 0o644
	defaultDirPerm  = 0o755

	// ItemStatusDraft 是新建产品空间条目的默认状态。
	ItemStatusDraft = "draft"

	versionSuffix = "-v"

	// pmSubRole 是允许访问产品空间的职能子角色。
	pmSubRole = "pm"

	// changeSummaryRestoreToVersion 是 RestoreVersion 恢复到目标版本后的变更摘要模板。
	changeSummaryRestoreToVersion = "恢复至 v%d"

	maxTitleLength         = 500
	maxChangeSummaryLength = 500

	// maxCommentLength 是原型批注内容的最大长度（按 rune 计，避免截断多字节字符）。
	maxCommentLength = 2000

	// maxSelectorLength 是元素选择器的最大长度，与数据库 VARCHAR(500) 对齐。
	maxSelectorLength = 500
	// maxTargetTextLength 是选中元素文本快照的最大长度。
	maxTargetTextLength = 500
)

const (
	errMsgInvalidItemType      = "invalid item type"
	errMsgInvalidCategory      = "invalid category"
	errMsgInvalidExtension     = "invalid file extension"
	errMsgPathTraversal        = "path traversal detected"
	errMsgFolderNotEmpty       = "folder is not empty"
	errMsgFolderNotFound       = "folder not found"
	errMsgTitleEmpty           = "title is required"
	errMsgTitlePathSeparator   = "title cannot contain path separators"
	errMsgContentRequired      = "doc content is required"
	errMsgFileDataRequired     = "prototype file data is required"
	errMsgPrototypeTooLarge    = "prototype file exceeds maximum allowed size"
	errMsgDocTooLarge          = "doc content exceeds maximum allowed size"
	errMsgFolderPathSeparator  = "folder name cannot contain path separators"
	errMsgRelativePathEmpty    = "relative path is required"
	errMsgRelativePathAbs      = "relative path must be relative"
	errMsgRelativePathDot      = "relative path cannot contain parent references"
	errMsgItemNotFound         = "product space item not found"
	errMsgItemAlreadyExists    = "product space item already exists"
	errMsgVersionNotFound          = "product space version not found"
	errMsgInvalidVersion           = "invalid version"
	errMsgTitleTooLong             = "title exceeds maximum length"
	errMsgChangeSummaryTooLong     = "change summary exceeds maximum length"
	errMsgWorkspaceOrMemberNotFound = "workspace or member not found"
	errMsgCommentEmpty              = "批注内容不能为空"
	errMsgCommentTooLong            = "批注内容超出最大长度限制"
	errMsgCommentsNotAllowed        = "该分享未开放批注权限"
	errMsgNoPrototypeInShare        = "该分享未关联原型"
	errMsgNoDocInShare              = "该分享未关联文档"
)

// anonymousVisitorUserID 是需求分享页中匿名访客添加批注时使用的占位 user_id。
// 由于 product_prototype_comments.user_id 非空，且分享页免登录，统一使用此常量标识。
const anonymousVisitorUserID = "anonymous"

// invalidInput 将业务校验错误包装为 ErrInvalidInput，便于 handler 映射为 400。
func invalidInput(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
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

// DBProductSpaceService 是基于 PostgreSQL 与本地文件系统的产品空间服务实现。
type DBProductSpaceService struct {
	db               *sql.DB
	workspaceRoot    string
	workspaceService workspaceMemberRoleProvider
}

var _ ProductSpaceService = (*DBProductSpaceService)(nil)

// NewDBProductSpaceService 创建 DBProductSpaceService 实例。
// workspaceRoot 会被解析为绝对路径，避免进程工作目录变化导致已存储的路径失效。
func NewDBProductSpaceService(db *sql.DB, workspaceRoot string, workspaceService workspaceMemberRoleProvider) (*DBProductSpaceService, error) {
	if db == nil {
		return nil, errors.New("db is required")
	}
	if workspaceRoot == "" {
		return nil, errors.New("workspaceRoot is required")
	}
	if workspaceService == nil {
		return nil, errors.New("workspaceService is required")
	}
	absRoot, err := filepath.Abs(workspaceRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root: %w", err)
	}
	return &DBProductSpaceService{
		db:               db,
		workspaceRoot:    absRoot,
		workspaceService: workspaceService,
	}, nil
}

// isUniqueViolation 判断数据库错误是否为 PostgreSQL 唯一约束冲突（SQLSTATE 23505）。
func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		return pqErr.Code == "23505"
	}
	return false
}

// requirePM 校验当前用户在工作空间中的职能子角色为 PM。
// 当成员不存在时返回 ErrNotFound，避免与“存在但无权限”统一返回 403 造成信息泄露。
func (s *DBProductSpaceService) requirePM(ctx context.Context, workspaceID, userID string) error {
	subRole, err := s.workspaceService.GetMemberSubRole(ctx, workspaceID, userID)
	if err != nil {
		if errors.Is(err, workspaceservice.ErrMemberNotFound) {
			return fmt.Errorf("%w: %s", ErrNotFound, errMsgWorkspaceOrMemberNotFound)
		}
		return fmt.Errorf("%w: %v", ErrForbidden, err)
	}
	if subRole != pmSubRole {
		return fmt.Errorf("%w: only pm can access product space", ErrForbidden)
	}
	return nil
}

// requireMember 校验当前用户是否为工作空间成员（任意职能子角色均可）。
// 用于 /proto-make 生成内容的“自我采纳”等仅需确认成员身份的场景。
func (s *DBProductSpaceService) requireMember(ctx context.Context, workspaceID, userID string) error {
	_, err := s.workspaceService.GetMemberSubRole(ctx, workspaceID, userID)
	if err != nil {
		if errors.Is(err, workspaceservice.ErrMemberNotFound) {
			return fmt.Errorf("%w: %s", ErrNotFound, errMsgWorkspaceOrMemberNotFound)
		}
		return fmt.Errorf("%w: %v", ErrForbidden, err)
	}
	return nil
}

// scanner 抽象了 sql.Row 与 sql.Rows 的 Scan 能力，用于复用扫描逻辑。
type scanner interface {
	Scan(dest ...any) error
}

// queryRowContextExecer 抽象了 *sql.DB 与 *sql.Tx 的 QueryRowContext 能力。
type queryRowContextExecer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// scanProductSpaceItem 从数据库行扫描到领域对象。
func scanProductSpaceItem(sc scanner, item *object.ProductSpaceItem) error {
	var createdBy sql.NullString
	err := sc.Scan(
		&item.ID, &item.WorkspaceID, &item.UserID, &item.Type,
		&item.Title, &item.RelativePath, &item.CurrentVersion,
		&item.FileExt, &item.MimeType, &item.SizeBytes, &item.Status,
		&createdBy, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if createdBy.Valid {
		item.CreatedBy = createdBy.String
	}
	return nil
}

// scanProductSpaceVersion 从数据库行扫描到版本领域对象。
func scanProductSpaceVersion(sc scanner, v *object.ProductSpaceVersion) error {
	var title, filePath, fileExt, mimeType, changeSummary, createdBy sql.NullString
	err := sc.Scan(
		&v.ID, &v.DocID, &v.Version, &title, &filePath,
		&fileExt, &mimeType, &v.SizeBytes, &changeSummary, &createdBy, &v.CreatedAt,
	)
	if err != nil {
		return err
	}
	if title.Valid {
		v.Title = title.String
	}
	if filePath.Valid {
		v.FilePath = filePath.String
	}
	if fileExt.Valid {
		v.FileExt = fileExt.String
	}
	if mimeType.Valid {
		v.MimeType = mimeType.String
	}
	if changeSummary.Valid {
		v.ChangeSummary = changeSummary.String
	}
	if createdBy.Valid {
		v.CreatedBy = createdBy.String
	}
	return nil
}

// validateID 校验工作空间 ID 与用户 ID 不包含路径分隔符或父目录引用。
func validateID(id string) error {
	if id == "" {
		return errors.New("id is required")
	}
	if strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
		return errors.New("id contains invalid characters")
	}
	return nil
}

// resolveProductSpacePathWithBase 返回产品空间根目录的绝对路径与相对路径对应的绝对路径，并校验路径逃逸。
func resolveProductSpacePathWithBase(workspaceRoot, workspaceID, userID, relativePath string) (string, string, error) {
	if err := validateID(workspaceID); err != nil {
		return "", "", fmt.Errorf("invalid workspaceID: %w", err)
	}
	if err := validateID(userID); err != nil {
		return "", "", fmt.Errorf("invalid userID: %w", err)
	}

	base := filepath.Join(workspaceRoot, userID, workspaceID, object.ProductSpaceRoot)
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
func safeMkdirAll(baseAbs, targetAbs string) error {
	if !strings.HasPrefix(targetAbs, baseAbs+string(filepath.Separator)) {
		return errors.New(errMsgPathTraversal)
	}
	sc := stubclient.Default()
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.MkdirAll(context.Background(), targetAbs)
}

// stubWriteFile 通过 personal-stub 写入文件内容。
// 架构合规：dh-backend 不直接写共享目录。
func stubWriteFile(path string, data []byte) error {
	sc := stubclient.Default()
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.WriteFile(context.Background(), path, string(data))
}

// stubDeleteFile 通过 personal-stub 删除文件，文件不存在时视为成功。
// 架构合规：dh-backend 不直接删除共享目录中的文件。
func stubDeleteFile(path string) error {
	if _, err := os.Stat(path); err != nil {
		return nil // 文件不存在，视为删除成功
	}
	sc := stubclient.Default()
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.DeleteFile(context.Background(), path)
}

// resolveVersionFilePath 解析 product_doc_versions 中存储的文件路径。
// 历史版本表中可能存储绝对路径；若路径已是绝对路径，则校验其位于用户的产品空间根目录下后直接使用。
func (s *DBProductSpaceService) resolveVersionFilePath(workspaceID, userID, storedPath string) (string, error) {
	if storedPath == "" {
		return "", errors.New("version file path is empty")
	}
	if filepath.IsAbs(storedPath) {
		// 校验已存储的绝对路径位于用户的产品空间根目录下，防止路径逃逸。
		// 先对 storedPath 做 Clean，避免 /base/.../etc/passwd 这类路径绕过前缀检查。
		base := filepath.Join(s.workspaceRoot, userID, workspaceID, object.ProductSpaceRoot)
		absBase, err := filepath.Abs(base)
		if err != nil {
			return "", err
		}
		cleaned := filepath.Clean(storedPath)
		if !strings.HasPrefix(cleaned, absBase+string(filepath.Separator)) && cleaned != absBase {
			return "", errors.New("version file path is outside workspace")
		}
		return cleaned, nil
	}
	return resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, storedPath)
}

// toRelativeFilePath 将版本表中存储的绝对或相对文件路径转换为产品空间根目录下的相对路径。
// 若路径位于产品空间根目录之外，则返回错误，防止 API 泄露服务器目录结构或路径逃逸。
func (s *DBProductSpaceService) toRelativeFilePath(storedPath, workspaceID, userID string) (string, error) {
	base := filepath.Join(s.workspaceRoot, userID, workspaceID, object.ProductSpaceRoot)
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}

	pathToCheck := storedPath
	if !filepath.IsAbs(storedPath) {
		pathToCheck = filepath.Join(absBase, storedPath)
	}

	rel, err := filepath.Rel(absBase, pathToCheck)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(rel, "..") {
		return "", errors.New("path outside product space")
	}
	return rel, nil
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
// copyFile 通过 personal-stub 复制文件：读取源文件（读操作，允许直接 os.ReadFile）
// 再通过 stubclient 写入目标文件（写操作，需委托 personal-stub）。
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return stubWriteFile(dst, data)
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
// 导致“invalid escape string”。因此查询端使用 ESCAPE '\''（单个反斜杠），本函数将转义字符输出为 "\\"。
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

// readFileBytes 根据相对路径读取文件内容。
func (s *DBProductSpaceService) readFileBytes(ctx context.Context, workspaceID, userID, relativePath string) ([]byte, error) {
	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("read file failed: %w", err)
	}
	return data, nil
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

// deleteVersionFiles 删除目录下所有匹配 name-v*.ext 的版本文件。
func deleteVersionFiles(dir, name, ext string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read directory failed: %w", err)
	}
	prefix := name + versionSuffix
	suffix := "." + ext
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		fname := entry.Name()
		if !strings.HasPrefix(fname, prefix) {
			continue
		}
		if !strings.HasSuffix(fname, suffix) {
			continue
		}
		if err := stubDeleteFile(filepath.Join(dir, fname)); err != nil {
			return fmt.Errorf("remove version file %s failed: %w", fname, err)
		}
	}
	return nil
}

// validateCreateItemRequest 校验新建条目请求的基本字段。
func validateCreateItemRequest(req *object.CreateItemRequest) error {
	if req.Title == "" {
		return errors.New(errMsgTitleEmpty)
	}
	switch req.Type {
	case object.ItemTypeDoc:
		if req.Content == "" {
			return errors.New(errMsgContentRequired)
		}
	case object.ItemTypePrototype:
		if len(req.FileData) == 0 {
			return errors.New(errMsgFileDataRequired)
		}
		if int64(len(req.FileData)) > object.MaxPrototypeSizeBytes {
			return fmt.Errorf("%s: %d bytes", errMsgPrototypeTooLarge, object.MaxPrototypeSizeBytes)
		}
	default:
		return errors.New(errMsgInvalidItemType)
	}
	return nil
}

// fetchItemWithExecer 按 ID + 工作空间 + 用户获取产品空间条目，支持传入 *sql.DB 或 *sql.Tx。
func (s *DBProductSpaceService) fetchItemWithExecer(ctx context.Context, q queryRowContextExecer, workspaceID, userID, itemID string) (*object.ProductSpaceItem, error) {
	var item object.ProductSpaceItem
	err := scanProductSpaceItem(q.QueryRowContext(ctx, `
		SELECT id, workspace_id, user_id, type, title, relative_path, current_version,
		       file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
		FROM product_docs
		WHERE id = $1 AND workspace_id = $2 AND user_id = $3
	`, itemID, workspaceID, userID), &item)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("fetch item failed: %w", err)
	}
	return &item, nil
}

// fetchItem 是 fetchItemWithExecer 的便捷方法，使用普通数据库连接。
func (s *DBProductSpaceService) fetchItem(ctx context.Context, workspaceID, userID, itemID string) (*object.ProductSpaceItem, error) {
	return s.fetchItemWithExecer(ctx, s.db, workspaceID, userID, itemID)
}

// fetchItemByRelativePath 按工作空间、用户与相对路径查询产品空间条目。
// 用于文档采纳时判断目标路径是否已存在。
func (s *DBProductSpaceService) fetchItemByRelativePath(ctx context.Context, workspaceID, userID, relativePath string) (*object.ProductSpaceItem, error) {
	const query = `
		SELECT id, workspace_id, user_id, type, title, relative_path, current_version,
		       file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
		FROM product_docs
		WHERE workspace_id = $1 AND user_id = $2 AND relative_path = $3
	`
	var item object.ProductSpaceItem
	err := scanProductSpaceItem(s.db.QueryRowContext(ctx, query, workspaceID, userID, relativePath), &item)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, fmt.Errorf("fetch item by relative path failed: %w", err)
	}
	return &item, nil
}

// fetchItemForUpdate 在事务中按 ID 获取产品空间条目，并对 product_docs 行加写锁。
// 使用单次 SELECT ... FOR UPDATE 查询，避免先读取再锁定时出现竞态条件导致 current_version 等字段过期。
// 调用方必须负责提交或回滚事务以释放锁。
func (s *DBProductSpaceService) fetchItemForUpdate(ctx context.Context, tx *sql.Tx, workspaceID, userID, itemID string) (*object.ProductSpaceItem, error) {
	const query = `
		SELECT id, workspace_id, user_id, type, title, relative_path, current_version,
		       file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
		FROM product_docs
		WHERE id = $1 AND workspace_id = $2 AND user_id = $3
		FOR UPDATE
	`
	var item object.ProductSpaceItem
	err := scanProductSpaceItem(tx.QueryRowContext(ctx, query, itemID, workspaceID, userID), &item)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, fmt.Errorf("fetch item for update failed: %w", err)
	}
	return &item, nil
}

// itemExistsByPath 根据工作空间、用户与相对路径查询是否仍存在 product_docs 记录。
// 用于 DeleteItem 提交后确认并发请求是否已创建同名新条目，避免误删新文件。
func (s *DBProductSpaceService) itemExistsByPath(ctx context.Context, workspaceID, userID, relativePath string) (bool, error) {
	var id string
	err := s.db.QueryRowContext(ctx,
		"SELECT id FROM product_docs WHERE workspace_id = $1 AND user_id = $2 AND relative_path = $3 LIMIT 1",
		workspaceID, userID, relativePath,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// folderHasItems 检查指定分类/文件夹下是否仍有 product_docs 记录。
// 用于 DeleteFolder 在删除磁盘目录前确认不会遗留孤儿数据库记录。
func (s *DBProductSpaceService) folderHasItems(ctx context.Context, workspaceID, userID, category, folder string) (bool, error) {
	const folderHasItemsQuery = `
		SELECT id FROM product_docs
		WHERE workspace_id = $1 AND user_id = $2 AND relative_path LIKE $3 ESCAPE '\'
		LIMIT 1
	`
	prefix := buildRelativePath(category, folder, "", "") + "/"
	var id string
	err := s.db.QueryRowContext(ctx, folderHasItemsQuery, workspaceID, userID, escapeLikePattern(prefix)+"%").Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// fetchVersionWithExecer 按文档 ID、工作空间、用户与版本号获取版本记录，支持传入 *sql.DB 或 *sql.Tx。
func (s *DBProductSpaceService) fetchVersionWithExecer(ctx context.Context, q queryRowContextExecer, workspaceID, userID, itemID string, version int) (*object.ProductSpaceVersion, error) {
	var v object.ProductSpaceVersion
	err := scanProductSpaceVersion(q.QueryRowContext(ctx, `
		SELECT v.id, v.doc_id, v.version, v.title, v.file_path, v.file_ext, v.mime_type, v.size_bytes, v.change_summary, v.created_by, v.created_at
		FROM product_doc_versions v
		JOIN product_docs d ON d.id = v.doc_id
		WHERE v.doc_id = $1 AND d.workspace_id = $2 AND d.user_id = $3 AND v.version = $4
	`, itemID, workspaceID, userID, version), &v)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgVersionNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("fetch version failed: %w", err)
	}
	return &v, nil
}

// fetchVersion 是 fetchVersionWithExecer 的便捷方法，使用普通数据库连接。
func (s *DBProductSpaceService) fetchVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (*object.ProductSpaceVersion, error) {
	return s.fetchVersionWithExecer(ctx, s.db, workspaceID, userID, itemID, version)
}

// insertProductDoc 将新条目写入 product_docs 并返回完整对象。
func (s *DBProductSpaceService) insertProductDoc(
	ctx context.Context,
	q queryRowContextExecer,
	id, workspaceID, userID, itemType, title, slug, relativePath, content, status string,
	currentVersion int, fileExt, mimeType string, sizeBytes int64, createdBy string,
) (*object.ProductSpaceItem, error) {
	now := time.Now().UTC()
	var item object.ProductSpaceItem
	err := scanProductSpaceItem(q.QueryRowContext(ctx, `
	INSERT INTO product_docs (
		id, workspace_id, user_id, type, title, slug, relative_path, content,
		status, current_version, file_ext, mime_type, size_bytes, created_by, category, created_at, updated_at
	)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
	RETURNING id, workspace_id, user_id, type, title, relative_path, current_version,
	          file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
	`, id, workspaceID, userID, itemType, title, slug, relativePath, content,
		status, currentVersion, fileExt, mimeType, sizeBytes, createdBy, itemType, now, now,
	), &item)
	if err != nil {
		return nil, fmt.Errorf("insert product doc failed: %w", err)
	}
	return &item, nil
}

// syncPrototypeFilesFromDisk 扫描磁盘 products/prototypes 目录，将未在 product_docs 中注册的 .html 文件自动入库。
// 自动注册仅用于适配 /proto-make 等 AI 指令生成的纯前端工程页面，使其无需手动创建即可在产品空间展示。
// 注册失败的文件仅记录日志，不影响整体目录树返回。
func (s *DBProductSpaceService) syncPrototypeFilesFromDisk(ctx context.Context, workspaceID, userID string, root map[string]*object.ProductSpaceTreeNode) error {
	protoPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, object.ProductSpacePrototypesDir)
	if err != nil {
		return err
	}
	if err := rejectSymlink(protoPath); err != nil {
		return fmt.Errorf("prototypes directory symlink check failed: %w", err)
	}

	existing := make(map[string]struct{})
	var collect func(nodes []object.ProductSpaceTreeNode)
	collect = func(nodes []object.ProductSpaceTreeNode) {
		for _, n := range nodes {
			if n.Type == object.ItemTypePrototype {
				existing[n.Path] = struct{}{}
			}
			collect(n.Children)
		}
	}
	for _, catName := range []string{object.ProductSpaceDocsDir, object.ProductSpacePrototypesDir} {
		collect(root[catName].Children)
	}

	return filepath.WalkDir(protoPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == protoPath {
			return nil
		}
		// 隐藏目录（.git / .vite 等）跳过，避免将工程元数据注册为原型页面
		if d.IsDir() && strings.HasPrefix(d.Name(), ".") {
			return filepath.SkipDir
		}
		if d.IsDir() {
			return nil
		}
		if strings.ToLower(filepath.Ext(path)) != ".html" {
			return nil
		}
		if err := rejectSymlink(path); err != nil {
			log.Printf("reject symlink for prototype file %s failed: %v", path, err)
			return nil
		}
		rel, err := filepath.Rel(protoPath, path)
		if err != nil {
			log.Printf("compute relative path for prototype file %s failed: %v", path, err)
			return nil
		}
		relPath := filepath.Join(object.ProductSpacePrototypesDir, filepath.ToSlash(rel))
		if _, ok := existing[relPath]; ok {
			return nil
		}

		// 对 Node/Vite 工程，优先使用 dist/index.html 作为产品空间入口。
		// 如果工程根目录存在 dist/index.html，则忽略根目录的 index.html（无法直接预览）。
		if strings.EqualFold(filepath.Base(path), "index.html") {
			dirParts := strings.Split(filepath.ToSlash(filepath.Dir(rel)), "/")
			if len(dirParts) == 1 {
				distIndex := filepath.Join(filepath.Dir(path), "dist", "index.html")
				if info, err := os.Stat(distIndex); err == nil && !info.IsDir() {
					return nil
				}
			}
		}

		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("read prototype file %s failed: %v", path, err)
			return nil
		}

		title := filepath.Base(path)
		size := int64(len(data))
		content := base64.StdEncoding.EncodeToString(data)
		id := uuid.NewString()
		item, err := s.insertProductDoc(
			ctx, s.db, id, workspaceID, userID, object.ItemTypePrototype, title, id, relPath,
			content, ItemStatusDraft, 1, "html", mimeTypeForExt("html"), size, userID,
		)
		if err != nil {
			log.Printf("register prototype file %s failed: %v", relPath, err)
			return nil
		}
		existing[relPath] = struct{}{}

		category, folder, name, _, err := parseRelativePath(item.RelativePath)
		if err != nil {
			log.Printf("parse relative path %s failed: %v", item.RelativePath, err)
			return nil
		}
		rootNode, ok := root[category]
		if !ok {
			return nil
		}
		fileNode := object.ProductSpaceTreeNode{
			ID:   item.ID,
			Name: name,
			Path: item.RelativePath,
			Type: item.Type,
		}
		if folder == "" {
			rootNode.Children = append(rootNode.Children, fileNode)
			return nil
		}
		folderNode := findOrCreateFolder(rootNode, folder)
		folderNode.Children = append(folderNode.Children, fileNode)
		return nil
	})
}

// GetTree 返回指定用户产品空间的目录树。
func (s *DBProductSpaceService) GetTree(ctx context.Context, workspaceID, userID string) ([]object.ProductSpaceTreeNode, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, user_id, type, title, relative_path, current_version,
		       file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
		FROM product_docs
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("list product space items failed: %w", err)
	}
	defer rows.Close()

	root := map[string]*object.ProductSpaceTreeNode{
		object.ProductSpaceDocsDir:       {Name: object.ProductSpaceDocsDir, Path: object.ProductSpaceDocsDir, Type: object.NodeTypeFolder},
		object.ProductSpacePrototypesDir: {Name: object.ProductSpacePrototypesDir, Path: object.ProductSpacePrototypesDir, Type: object.NodeTypeFolder},
	}

	for rows.Next() {
		var item object.ProductSpaceItem
		if err := scanProductSpaceItem(rows, &item); err != nil {
			return nil, fmt.Errorf("scan item failed: %w", err)
		}
		category, folder, name, _, err := parseRelativePath(item.RelativePath)
		if err != nil {
			return nil, err
		}
		rootNode, ok := root[category]
		if !ok {
			continue
		}
		fileNode := object.ProductSpaceTreeNode{
			ID:   item.ID,
			Name: name,
			Path: item.RelativePath,
			Type: item.Type,
		}
		if folder == "" {
			rootNode.Children = append(rootNode.Children, fileNode)
			continue
		}
		folderNode := findOrCreateFolder(rootNode, folder)
		folderNode.Children = append(folderNode.Children, fileNode)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate items failed: %w", err)
	}

	roots := []object.ProductSpaceTreeNode{*root[object.ProductSpaceDocsDir], *root[object.ProductSpacePrototypesDir]}

	// 在补充空文件夹前，校验分类目录本身不是符号链接，防止目录树读取被软链接重定向到工作区之外。
	for _, catName := range []string{object.ProductSpaceDocsDir, object.ProductSpacePrototypesDir} {
		catPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, catName)
		if err != nil {
			return nil, err
		}
		if err := rejectSymlink(catPath); err != nil {
			return nil, fmt.Errorf("category directory symlink check failed: %w", err)
		}
	}

	return s.appendEmptyFolders(ctx, workspaceID, userID, roots)
}

// appendEmptyFolders 扫描磁盘上产品空间的 docs 与 prototypes 目录，将数据库中无条目的空文件夹补充到树中。
func (s *DBProductSpaceService) appendEmptyFolders(ctx context.Context, workspaceID, userID string, roots []object.ProductSpaceTreeNode) ([]object.ProductSpaceTreeNode, error) {
	categories := []struct {
		name string
		idx  int
	}{
		{object.ProductSpaceDocsDir, 0},
		{object.ProductSpacePrototypesDir, 1},
	}
	for _, cat := range categories {
		catPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, cat.name)
		if err != nil {
			return nil, err
		}
		if err := rejectSymlink(catPath); err != nil {
			return nil, fmt.Errorf("category directory symlink check failed: %w", err)
		}
		// 递归扫描分类目录下的所有子目录，确保空的多级文件夹也能出现在树中。
		if err := filepath.WalkDir(catPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if path == catPath || !d.IsDir() {
				return nil
			}
			// 隐藏目录（.git / .vite / node_modules 等）不展示在树中
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			if err := rejectSymlink(path); err != nil {
				return fmt.Errorf("folder symlink check failed: %w", err)
			}
			rel, err := filepath.Rel(catPath, path)
			if err != nil {
				return err
			}
			findOrCreateFolder(&roots[cat.idx], filepath.ToSlash(rel))
			return nil
		}); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("walk category directory %s failed: %w", cat.name, err)
		}
	}
	return roots, nil
}

// findOrCreateFolder 在父节点下查找或创建文件夹节点（支持多级子目录），并返回最深层节点。
func findOrCreateFolder(parent *object.ProductSpaceTreeNode, folder string) *object.ProductSpaceTreeNode {
	segments := splitFolderPath(folder)
	if len(segments) == 0 {
		return parent
	}
	current := parent
	for _, seg := range segments {
		found := -1
		for i := range current.Children {
			if current.Children[i].Name == seg && current.Children[i].Type == object.NodeTypeFolder {
				found = i
				break
			}
		}
		if found == -1 {
			current.Children = append(current.Children, object.ProductSpaceTreeNode{
				Name: seg,
				Path: filepath.Join(current.Path, seg),
				Type: object.NodeTypeFolder,
			})
			found = len(current.Children) - 1
		}
		current = &current.Children[found]
	}
	return current
}

// CreateItem 创建新的文档或原型条目，并写入初始文件。
func (s *DBProductSpaceService) CreateItem(ctx context.Context, workspaceID, userID string, req object.CreateItemRequest) (*object.ProductSpaceItem, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	if err := validateCreateItemRequest(&req); err != nil {
		return nil, invalidInput(err)
	}

	if req.Type == object.ItemTypeDoc && int64(len(req.Content)) > object.MaxDocSizeBytes {
		return nil, invalidInput(errors.New(errMsgDocTooLarge))
	}

	categoryDir, err := typeToCategoryDir(req.Type)
	if err != nil {
		return nil, invalidInput(err)
	}

	if strings.ContainsAny(req.Title, `/\`) {
		return nil, invalidInput(errors.New(errMsgTitlePathSeparator))
	}

	title, err := sanitizeName(req.Title)
	if err != nil {
		return nil, invalidInput(fmt.Errorf("invalid title: %w", err))
	}
	if len([]rune(title)) > maxTitleLength {
		return nil, invalidInput(errors.New(errMsgTitleTooLong))
	}
	folder := ""
	if req.Folder != "" {
		folder, err = sanitizeFolderPath(req.Folder)
		if err != nil {
			return nil, invalidInput(err)
		}
	}

	ext, err := parseAndValidateExt(req.Type, title)
	if err != nil {
		return nil, invalidInput(err)
	}
	name := stripExt(title, ext)
	mime := mimeTypeForExt(ext)

	var data []byte
	var content string
	switch req.Type {
	case object.ItemTypeDoc:
		data = []byte(req.Content)
		content = req.Content
	case object.ItemTypePrototype:
		data = req.FileData
		content = base64.StdEncoding.EncodeToString(req.FileData)
	}

	// 原型文件在 product_docs.content 中存储 base64 编码内容，与 UpdateContent / RestoreVersion 保持一致。

	size := int64(len(data))

	relativePath := buildRelativePath(categoryDir, folder, name, ext)
	if err := validateRelativePath(relativePath); err != nil {
		return nil, invalidInput(err)
	}
	baseAbs, absPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, invalidInput(err)
	}

	// 先启动事务并插入数据库记录，利用唯一索引锁定路径，避免并发请求先写磁盘再冲突时误删已提交文件。
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	id := uuid.New().String()
	item, err := s.insertProductDoc(
		ctx, tx, id, workspaceID, userID, req.Type, title, id, relativePath,
		content, ItemStatusDraft, 1, ext, mime, size, userID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: %s", ErrConflict, errMsgItemAlreadyExists)
		}
		return nil, err
	}

	// 数据库记录插入成功后，再安全地创建目录并写入文件；safeMkdirAll 逐级检查父目录，防止软链接逃逸。
	if err := rejectSymlink(absPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}
	if err := safeMkdirAll(baseAbs, filepath.Dir(absPath)); err != nil {
		return nil, err
	}

	if err := stubWriteFile(absPath, data); err != nil {
		_ = tx.Rollback()
		_ = stubDeleteFile(absPath)
		return nil, fmt.Errorf("write initial file failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		_ = stubDeleteFile(absPath)
		return nil, fmt.Errorf("commit transaction failed: %w", err)
	}

	return item, nil
}

// GetItem 获取条目元数据与当前文件内容。
func (s *DBProductSpaceService) GetItem(ctx context.Context, workspaceID, userID, itemID string) (*object.ProductSpaceItem, []byte, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, nil, err
	}

	item, err := s.fetchItem(ctx, workspaceID, userID, itemID)
	if err != nil {
		return nil, nil, err
	}
	data, err := s.readFileBytes(ctx, workspaceID, userID, item.RelativePath)
	if err != nil {
		return nil, nil, err
	}
	return item, data, nil
}

// updatePrototypeContentTx 在已开启的事务中更新原型条目的当前文件内容，并创建历史版本快照。
// 调用方必须已获取 item 的写锁，并负责提交或回滚事务；本函数返回 currentAbsPath、versionAbsPath
// 与 oldBytes，供调用方在事务提交失败时恢复文件系统变更。
func (s *DBProductSpaceService) updatePrototypeContentTx(
	ctx context.Context,
	tx *sql.Tx,
	workspaceID, userID string,
	item *object.ProductSpaceItem,
	newContent []byte,
	changeSummary string,
) (currentAbsPath string, versionAbsPath string, oldBytes []byte, err error) {
	if item.Type != object.ItemTypePrototype {
		return "", "", nil, invalidInput(errors.New(errMsgInvalidItemType))
	}
	if int64(len(newContent)) > object.MaxPrototypeSizeBytes {
		return "", "", nil, invalidInput(errors.New(errMsgPrototypeTooLarge))
	}

	category, folder, name, ext, err := parseRelativePath(item.RelativePath)
	if err != nil {
		return "", "", nil, invalidInput(err)
	}

	baseAbs, currentAbsPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, item.RelativePath)
	if err != nil {
		return "", "", nil, err
	}
	if err := rejectSymlink(currentAbsPath); err != nil {
		return "", "", nil, fmt.Errorf("current file symlink check failed: %w", err)
	}

	oldBytes, err = os.ReadFile(currentAbsPath)
	if err != nil {
		return "", "", nil, fmt.Errorf("read current file failed: %w", err)
	}

	if len([]rune(changeSummary)) > maxChangeSummaryLength {
		return "", "", nil, invalidInput(errors.New(errMsgChangeSummaryTooLong))
	}

	versionRelPath := buildVersionRelativePath(category, folder, name, ext, item.CurrentVersion)
	versionAbsPath, err = resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, versionRelPath)
	if err != nil {
		return "", "", nil, err
	}
	if err := rejectSymlink(versionAbsPath); err != nil {
		return "", "", nil, fmt.Errorf("version file symlink check failed: %w", err)
	}
	if err := safeMkdirAll(baseAbs, filepath.Dir(versionAbsPath)); err != nil {
		return "", "", nil, err
	}
	if err := copyFile(currentAbsPath, versionAbsPath); err != nil {
		return "", "", nil, fmt.Errorf("backup current version failed: %w", err)
	}

	if err := stubWriteFile(currentAbsPath, newContent); err != nil {
		_ = stubDeleteFile(versionAbsPath)
		return "", "", nil, fmt.Errorf("write new content failed: %w", err)
	}

	contentBase64 := base64.StdEncoding.EncodeToString(newContent)
	if err := s.saveVersionAndUpdateTx(ctx, tx, item, versionRelPath, contentBase64, changeSummary, userID, oldBytes, newContent); err != nil {
		_ = stubWriteFile(currentAbsPath, oldBytes)
		_ = stubDeleteFile(versionAbsPath)
		return "", "", nil, err
	}

	return currentAbsPath, versionAbsPath, oldBytes, nil
}

// UpdateContent 更新文档内容，原内容快照为历史版本。
func (s *DBProductSpaceService) UpdateContent(ctx context.Context, workspaceID, userID, itemID string, req object.UpdateContentRequest) (*object.ProductSpaceItem, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	item, err := s.fetchItemForUpdate(ctx, tx, workspaceID, userID, itemID)
	if err != nil {
		return nil, err
	}

	if item.Type == object.ItemTypeDoc && int64(len(req.Content)) > object.MaxDocSizeBytes {
		return nil, invalidInput(errors.New(errMsgDocTooLarge))
	}

	// 先校验并解码新内容，确认合法后再创建版本快照，避免生成孤儿版本文件。
	var newData []byte
	if item.Type == object.ItemTypePrototype {
		// Base64 is ~4/3 of original size plus padding
		maxBase64Len := int(base64.StdEncoding.EncodedLen(int(object.MaxPrototypeSizeBytes)))
		if len(req.Content) > maxBase64Len {
			return nil, invalidInput(errors.New(errMsgPrototypeTooLarge))
		}
		decoded, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return nil, invalidInput(fmt.Errorf("invalid base64 data: %w", err))
		}
		if int64(len(decoded)) > object.MaxPrototypeSizeBytes {
			return nil, invalidInput(errors.New(errMsgPrototypeTooLarge))
		}
		newData = decoded

		currentAbsPath, versionAbsPath, oldBytes, err := s.updatePrototypeContentTx(ctx, tx, workspaceID, userID, item, newData, req.ChangeSummary)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			_ = stubWriteFile(currentAbsPath, oldBytes)
			_ = stubDeleteFile(versionAbsPath)
			return nil, fmt.Errorf("commit transaction failed: %w", err)
		}
		return s.fetchItem(ctx, workspaceID, userID, itemID)
	}

	// 文档类型：直接保存文本内容
	if int64(len(req.Content)) > object.MaxDocSizeBytes {
		return nil, invalidInput(errors.New(errMsgDocTooLarge))
	}
	newData = []byte(req.Content)

	category, folder, name, ext, err := parseRelativePath(item.RelativePath)
	if err != nil {
		return nil, invalidInput(err)
	}

	baseAbs, currentAbsPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, item.RelativePath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(currentAbsPath); err != nil {
		return nil, fmt.Errorf("current file symlink check failed: %w", err)
	}

	oldBytes, err := os.ReadFile(currentAbsPath)
	if err != nil {
		return nil, fmt.Errorf("read current file failed: %w", err)
	}

	if len([]rune(req.ChangeSummary)) > maxChangeSummaryLength {
		return nil, invalidInput(errors.New(errMsgChangeSummaryTooLong))
	}

	versionRelPath := buildVersionRelativePath(category, folder, name, ext, item.CurrentVersion)
	versionAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, versionRelPath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(versionAbsPath); err != nil {
		return nil, fmt.Errorf("version file symlink check failed: %w", err)
	}
	if err := safeMkdirAll(baseAbs, filepath.Dir(versionAbsPath)); err != nil {
		return nil, err
	}
	if err := copyFile(currentAbsPath, versionAbsPath); err != nil {
		return nil, fmt.Errorf("backup current version failed: %w", err)
	}

	if err := stubWriteFile(currentAbsPath, newData); err != nil {
		_ = stubDeleteFile(versionAbsPath)
		return nil, fmt.Errorf("write new content failed: %w", err)
	}

	if err := s.saveVersionAndUpdateTx(ctx, tx, item, versionRelPath, req.Content, req.ChangeSummary, userID, oldBytes, newData); err != nil {
		_ = stubWriteFile(currentAbsPath, oldBytes)
		_ = stubDeleteFile(versionAbsPath)
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		_ = stubWriteFile(currentAbsPath, oldBytes)
		_ = stubDeleteFile(versionAbsPath)
		return nil, fmt.Errorf("commit transaction failed: %w", err)
	}

	return s.fetchItem(ctx, workspaceID, userID, itemID)
}

// ImportDoc 将用户个人工作目录中的文档文件采纳到产品空间 docs 目录。
// 若目标相对路径已存在 doc 条目，则更新内容并创建新版本；否则新建条目。
// 导入成功后不删除源文件，保持与原型采纳（ImportPrototype）一致的"复制"语义。
func (s *DBProductSpaceService) ImportDoc(ctx context.Context, workspaceID, userID string, req object.ImportDocRequest) (*object.ProductSpaceItem, error) {
	if err := s.requireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	if req.Path == "" {
		return nil, invalidInput(errors.New("path is required"))
	}

	sc := stubclient.Default()
	if sc == nil {
		return nil, errors.New("personal-stub client not initialized")
	}

	content, err := sc.ReadFile(ctx, req.Path)
	if err != nil {
		return nil, fmt.Errorf("%w: source file not found", ErrNotFound)
	}

	// 从源路径提取文件名，并确保有合法扩展名。
	title := filepath.Base(req.Path)
	ext := parseExtFromName(title)
	if ext == "" {
		ext = object.DocExtMarkdown
		title = title + "." + ext
	}
	if !object.AllowedDocExts[ext] {
		return nil, invalidInput(errors.New(errMsgInvalidExtension))
	}

	folder := ""
	if req.Folder != "" {
		folder, err = sanitizeFolderPath(req.Folder)
		if err != nil {
			return nil, invalidInput(err)
		}
	}

	name := stripExt(title, ext)
	relativePath := buildRelativePath(object.ProductSpaceDocsDir, folder, name, ext)
	if err := validateRelativePath(relativePath); err != nil {
		return nil, invalidInput(err)
	}

	existing, err := s.fetchItemByRelativePath(ctx, workspaceID, userID, relativePath)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	if existing != nil {
		item, updateErr := s.UpdateContent(ctx, workspaceID, userID, existing.ID, object.UpdateContentRequest{
			Content:       content,
			ChangeSummary: "采纳文档",
		})
		if updateErr != nil {
			return nil, updateErr
		}
		if err := s.updateSourcePath(ctx, item.ID, req.Path); err != nil {
			log.Printf("[ProductSpace] ImportDoc update source_path failed for %s: %v", item.ID, err)
		}
		return item, nil
	}

	createReq := object.CreateItemRequest{
		Type:    object.ItemTypeDoc,
		Title:   title,
		Folder:  folder,
		Content: content,
	}
	item, err := s.CreateItem(ctx, workspaceID, userID, createReq)
	if err != nil {
		return nil, err
	}
	if err := s.updateSourcePath(ctx, item.ID, req.Path); err != nil {
		log.Printf("[ProductSpace] ImportDoc update source_path failed for %s: %v", item.ID, err)
	}
	return item, nil
}

// updateSourcePath 将文档采纳时的源文件路径记录到 product_docs.source_path。
func (s *DBProductSpaceService) updateSourcePath(ctx context.Context, itemID, sourcePath string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE product_docs
		SET source_path = $1
		WHERE id = $2
	`, sourcePath, itemID)
	if err != nil {
		return fmt.Errorf("update source_path failed: %w", err)
	}
	return nil
}

// GetDocImportStatus 按源文件路径查询该文档是否已被采纳到产品空间。
// 通过 source_path 精确匹配，避免同名文件误判。
// 返回对应条目；未找到时返回 ErrNotFound。
func (s *DBProductSpaceService) GetDocImportStatus(ctx context.Context, workspaceID, userID, sourcePath string) (*object.ProductSpaceItem, error) {
	if err := s.requireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	if sourcePath == "" {
		return nil, invalidInput(errors.New("path is required"))
	}

	var item object.ProductSpaceItem
	err := scanProductSpaceItem(s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, user_id, type, title, relative_path, current_version,
		       file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
		FROM product_docs
		WHERE workspace_id = $1 AND user_id = $2 AND type = $3 AND source_path = $4
		LIMIT 1
	`, workspaceID, userID, object.ItemTypeDoc, sourcePath), &item)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, fmt.Errorf("fetch doc import status failed: %w", err)
	}
	return &item, nil
}

// updatePrototypeContentByID 按条目 ID 更新原型内容并创建新版本。
// 调用方已负责权限校验，本函数不再重复检查。
// 返回 true 表示内容已变化并创建了版本；false 表示新内容与现有内容一致，未创建版本。
func (s *DBProductSpaceService) updatePrototypeContentByID(
	ctx context.Context,
	workspaceID, userID, itemID string,
	newContent []byte,
	changeSummary string,
) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	item, err := s.fetchItemForUpdate(ctx, tx, workspaceID, userID, itemID)
	if err != nil {
		return false, err
	}

	currentAbsPath, versionAbsPath, oldBytes, err := s.updatePrototypeContentTx(ctx, tx, workspaceID, userID, item, newContent, changeSummary)
	if err != nil {
		return false, err
	}
	if oldBytes == nil {
		// 内容未变化：updatePrototypeContentTx 不会走到这里，但防御性返回。
		return false, nil
	}
	if bytes.Equal(oldBytes, newContent) {
		return false, nil
	}

	if err := tx.Commit(); err != nil {
		_ = stubWriteFile(currentAbsPath, oldBytes)
		_ = stubDeleteFile(versionAbsPath)
		return false, fmt.Errorf("commit transaction failed: %w", err)
	}

	return true, nil
}

// saveVersionAndUpdateTx 在事务中插入版本快照并递增当前版本号。
// 调用方必须负责提交或回滚事务。
func (s *DBProductSpaceService) saveVersionAndUpdateTx(
	ctx context.Context,
	tx *sql.Tx,
	item *object.ProductSpaceItem,
	versionFilePath, content, changeSummary, userID string,
	oldBytes, newBytes []byte,
) error {
	now := time.Now().UTC()

	versionID := uuid.New().String()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO product_doc_versions (
			id, doc_id, version, title, file_path, file_ext, mime_type, size_bytes, change_summary, created_by, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, versionID, item.ID, item.CurrentVersion, item.Title, versionFilePath,
		item.FileExt, item.MimeType, int64(len(oldBytes)), changeSummary, userID, now,
	); err != nil {
		return fmt.Errorf("insert version failed: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE product_docs
		SET content = $1, current_version = $2, size_bytes = $3, updated_at = $4
		WHERE id = $5 AND workspace_id = $6 AND user_id = $7
	`, content, item.CurrentVersion+1, int64(len(newBytes)), now, item.ID, item.WorkspaceID, item.UserID)
	if err != nil {
		return fmt.Errorf("update item version failed: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check affected rows failed: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}

	return nil
}

// ListVersions 返回条目的版本历史列表。
func (s *DBProductSpaceService) ListVersions(ctx context.Context, workspaceID, userID, itemID string) ([]object.ProductSpaceVersion, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	_, err := s.fetchItem(ctx, workspaceID, userID, itemID)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT v.id, v.doc_id, v.version, v.title, v.file_path, v.file_ext, v.mime_type, v.size_bytes, v.change_summary, v.created_by, v.created_at
		FROM product_doc_versions v
		JOIN product_docs d ON d.id = v.doc_id
		WHERE v.doc_id = $1 AND d.workspace_id = $2 AND d.user_id = $3
		ORDER BY version DESC
	`, itemID, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("list versions failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.ProductSpaceVersion, 0)
	for rows.Next() {
		var v object.ProductSpaceVersion
		if err := scanProductSpaceVersion(rows, &v); err != nil {
			return nil, fmt.Errorf("scan version failed: %w", err)
		}
		rel, err := s.toRelativeFilePath(v.FilePath, workspaceID, userID)
		if err != nil {
			return nil, fmt.Errorf("normalize version file path failed: %w", err)
		}
		v.FilePath = rel
		result = append(result, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate versions failed: %w", err)
	}
	return result, nil
}

// RestoreVersion 将指定历史版本恢复为当前版本。
// 操作流程：
//  1. 在事务中锁定条目并读取目标版本记录；
//  2. 备份当前文件内容；
//  3. 将目标版本文件复制到当前文件路径；
//  4. 读取恢复后的当前文件内容；
//  5. 将恢复后的内容写入新的不可变快照文件（v{current_version+1}）；
//  6. 插入一条版本记录，change_summary 为 "恢复至 vN"；
//  7. 更新 product_docs 的 current_version、content、size_bytes、updated_at。
//
// 任何在覆盖当前文件之后的失败都会回滚文件系统变更：恢复原始当前文件并删除新建快照。
func (s *DBProductSpaceService) RestoreVersion(ctx context.Context, workspaceID, userID, itemID string, targetVersion int) (*object.ProductSpaceItem, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	item, err := s.fetchItemForUpdate(ctx, tx, workspaceID, userID, itemID)
	if err != nil {
		return nil, err
	}

	if targetVersion <= 0 || targetVersion >= item.CurrentVersion {
		return nil, invalidInput(errors.New(errMsgInvalidVersion))
	}

	versionRecord, err := s.fetchVersionWithExecer(ctx, tx, workspaceID, userID, itemID, targetVersion)
	if err != nil {
		return nil, err
	}

	baseAbs, currentAbsPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, item.RelativePath)
	if err != nil {
		return nil, err
	}

	sourceVersionAbsPath, err := s.resolveVersionFilePath(workspaceID, userID, versionRecord.FilePath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(sourceVersionAbsPath); err != nil {
		return nil, fmt.Errorf("source version file symlink check failed: %w", err)
	}

	category, folder, name, ext, err := parseRelativePath(item.RelativePath)
	if err != nil {
		return nil, invalidInput(err)
	}

	nextVersion := item.CurrentVersion + 1
	snapshotRelPath := buildVersionRelativePath(category, folder, name, ext, nextVersion)
	snapshotAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, snapshotRelPath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(currentAbsPath); err != nil {
		return nil, fmt.Errorf("current file symlink check failed: %w", err)
	}
	if err := rejectSymlink(snapshotAbsPath); err != nil {
		return nil, fmt.Errorf("snapshot file symlink check failed: %w", err)
	}
	if err := safeMkdirAll(baseAbs, filepath.Dir(snapshotAbsPath)); err != nil {
		return nil, err
	}

	changeSummary := fmt.Sprintf(changeSummaryRestoreToVersion, targetVersion)
	if len([]rune(changeSummary)) > maxChangeSummaryLength {
		return nil, invalidInput(errors.New(errMsgChangeSummaryTooLong))
	}

	oldBytes, err := os.ReadFile(currentAbsPath)
	if err != nil {
		return nil, fmt.Errorf("read current file failed: %w", err)
	}

	rollbackFS := func() {
		_ = stubWriteFile(currentAbsPath, oldBytes)
		_ = stubDeleteFile(snapshotAbsPath)
	}

	if err := copyFile(sourceVersionAbsPath, currentAbsPath); err != nil {
		rollbackFS()
		return nil, fmt.Errorf("restore version file failed: %w", err)
	}

	restoredBytes, err := os.ReadFile(currentAbsPath)
	if err != nil {
		rollbackFS()
		return nil, fmt.Errorf("read restored file failed: %w", err)
	}

	if err := stubWriteFile(snapshotAbsPath, restoredBytes); err != nil {
		rollbackFS()
		return nil, fmt.Errorf("create restore snapshot failed: %w", err)
	}

	now := time.Now().UTC()
	versionID := uuid.New().String()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO product_doc_versions (
			id, doc_id, version, title, file_path, file_ext, mime_type, size_bytes, change_summary, created_by, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, versionID, item.ID, nextVersion, item.Title, snapshotRelPath,
		item.FileExt, item.MimeType, int64(len(restoredBytes)), fmt.Sprintf(changeSummaryRestoreToVersion, targetVersion), userID, now,
	); err != nil {
		rollbackFS()
		return nil, fmt.Errorf("insert version failed: %w", err)
	}

	contentStr := string(restoredBytes)
	if item.Type == object.ItemTypePrototype {
		contentStr = base64.StdEncoding.EncodeToString(restoredBytes)
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE product_docs
		SET content = $1, current_version = $2, size_bytes = $3, updated_at = $4
		WHERE id = $5 AND workspace_id = $6 AND user_id = $7
	`, contentStr, nextVersion, int64(len(restoredBytes)), now, item.ID, item.WorkspaceID, item.UserID)
	if err != nil {
		rollbackFS()
		return nil, fmt.Errorf("update item version failed: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		rollbackFS()
		return nil, fmt.Errorf("check affected rows failed: %w", err)
	}
	if affected == 0 {
		rollbackFS()
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}

	if err := tx.Commit(); err != nil {
		rollbackFS()
		return nil, fmt.Errorf("commit transaction failed: %w", err)
	}

	return s.fetchItem(ctx, workspaceID, userID, itemID)
}

// DeleteItem 删除条目及其所有历史版本文件。
func (s *DBProductSpaceService) DeleteItem(ctx context.Context, workspaceID, userID, itemID string) error {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	item, err := s.fetchItemForUpdate(ctx, tx, workspaceID, userID, itemID)
	if err != nil {
		return err
	}

	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, item.RelativePath)
	if err != nil {
		return err
	}
	if err := rejectSymlink(absPath); err != nil {
		return fmt.Errorf("current file symlink check failed: %w", err)
	}
	_, _, name, ext, err := parseRelativePath(item.RelativePath)
	if err != nil {
		return err
	}

	// 历史版本文件统一存放在 products/versions/ 平行目录下。
	versionDirRel := filepath.Join(object.ProductSpaceVersionsDir, filepath.Dir(item.RelativePath))
	versionDir, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, versionDirRel)
	if err != nil {
		return err
	}
	if err := rejectSymlink(versionDir); err != nil {
		return fmt.Errorf("version directory symlink check failed: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM product_doc_versions WHERE doc_id = $1`, itemID); err != nil {
		return fmt.Errorf("delete versions failed: %w", err)
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM product_docs WHERE id = $1`, itemID)
	if err != nil {
		return fmt.Errorf("delete item failed: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check affected rows failed: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction failed: %w", err)
	}

	// 数据库记录已成功删除，再清理文件系统；文件清理失败不影响删除结果。
	// 为避免并发请求在事务提交后、文件删除前创建同名新条目导致误删，先确认该相对路径已无记录。
	exists, err := s.itemExistsByPath(ctx, workspaceID, userID, item.RelativePath)
	if err != nil {
		log.Printf("check item existence by path failed: %v", err)
		return nil
	}
	if exists {
		return nil
	}

	if err := stubDeleteFile(absPath); err != nil {
		log.Printf("remove current file %s failed: %v", absPath, err)
	}
	if err := deleteVersionFiles(versionDir, name, ext); err != nil {
		log.Printf("remove version files in %s failed: %v", versionDir, err)
	}

	return nil
}

// CreateFolder 在磁盘上创建产品空间文件夹，支持多级子目录。
func (s *DBProductSpaceService) CreateFolder(ctx context.Context, workspaceID, userID string, req object.CreateFolderRequest) error {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return err
	}

	if err := validateCategory(req.Category); err != nil {
		return invalidInput(err)
	}
	folder, err := sanitizeFolderPath(req.Name)
	if err != nil {
		return invalidInput(err)
	}
	baseAbs, catPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, req.Category)
	if err != nil {
		return invalidInput(err)
	}
	if err := rejectSymlink(catPath); err != nil {
		return fmt.Errorf("category directory symlink check failed: %w", err)
	}
	relativePath := filepath.Join(req.Category, folder)
	if err := validateRelativePath(relativePath); err != nil {
		return invalidInput(err)
	}
	_, absPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return invalidInput(err)
	}
	if err := rejectSymlink(absPath); err != nil {
		return fmt.Errorf("folder symlink check failed: %w", err)
	}
	if err := safeMkdirAll(baseAbs, absPath); err != nil {
		return fmt.Errorf("create folder failed: %w", err)
	}
	return nil
}

// DeleteFolder 删除空文件夹，支持多级子目录。
func (s *DBProductSpaceService) DeleteFolder(ctx context.Context, workspaceID, userID string, req object.DeleteFolderRequest) error {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return err
	}

	if err := validateCategory(req.Category); err != nil {
		return invalidInput(err)
	}
	folder, err := sanitizeFolderPath(req.Name)
	if err != nil {
		return invalidInput(err)
	}
	catPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, req.Category)
	if err != nil {
		return invalidInput(err)
	}
	if err := rejectSymlink(catPath); err != nil {
		return fmt.Errorf("category directory symlink check failed: %w", err)
	}
	relativePath := filepath.Join(req.Category, folder)
	if err := validateRelativePath(relativePath); err != nil {
		return invalidInput(err)
	}
	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return invalidInput(err)
	}
	if err := rejectSymlink(absPath); err != nil {
		return fmt.Errorf("folder symlink check failed: %w", err)
	}

	hasItems, err := s.folderHasItems(ctx, workspaceID, userID, req.Category, folder)
	if err != nil {
		return fmt.Errorf("check folder items failed: %w", err)
	}
	if hasItems {
		return fmt.Errorf("%w: %s", ErrConflict, errMsgFolderNotEmpty)
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: %s", ErrNotFound, errMsgFolderNotFound)
		}
		return fmt.Errorf("read folder failed: %w", err)
	}
	if len(entries) > 0 {
		return fmt.Errorf("%w: %s", ErrConflict, errMsgFolderNotEmpty)
	}
	if err := stubDeleteFile(absPath); err != nil {
		return fmt.Errorf("remove folder failed: %w", err)
	}

	// 删除成功后，清理并行存储版本文件的对应空目录。
	versionsAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, filepath.Join(object.ProductSpaceVersionsDir, req.Category, folder))
	if err == nil {
		if entries, err := os.ReadDir(versionsAbsPath); err == nil && len(entries) == 0 {
			_ = stubDeleteFile(versionsAbsPath)
		}
	}
	return nil
}

// ImportPrototype 将 /proto-make 等指令生成的原型工程目录正式采纳到产品空间。
// 仅导入指定一级产品目录（folder）下的 .html 文件，已入库的页面会自动去重。
// Vite 工程优先保留 dist/index.html，与产品空间自动同步规则保持一致。
// 返回本次新导入的 product_docs 条目 ID 列表，便于上层关联需求与生成设计版本。
func (s *DBProductSpaceService) ImportPrototype(ctx context.Context, workspaceID, userID, folder string) ([]string, error) {
	// 采纳自己生成的原型到产品空间，只需是当前工作空间成员即可，不限 PM。
	if err := s.requireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	sanitized, err := sanitizeFolderPath(folder)
	if err != nil {
		return nil, invalidInput(fmt.Errorf("invalid folder: %w", err))
	}
	if strings.Contains(sanitized, "/") {
		return nil, invalidInput(errors.New("folder must be a top-level product"))
	}

	protoRelPrefix := filepath.Join(object.ProductSpacePrototypesDir, sanitized)
	protoPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, protoRelPrefix)
	if err != nil {
		return nil, invalidInput(err)
	}
	if err := rejectSymlink(protoPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}
	info, err := os.Stat(protoPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgFolderNotFound)
		}
		return nil, fmt.Errorf("stat prototype folder failed: %w", err)
	}
	if !info.IsDir() {
		return nil, invalidInput(errors.New("prototype path is not a directory"))
	}

	// 查询该目录下已存在的产品空间条目，按路径建立 id 映射，用于已存在时的更新。
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, relative_path FROM product_docs
		WHERE workspace_id = $1 AND user_id = $2 AND relative_path LIKE $3 ESCAPE '\'
	`, workspaceID, userID, escapeLikePattern(protoRelPrefix+"/")+"%")
	if err != nil {
		return nil, fmt.Errorf("list existing items failed: %w", err)
	}
	defer rows.Close()

	existing := make(map[string]string)
	for rows.Next() {
		var id, rp string
		if err := rows.Scan(&id, &rp); err != nil {
			return nil, fmt.Errorf("scan existing item failed: %w", err)
		}
		existing[rp] = id
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing items failed: %w", err)
	}

	imported := 0
	updated := 0
	var affectedIDs []string
	walkErr := filepath.WalkDir(protoPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == protoPath {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.ToLower(filepath.Ext(path)) != ".html" {
			return nil
		}
		if err := rejectSymlink(path); err != nil {
			log.Printf("reject symlink for prototype file %s failed: %v", path, err)
			return nil
		}

		rel, err := filepath.Rel(protoPath, path)
		if err != nil {
			log.Printf("compute relative path for prototype file %s failed: %v", path, err)
			return nil
		}
		rel = filepath.ToSlash(rel)
		relPath := filepath.Join(protoRelPrefix, rel)

		// Vite 工程：根目录存在 dist/index.html 时跳过根 index.html。
		if strings.EqualFold(filepath.Base(path), "index.html") {
			dirParts := strings.Split(rel, "/")
			if len(dirParts) == 1 {
				distIndex := filepath.Join(filepath.Dir(path), "dist", "index.html")
				if info, err := os.Stat(distIndex); err == nil && !info.IsDir() {
					return nil
				}
			}
		}

		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("read prototype file %s failed: %v", path, err)
			return nil
		}

		if itemID, ok := existing[relPath]; ok {
			// 已存在：更新内容为新生成的文件，并创建新版本。
			changed, updateErr := s.updatePrototypeContentByID(ctx, workspaceID, userID, itemID, data, "采纳原型")
			if updateErr != nil {
				log.Printf("update prototype file %s failed: %v", relPath, updateErr)
				return nil
			}
			if changed {
				affectedIDs = append(affectedIDs, itemID)
				updated++
			}
			return nil
		}

		title := filepath.Base(path)
		size := int64(len(data))
		content := base64.StdEncoding.EncodeToString(data)
		id := uuid.NewString()
		item, err := s.insertProductDoc(ctx, s.db, id, workspaceID, userID, object.ItemTypePrototype, title, id, relPath, content, ItemStatusDraft, 1, "html", mimeTypeForExt("html"), size, userID)
		if err != nil {
			log.Printf("import prototype file %s failed: %v", relPath, err)
			return nil
		}
		affectedIDs = append(affectedIDs, item.ID)
		imported++
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("walk prototype folder failed: %w", walkErr)
	}
	if imported == 0 && updated == 0 && len(existing) == 0 {
		return nil, invalidInput(errors.New("未找到可导入的 .html 原型页面"))
	}
	// 没有新增也未更新时返回空列表，避免创建无意义的设计版本。
	return affectedIDs, nil
}

// DownloadVersion 下载指定版本文件，返回文件名与内容。
func (s *DBProductSpaceService) DownloadVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (string, []byte, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return "", nil, err
	}

	item, err := s.fetchItem(ctx, workspaceID, userID, itemID)
	if err != nil {
		return "", nil, err
	}

	_, _, name, ext, err := parseRelativePath(item.RelativePath)
	if err != nil {
		return "", nil, invalidInput(err)
	}

	if version <= 0 || version > item.CurrentVersion {
		return "", nil, invalidInput(errors.New(errMsgInvalidVersion))
	}
	if version == item.CurrentVersion {
		data, err := s.readFileBytes(ctx, workspaceID, userID, item.RelativePath)
		if err != nil {
			return "", nil, err
		}
		return name + "." + ext, data, nil
	}

	versionRecord, err := s.fetchVersion(ctx, workspaceID, userID, itemID, version)
	if err != nil {
		return "", nil, err
	}

	absPath, err := s.resolveVersionFilePath(workspaceID, userID, versionRecord.FilePath)
	if err != nil {
		return "", nil, err
	}
	if err := rejectSymlink(absPath); err != nil {
		return "", nil, fmt.Errorf("version file symlink check failed: %w", err)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", nil, fmt.Errorf("read version file failed: %w", err)
	}

	return buildVersionFileName(name, ext, version), data, nil
}

// ServeFile 按相对路径从产品空间文件系统读取文件，返回内容（不修改）与 MIME 类型。
// 仅允许访问 prototypes 目录下的文件，用于 iframe 静态预览原型页面及其资源。
func (s *DBProductSpaceService) ServeFile(ctx context.Context, workspaceID, userID, relativePath string) ([]byte, string, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, "", err
	}
	if err := validateRelativePath(relativePath); err != nil {
		return nil, "", invalidInput(err)
	}
	// 仅开放原型目录，避免通过 serve 接口访问 docs 或 versions 等业务文件。
	if !strings.HasPrefix(filepath.ToSlash(relativePath), object.ProductSpacePrototypesDir+"/") {
		return nil, "", invalidInput(errors.New("serve path must be under prototypes"))
	}

	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, "", err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, "", fmt.Errorf("symlink check failed: %w", err)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, "", fmt.Errorf("read file failed: %w", err)
	}
	ext := parseExtFromName(absPath)
	return data, mimeTypeForExt(ext), nil
}

// scanPrototypeComment 从数据库行扫描批注评论对象（含位置/元素信息）。
// 查询需通过 LEFT JOIN users 提供 userName 列（用户记录缺失时为空字符串）。
func scanPrototypeComment(sc scanner, c *object.PrototypeComment) error {
	return sc.Scan(
		&c.ID, &c.ItemID, &c.WorkspaceID, &c.UserID, &c.UserName,
		&c.Content, &c.Selector, &c.TargetText, &c.X, &c.Y, &c.CreatedAt,
	)
}

// ListComments 返回指定条目下的原型批注评论，按创建时间倒序排列。
// 先通过 fetchItem 校验条目存在且属于当前工作空间与用户，避免通过猜测 itemID 读取他人条目的批注。
func (s *DBProductSpaceService) ListComments(ctx context.Context, workspaceID, userID, itemID string) ([]object.PrototypeComment, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	if _, err := s.fetchItem(ctx, workspaceID, userID, itemID); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.item_id, c.workspace_id, c.user_id, COALESCE(u.name, ''), c.content,
		       c.selector, c.target_text, c.x, c.y, c.created_at
		FROM product_prototype_comments c
		LEFT JOIN users u ON u.id = c.user_id
		WHERE c.item_id = $1 AND c.workspace_id = $2
		ORDER BY c.created_at DESC
	`, itemID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list prototype comments failed: %w", err)
	}
	defer rows.Close()

	comments := make([]object.PrototypeComment, 0)
	for rows.Next() {
		var c object.PrototypeComment
		if err := scanPrototypeComment(rows, &c); err != nil {
			return nil, fmt.Errorf("scan prototype comment failed: %w", err)
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate prototype comments failed: %w", err)
	}
	return comments, nil
}

// AddComment 为指定条目新增原型批注评论，返回包含用户名与位置信息的完整对象。
// 插入通过 CTE 一次性完成 INSERT 与 LEFT JOIN users，避免二次查询获取用户名。
func (s *DBProductSpaceService) AddComment(ctx context.Context, workspaceID, userID, itemID string, req object.AddCommentRequest) (*object.PrototypeComment, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	if _, err := s.fetchItem(ctx, workspaceID, userID, itemID); err != nil {
		return nil, err
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		return nil, invalidInput(errors.New(errMsgCommentEmpty))
	}
	if len([]rune(content)) > maxCommentLength {
		return nil, invalidInput(errors.New(errMsgCommentTooLong))
	}

	selector := strings.TrimSpace(req.Selector)
	targetText := strings.TrimSpace(req.TargetText)
	if len([]rune(selector)) > maxSelectorLength {
		selector = string([]rune(selector)[:maxSelectorLength])
	}
	if len([]rune(targetText)) > maxTargetTextLength {
		targetText = string([]rune(targetText)[:maxTargetTextLength])
	}

	var c object.PrototypeComment
	err := scanPrototypeComment(s.db.QueryRowContext(ctx, `
		WITH ins AS (
			INSERT INTO product_prototype_comments (id, item_id, workspace_id, user_id, content, selector, target_text, x, y)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, item_id, workspace_id, user_id, content, selector, target_text, x, y, created_at
		)
		SELECT ins.id, ins.item_id, ins.workspace_id, ins.user_id, COALESCE(u.name, ''),
		       ins.content, ins.selector, ins.target_text, ins.x, ins.y, ins.created_at
		FROM ins
		LEFT JOIN users u ON u.id = ins.user_id
	`, uuid.NewString(), itemID, workspaceID, userID, content, selector, targetText, req.X, req.Y), &c)
	if err != nil {
		return nil, fmt.Errorf("insert prototype comment failed: %w", err)
	}
	return &c, nil
}

// shareTokenLength 原型分享短链 token 长度（base62 字符集）。
const shareTokenLength = 10

// shareTokenAlphabet 短链 token 字符集。
const shareTokenAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// generatePrototypeShareToken 生成指定长度的 base62 随机 token。
func generatePrototypeShareToken(length int) (string, error) {
	max := big.NewInt(int64(len(shareTokenAlphabet)))
	buf := make([]byte, length)
	for i := range buf {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generate prototype share token failed: %w", err)
		}
		buf[i] = shareTokenAlphabet[n.Int64()]
	}
	return string(buf), nil
}

// resolveShareByToken 按 token 查询分享记录，返回 workspaceID、userID、productFolder。
// token 不存在时返回 ErrNotFound。
func (s *DBProductSpaceService) resolveShareByToken(token string) (workspaceID, userID, productFolder string, err error) {
	err = s.db.QueryRow(
		`SELECT workspace_id, user_id, product_folder FROM product_prototype_shares WHERE token = $1`, token,
	).Scan(&workspaceID, &userID, &productFolder)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", fmt.Errorf("%w: 分享链接不存在或已失效", ErrNotFound)
	}
	if err != nil {
		return "", "", "", fmt.Errorf("query prototype share failed: %w", err)
	}
	return workspaceID, userID, productFolder, nil
}

// CreatePrototypeShare 为指定产品创建免登录分享链接。
// productFolder 会被清洗为单段目录名（产品名），分享该产品下全部原型页面。
// 同一产品重复调用返回已有链接（幂等），保证链接稳定。
func (s *DBProductSpaceService) CreatePrototypeShare(ctx context.Context, workspaceID, userID, productFolder string) (object.PrototypeShare, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return object.PrototypeShare{}, err
	}

	folder, err := sanitizeName(productFolder)
	if err != nil {
		return object.PrototypeShare{}, invalidInput(fmt.Errorf("invalid product folder: %w", err))
	}

	// 幂等：同一产品已存在分享记录时直接返回
	var existing object.PrototypeShare
	queryErr := s.db.QueryRow(
		`SELECT token, workspace_id, user_id, product_folder, created_at
		 FROM product_prototype_shares WHERE workspace_id = $1 AND user_id = $2 AND product_folder = $3`,
		workspaceID, userID, folder,
	).Scan(&existing.Token, &existing.WorkspaceID, &existing.UserID, &existing.ProductFolder, &existing.CreatedAt)
	if queryErr == nil {
		return existing, nil
	}
	if !errors.Is(queryErr, sql.ErrNoRows) {
		return object.PrototypeShare{}, fmt.Errorf("query existing prototype share failed: %w", queryErr)
	}

	token, err := generatePrototypeShareToken(shareTokenLength)
	if err != nil {
		return object.PrototypeShare{}, err
	}
	now := time.Now().UTC()
	share := object.PrototypeShare{
		Token:         token,
		WorkspaceID:   workspaceID,
		UserID:        userID,
		ProductFolder: folder,
		CreatedAt:     now,
	}
	_, err = s.db.Exec(
		`INSERT INTO product_prototype_shares (id, token, workspace_id, user_id, product_folder, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		uuid.NewString(), token, workspaceID, userID, folder, now,
	)
	if err != nil {
		return object.PrototypeShare{}, fmt.Errorf("create prototype share failed: %w", err)
	}
	return share, nil
}

// GetSharedPrototype 免登录：按 token 解析分享产品信息与页面列表。
// 页面列表查询 product_docs 中该产品目录下全部原型条目，按标题排序。
func (s *DBProductSpaceService) GetSharedPrototype(token string) (object.SharedPrototypeView, error) {
	workspaceID, userID, productFolder, err := s.resolveShareByToken(token)
	if err != nil {
		return object.SharedPrototypeView{}, err
	}

	// 匹配 prototypes/{productFolder}/ 下所有层级的原型页面
	prefix := filepath.Join(object.ProductSpacePrototypesDir, productFolder) + "/"
	rows, err := s.db.Query(
		`SELECT id, title, relative_path FROM product_docs
		 WHERE workspace_id = $1 AND user_id = $2 AND type = $3 AND relative_path LIKE $4 ESCAPE '\'
		 ORDER BY title`,
		workspaceID, userID, object.ItemTypePrototype, escapeLikePattern(prefix)+"%",
	)
	if err != nil {
		return object.SharedPrototypeView{}, fmt.Errorf("list shared prototype pages failed: %w", err)
	}
	defer rows.Close()

	pages := make([]object.SharedPrototypePage, 0)
	for rows.Next() {
		var p object.SharedPrototypePage
		if err := rows.Scan(&p.ItemID, &p.Title, &p.RelativePath); err != nil {
			return object.SharedPrototypeView{}, fmt.Errorf("scan shared prototype page failed: %w", err)
		}
		pages = append(pages, p)
	}
	if err := rows.Err(); err != nil {
		return object.SharedPrototypeView{}, fmt.Errorf("iterate shared prototype pages failed: %w", err)
	}

	return object.SharedPrototypeView{ProductFolder: productFolder, Pages: pages}, nil
}

// ServeSharedFile 免登录：按 token 校验后 serve 产品目录下的文件。
// relativePath 必须位于 prototypes/{productFolder}/ 下，防止越权访问其他产品或 docs 目录。
func (s *DBProductSpaceService) ServeSharedFile(token, relativePath string) ([]byte, string, error) {
	workspaceID, userID, productFolder, err := s.resolveShareByToken(token)
	if err != nil {
		return nil, "", err
	}
	if err := validateRelativePath(relativePath); err != nil {
		return nil, "", invalidInput(err)
	}

	// 仅允许访问被分享产品目录下的文件，防止通过 token 越权访问其他产品
	allowedPrefix := filepath.ToSlash(filepath.Join(object.ProductSpacePrototypesDir, productFolder)) + "/"
	if !strings.HasPrefix(filepath.ToSlash(relativePath), allowedPrefix) {
		return nil, "", invalidInput(errors.New("serve path is outside the shared product"))
	}

	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, "", err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, "", fmt.Errorf("symlink check failed: %w", err)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, "", fmt.Errorf("read file failed: %w", err)
	}
	return data, mimeTypeForExt(parseExtFromName(absPath)), nil
}

// ListSharedComments 免登录：按 token 校验后列出指定页面的批注。
// 先校验 itemID 属于被分享的产品目录，再查询批注，避免通过 token 访问其他页面的批注。
func (s *DBProductSpaceService) ListSharedComments(token, itemID string) ([]object.PrototypeComment, error) {
	workspaceID, userID, productFolder, err := s.resolveShareByToken(token)
	if err != nil {
		return nil, err
	}

	// 校验 itemID 属于被分享的产品目录，防止越权
	allowedPrefix := filepath.ToSlash(filepath.Join(object.ProductSpacePrototypesDir, productFolder)) + "/"
	var relativePath string
	verifyErr := s.db.QueryRow(
		`SELECT relative_path FROM product_docs
		 WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND type = $4`,
		itemID, workspaceID, userID, object.ItemTypePrototype,
	).Scan(&relativePath)
	if errors.Is(verifyErr, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}
	if verifyErr != nil {
		return nil, fmt.Errorf("verify shared item failed: %w", verifyErr)
	}
	if !strings.HasPrefix(filepath.ToSlash(relativePath), allowedPrefix) {
		return nil, fmt.Errorf("%w: 页面不在分享范围内", ErrForbidden)
	}

	rows, err := s.db.Query(
		`SELECT c.id, c.item_id, c.workspace_id, c.user_id, COALESCE(u.name, ''), c.content,
		        c.selector, c.target_text, c.x, c.y, c.created_at
		 FROM product_prototype_comments c
		 LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.item_id = $1 AND c.workspace_id = $2
		 ORDER BY c.created_at DESC`,
		itemID, workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list shared prototype comments failed: %w", err)
	}
	defer rows.Close()

	comments := make([]object.PrototypeComment, 0)
	for rows.Next() {
		var c object.PrototypeComment
		if err := scanPrototypeComment(rows, &c); err != nil {
			return nil, fmt.Errorf("scan prototype comment failed: %w", err)
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate prototype comments failed: %w", err)
	}
	return comments, nil
}

// ListRequirementShareComments 免登录：按需求分享 token 校验后列出指定原型页面的批注。
// 先校验 itemID 属于该分享关联的产品目录，再查询批注。
func (s *DBProductSpaceService) ListRequirementShareComments(token, itemID string) ([]object.PrototypeComment, error) {
	workspaceID, userID, _, _, productFolder, _, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return nil, err
	}
	if productFolder == "" {
		return nil, fmt.Errorf("%w: 该分享未关联原型", ErrInvalidInput)
	}

	allowedPrefix := filepath.ToSlash(filepath.Join(object.ProductSpacePrototypesDir, productFolder)) + "/"
	var relativePath string
	verifyErr := s.db.QueryRow(
		`SELECT relative_path FROM product_docs
		 WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND type = $4`,
		itemID, workspaceID, userID, object.ItemTypePrototype,
	).Scan(&relativePath)
	if errors.Is(verifyErr, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}
	if verifyErr != nil {
		return nil, fmt.Errorf("verify shared item failed: %w", verifyErr)
	}
	if !strings.HasPrefix(filepath.ToSlash(relativePath), allowedPrefix) {
		return nil, fmt.Errorf("%w: 页面不在分享范围内", ErrForbidden)
	}

	rows, err := s.db.Query(
		`SELECT c.id, c.item_id, c.workspace_id, c.user_id, COALESCE(u.name, ''), c.content,
		        c.selector, c.target_text, c.x, c.y, c.created_at
		 FROM product_prototype_comments c
		 LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.item_id = $1 AND c.workspace_id = $2
		 ORDER BY c.created_at DESC`,
		itemID, workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list requirement share comments failed: %w", err)
	}
	defer rows.Close()

	comments := make([]object.PrototypeComment, 0)
	for rows.Next() {
		var c object.PrototypeComment
		if err := scanPrototypeComment(rows, &c); err != nil {
			return nil, fmt.Errorf("scan prototype comment failed: %w", err)
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate prototype comments failed: %w", err)
	}
	return comments, nil
}

// generateRequirementShareToken 生成需求级统一分享短链 token，复用 base62 字符集。
func generateRequirementShareToken(length int) (string, error) {
	max := big.NewInt(int64(len(shareTokenAlphabet)))
	buf := make([]byte, length)
	for i := range buf {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generate requirement share token failed: %w", err)
		}
		buf[i] = shareTokenAlphabet[n.Int64()]
	}
	return string(buf), nil
}

// resolveRequirementShareByToken 按 token 查询需求分享记录，返回 workspaceID、userID、title、docID、productFolder、allowComments。
func (s *DBProductSpaceService) resolveRequirementShareByToken(token string) (workspaceID, userID, title, docID, productFolder string, allowComments bool, err error) {
	var titleNull sql.NullString
	err = s.db.QueryRow(
		`SELECT workspace_id, user_id, COALESCE(title, ''), COALESCE(doc_id, ''), COALESCE(product_folder, ''), allow_comments FROM requirement_shares WHERE token = $1`, token,
	).Scan(&workspaceID, &userID, &titleNull, &docID, &productFolder, &allowComments)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", "", "", false, fmt.Errorf("%w: 分享链接不存在或已失效", ErrNotFound)
	}
	if err != nil {
		return "", "", "", "", "", false, fmt.Errorf("query requirement share failed: %w", err)
	}
	return workspaceID, userID, titleNull.String, docID, productFolder, allowComments, nil
}

// CreateRequirementShare 为需求创建统一的文档+原型分享链接。
// doc_id 与 product_folder 至少提供一个；两者都为空时返回参数错误。
// 同一需求（workspace+user+doc+product）重复调用返回已有链接（幂等）。
// allowComments 在重复创建时也会同步更新。
func (s *DBProductSpaceService) CreateRequirementShare(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return object.RequirementShare{}, err
	}
	if req.DocID == "" && req.ProductFolder == "" {
		return object.RequirementShare{}, fmt.Errorf("%w: doc_id 或 product_folder 至少提供一个", ErrInvalidInput)
	}

	folder := req.ProductFolder
	if folder != "" {
		var err error
		folder, err = sanitizeName(folder)
		if err != nil {
			return object.RequirementShare{}, invalidInput(fmt.Errorf("invalid product folder: %w", err))
		}
	}

	// 幂等：同一需求返回已有记录；若标题或批注权限变化则同步更新。
	var existing object.RequirementShare
	var existingTitle sql.NullString
	var existingAllowComments bool
	queryErr := s.db.QueryRow(
		`SELECT token, workspace_id, user_id, COALESCE(title, ''), COALESCE(doc_id, ''), COALESCE(product_folder, ''), allow_comments, created_at
		 FROM requirement_shares
		 WHERE workspace_id = $1 AND user_id = $2 AND COALESCE(doc_id, '') = $3 AND COALESCE(product_folder, '') = $4`,
		workspaceID, userID, req.DocID, folder,
	).Scan(&existing.Token, &existing.WorkspaceID, &existing.UserID, &existingTitle, &existing.DocID, &existing.ProductFolder, &existingAllowComments, &existing.CreatedAt)
	if queryErr == nil {
		existing.Title = existingTitle.String
		existing.AllowComments = existingAllowComments
		needsUpdate := false
		if existing.Title != req.Title {
			needsUpdate = true
		}
		if existing.AllowComments != req.AllowComments {
			needsUpdate = true
		}
		if needsUpdate {
			if _, upErr := s.db.Exec(
				`UPDATE requirement_shares SET title = $1, allow_comments = $2 WHERE token = $3`,
				nullIfEmpty(req.Title), req.AllowComments, existing.Token,
			); upErr == nil {
				existing.Title = req.Title
				existing.AllowComments = req.AllowComments
			}
		}
		return existing, nil
	}
	if !errors.Is(queryErr, sql.ErrNoRows) {
		return object.RequirementShare{}, fmt.Errorf("query existing requirement share failed: %w", queryErr)
	}

	token, err := generateRequirementShareToken(shareTokenLength)
	if err != nil {
		return object.RequirementShare{}, err
	}
	now := time.Now().UTC()
	share := object.RequirementShare{
		Token:         token,
		WorkspaceID:   workspaceID,
		UserID:        userID,
		Title:         req.Title,
		DocID:         req.DocID,
		ProductFolder: folder,
		AllowComments: req.AllowComments,
		CreatedAt:     now,
	}
	_, err = s.db.Exec(
		`INSERT INTO requirement_shares (id, token, workspace_id, user_id, title, doc_id, product_folder, allow_comments, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		uuid.NewString(), token, workspaceID, userID, nullIfEmpty(req.Title), nullIfEmpty(req.DocID), nullIfEmpty(folder), req.AllowComments, now,
	)
	if err != nil {
		return object.RequirementShare{}, fmt.Errorf("create requirement share failed: %w", err)
	}
	return share, nil
}

// nullIfEmpty 在字符串为空时返回 sql.NullString{Valid:false}，非空时返回对应值。
func nullIfEmpty(v string) sql.NullString {
	if v == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: v, Valid: true}
}

// GetSharedRequirement 按 token 解析需求级统一分享视图：文档（最新已发布版本）+ 原型页面列表。
func (s *DBProductSpaceService) GetSharedRequirement(token string) (object.SharedRequirementView, error) {
	workspaceID, userID, title, docID, productFolder, allowComments, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return object.SharedRequirementView{}, err
	}

	var view object.SharedRequirementView
	view.Title = title
	view.AllowComments = allowComments

	// 文档：仅取已发布状态的最新版本
	if docID != "" {
		var doc object.SharedDocInfo
		var createdByName sql.NullString
		err := s.db.QueryRow(`
			SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
			FROM product_docs d
			JOIN product_doc_versions v ON v.doc_id = d.id
			LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
			WHERE d.id = $1 AND d.status = 'published'
			ORDER BY v.version DESC
			LIMIT 1
		`, docID).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
		if err == nil {
			doc.CreatedByName = createdByName.String
			view.Doc = &doc
		}
		// 文档不存在或不是已发布状态时，不返回错误，仅不展示文档
	}

	// 原型：复用 GetSharedPrototype 的页面列表逻辑
	if productFolder != "" {
		prefix := filepath.Join(object.ProductSpacePrototypesDir, productFolder) + "/"
		rows, err := s.db.Query(
			`SELECT id, title, relative_path FROM product_docs
			 WHERE workspace_id = $1 AND user_id = $2 AND type = $3 AND relative_path LIKE $4 ESCAPE '\'
			 ORDER BY title`,
			workspaceID, userID, object.ItemTypePrototype, escapeLikePattern(prefix)+"%",
		)
		if err == nil {
			defer rows.Close()
			pages := make([]object.SharedPrototypePage, 0)
			for rows.Next() {
				var p object.SharedPrototypePage
				if err := rows.Scan(&p.ItemID, &p.Title, &p.RelativePath); err != nil {
					continue
				}
				pages = append(pages, p)
			}
			if len(pages) > 0 {
				view.Prototype = &object.SharedPrototypeView{
					ProductFolder: productFolder,
					Pages:         pages,
				}
			}
		}
	}

	if view.Doc == nil && view.Prototype == nil {
		return object.SharedRequirementView{}, fmt.Errorf("%w: 分享内容不存在", ErrNotFound)
	}
	return view, nil
}

// ServeSharedRequirementFile 免登录 serve 需求分享中的原型文件。
// 校验逻辑与 ServeSharedFile 一致，只是 token 来源为 requirement_shares 表。
func (s *DBProductSpaceService) ServeSharedRequirementFile(token, relativePath string) ([]byte, string, error) {
	_, _, _, _, productFolder, _, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return nil, "", err
	}
	if productFolder == "" {
		return nil, "", invalidInput(errors.New(errMsgNoPrototypeInShare))
	}

	allowedPrefix := filepath.ToSlash(filepath.Join(object.ProductSpacePrototypesDir, productFolder)) + "/"
	if !strings.HasPrefix(filepath.ToSlash(relativePath), allowedPrefix) {
		return nil, "", invalidInput(errors.New("serve path is outside the shared product"))
	}

	// 需要 workspaceID/userID 解析绝对路径，再次查询分享记录获取完整信息
	workspaceID, userID, _, _, _, _, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return nil, "", err
	}

	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, "", err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, "", fmt.Errorf("symlink check failed: %w", err)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, "", fmt.Errorf("read file failed: %w", err)
	}

	contentType := "text/html; charset=utf-8"
	if filepath.Ext(relativePath) == ".css" {
		contentType = "text/css; charset=utf-8"
	} else if filepath.Ext(relativePath) == ".js" {
		contentType = "application/javascript; charset=utf-8"
	}
	return data, contentType, nil
}


// AddRequirementSharePrototypeComment 免登录：访客为需求分享中的原型页面添加批注。
// 先校验分享 token 有效且允许批注、itemID 属于被分享的产品目录，再写入 product_prototype_comments。
func (s *DBProductSpaceService) AddRequirementSharePrototypeComment(token, itemID string, req object.AddCommentRequest) (*object.PrototypeComment, error) {
	workspaceID, userID, _, _, productFolder, allowComments, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return nil, err
	}
	if !allowComments {
		return nil, fmt.Errorf("%w: %s", ErrForbidden, errMsgCommentsNotAllowed)
	}
	if productFolder == "" {
		return nil, fmt.Errorf("%w: %s", ErrInvalidInput, errMsgNoPrototypeInShare)
	}

	allowedPrefix := filepath.ToSlash(filepath.Join(object.ProductSpacePrototypesDir, productFolder)) + "/"
	var relativePath string
	verifyErr := s.db.QueryRow(
		`SELECT relative_path FROM product_docs
		 WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND type = $4`,
		itemID, workspaceID, userID, object.ItemTypePrototype,
	).Scan(&relativePath)
	if errors.Is(verifyErr, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
	}
	if verifyErr != nil {
		return nil, fmt.Errorf("verify shared item failed: %w", verifyErr)
	}
	if !strings.HasPrefix(filepath.ToSlash(relativePath), allowedPrefix) {
		return nil, fmt.Errorf("%w: 页面不在分享范围内", ErrForbidden)
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		return nil, invalidInput(errors.New(errMsgCommentEmpty))
	}
	if len([]rune(content)) > maxCommentLength {
		return nil, invalidInput(errors.New(errMsgCommentTooLong))
	}

	selector := strings.TrimSpace(req.Selector)
	targetText := strings.TrimSpace(req.TargetText)
	if len([]rune(selector)) > maxSelectorLength {
		selector = string([]rune(selector)[:maxSelectorLength])
	}
	if len([]rune(targetText)) > maxTargetTextLength {
		targetText = string([]rune(targetText)[:maxTargetTextLength])
	}

	var c object.PrototypeComment
	err = scanPrototypeComment(s.db.QueryRow(`
		WITH ins AS (
			INSERT INTO product_prototype_comments (id, item_id, workspace_id, user_id, content, selector, target_text, x, y)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, item_id, workspace_id, user_id, content, selector, target_text, x, y, created_at
		)
		SELECT ins.id, ins.item_id, ins.workspace_id, ins.user_id, COALESCE(u.name, ''),
		       ins.content, ins.selector, ins.target_text, ins.x, ins.y, ins.created_at
		FROM ins
		LEFT JOIN users u ON u.id = ins.user_id
	`, uuid.NewString(), itemID, workspaceID, anonymousVisitorUserID, content, selector, targetText, req.X, req.Y), &c)
	if err != nil {
		return nil, fmt.Errorf("insert requirement share prototype comment failed: %w", err)
	}
	return &c, nil
}

// AddRequirementShareDocComment 免登录：访客为需求分享中的文档添加文本批注。
// 写入 product_doc_share_comments，share_token 记录需求分享 token，便于同一 token 下聚合查询。
func (s *DBProductSpaceService) AddRequirementShareDocComment(token string, req object.AddRequirementShareDocCommentRequest) (*productdocobject.ShareComment, error) {
	_, _, _, docID, _, allowComments, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return nil, err
	}
	if !allowComments {
		return nil, fmt.Errorf("%w: %s", ErrForbidden, errMsgCommentsNotAllowed)
	}
	if docID == "" {
		return nil, fmt.Errorf("%w: %s", ErrInvalidInput, errMsgNoDocInShare)
	}

	authorName := strings.TrimSpace(req.AuthorName)
	quoteText := strings.TrimSpace(req.QuoteText)
	content := strings.TrimSpace(req.Content)
	if authorName == "" {
		return nil, invalidInput(errors.New("昵称不能为空"))
	}
	if quoteText == "" {
		return nil, invalidInput(errors.New("引用文本不能为空"))
	}
	if content == "" {
		return nil, invalidInput(errors.New(errMsgCommentEmpty))
	}
	if len([]rune(authorName)) > 64 {
		return nil, invalidInput(errors.New("昵称超出最大长度限制"))
	}
	if len([]rune(quoteText)) > 500 {
		return nil, invalidInput(errors.New("引用文本超出最大长度限制"))
	}
	if len([]rune(content)) > 2000 {
		return nil, invalidInput(errors.New(errMsgCommentTooLong))
	}

	var workspaceID string
	if err := s.db.QueryRow(`SELECT workspace_id FROM product_docs WHERE id = $1`, docID).Scan(&workspaceID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, fmt.Errorf("fetch doc workspace failed: %w", err)
	}

	now := time.Now().UTC()
	c := productdocobject.ShareComment{
		ID:         uuid.NewString(),
		ShareToken: token,
		DocID:      docID,
		WorkspaceID: workspaceID,
		AuthorName: authorName,
		QuoteText:  quoteText,
		Content:    content,
		Status:     "open",
		CreatedAt:  now,
	}
	_, err = s.db.Exec(
		`INSERT INTO product_doc_share_comments (id, share_token, doc_id, workspace_id, author_name, quote_text, content, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		c.ID, c.ShareToken, c.DocID, c.WorkspaceID, c.AuthorName, c.QuoteText, c.Content, c.Status, c.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert requirement share doc comment failed: %w", err)
	}
	return &c, nil
}

// ListRequirementShareDocComments 免登录：按需求分享 token 列出关联文档的文本批注。
func (s *DBProductSpaceService) ListRequirementShareDocComments(token string) ([]productdocobject.ShareComment, error) {
	_, _, _, docID, _, _, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return nil, err
	}
	if docID == "" {
		return nil, fmt.Errorf("%w: %s", ErrInvalidInput, errMsgNoDocInShare)
	}

	rows, err := s.db.Query(
		`SELECT id, share_token, doc_id, workspace_id, author_name, quote_text, content, status, created_at, resolved_at, resolved_by
		 FROM product_doc_share_comments
		 WHERE share_token = $1
		 ORDER BY created_at ASC`,
		token,
	)
	if err != nil {
		return nil, fmt.Errorf("list requirement share doc comments failed: %w", err)
	}
	defer rows.Close()

	comments := make([]productdocobject.ShareComment, 0)
	for rows.Next() {
		var c productdocobject.ShareComment
		var resolvedAt sql.NullTime
		var resolvedBy sql.NullString
		if err := rows.Scan(
			&c.ID, &c.ShareToken, &c.DocID, &c.WorkspaceID,
			&c.AuthorName, &c.QuoteText, &c.Content, &c.Status,
			&c.CreatedAt, &resolvedAt, &resolvedBy,
		); err != nil {
			return nil, fmt.Errorf("scan requirement share doc comment failed: %w", err)
		}
		if resolvedAt.Valid {
			c.ResolvedAt = &resolvedAt.Time
		}
		if resolvedBy.Valid {
			c.ResolvedBy = resolvedBy.String
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate requirement share doc comments failed: %w", err)
	}
	return comments, nil
}

// StartDocAdoptionCleanupTask 启动文档采纳源文件清理定时任务。
// 任务按 interval 周期扫描 product_docs.source_path，删除超过 retentionDays 未修改的源草稿文件。
// 返回的 stop 函数用于停止定时器；本方法不依赖 ProductSpace 其它接口状态。
func (s *DBProductSpaceService) StartDocAdoptionCleanupTask(ctx context.Context, interval time.Duration, retentionDays int) func() {
	if interval <= 0 || retentionDays <= 0 {
		log.Printf("[ProductSpace] doc adoption cleanup disabled (interval=%v, retentionDays=%d)", interval, retentionDays)
		return func() {}
	}

	ticker := time.NewTicker(interval)
	stop := make(chan struct{})
	go func() {
		// 启动后立即执行一次清理，缩短配置生效的等待时间。
		s.runDocAdoptionCleanup(ctx, retentionDays)
		for {
			select {
			case <-ticker.C:
				s.runDocAdoptionCleanup(ctx, retentionDays)
			case <-stop:
				ticker.Stop()
				return
			case <-ctx.Done():
				ticker.Stop()
				return
			}
		}
	}()

	log.Printf("[ProductSpace] doc adoption cleanup started: interval=%v, retentionDays=%d", interval, retentionDays)
	return func() { close(stop) }
}

// runDocAdoptionCleanup 执行一次源文件清理。
// 查询所有已记录 source_path 的文档条目，对超过 retentionDays 未修改的源文件调用 personal-stub 删除。
// 源文件删除失败不会影响产品空间中的正式文档内容。
func (s *DBProductSpaceService) runDocAdoptionCleanup(ctx context.Context, retentionDays int) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT source_path
		FROM product_docs
		WHERE type = $1 AND source_path IS NOT NULL AND source_path != ''
	`, object.ItemTypeDoc)
	if err != nil {
		log.Printf("[ProductSpace] cleanup query failed: %v", err)
		return
	}
	defer rows.Close()

	sc := stubclient.Default()
	if sc == nil {
		log.Printf("[ProductSpace] cleanup skipped: personal-stub client not initialized")
		return
	}

	for rows.Next() {
		var sourcePath string
		if err := rows.Scan(&sourcePath); err != nil {
			log.Printf("[ProductSpace] cleanup scan source_path failed: %v", err)
			continue
		}

		if err := validateRelativePath(sourcePath); err != nil {
			log.Printf("[ProductSpace] cleanup skip invalid source_path %q: %v", sourcePath, err)
			continue
		}

		absPath := filepath.Join(s.workspaceRoot, sourcePath)
		if !isPathUnderWorkspaceRoot(absPath, s.workspaceRoot) {
			log.Printf("[ProductSpace] cleanup skip path outside workspace root: %s", sourcePath)
			continue
		}

		info, err := os.Stat(absPath)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			log.Printf("[ProductSpace] cleanup stat %s failed: %v", absPath, err)
			continue
		}
		if info.IsDir() {
			continue
		}
		if info.ModTime().After(cutoff) {
			continue
		}

		if err := sc.DeleteFile(ctx, sourcePath); err != nil {
			log.Printf("[ProductSpace] cleanup delete %s failed: %v", sourcePath, err)
		} else {
			log.Printf("[ProductSpace] cleanup deleted adopted source file %s (modified %s)", sourcePath, info.ModTime().Format(time.RFC3339))
		}
	}

	if err := rows.Err(); err != nil {
		log.Printf("[ProductSpace] cleanup rows iteration failed: %v", err)
	}
}
