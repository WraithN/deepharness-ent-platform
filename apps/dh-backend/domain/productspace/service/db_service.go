package service

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
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
)

const (
	errMsgInvalidItemType     = "invalid item type"
	errMsgInvalidCategory     = "invalid category"
	errMsgInvalidExtension    = "invalid file extension"
	errMsgPathTraversal       = "path traversal detected"
	errMsgFolderNotEmpty      = "folder is not empty"
	errMsgFolderNotFound      = "folder not found"
	errMsgTitleEmpty          = "title is required"
	errMsgTitlePathSeparator  = "title cannot contain path separators"
	errMsgContentRequired     = "doc content is required"
	errMsgFileDataRequired    = "prototype file data is required"
	errMsgPrototypeTooLarge   = "prototype file exceeds maximum allowed size"
	errMsgDocTooLarge         = "doc content exceeds maximum allowed size"
	errMsgFolderPathSeparator = "folder name cannot contain path separators"
	errMsgRelativePathEmpty   = "relative path is required"
	errMsgRelativePathAbs     = "relative path must be relative"
	errMsgRelativePathDot     = "relative path cannot contain parent references"
	errMsgItemNotFound        = "product space item not found"
	errMsgItemAlreadyExists   = "product space item already exists"
	errMsgVersionNotFound     = "product space version not found"
	errMsgInvalidVersion       = "invalid version"
	errMsgTitleTooLong         = "title exceeds maximum length"
	errMsgChangeSummaryTooLong = "change summary exceeds maximum length"
)

// 预定义的 MIME 类型映射，避免魔法字符串。
var mimeTypeByExt = map[string]string{
	object.DocExtMarkdown: "text/markdown",
	object.DocExtText:     "text/plain",
	"png":                 "image/png",
	"jpg":                 "image/jpeg",
	"jpeg":                "image/jpeg",
	"pdf":                 "application/pdf",
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
func (s *DBProductSpaceService) requirePM(ctx context.Context, workspaceID, userID string) error {
	subRole, err := s.workspaceService.GetMemberSubRole(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if subRole != pmSubRole {
		return errors.New("only pm can access product space")
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

// resolveProductSpacePath 返回相对路径对应的绝对路径，并校验路径逃逸。
func resolveProductSpacePath(workspaceRoot, workspaceID, userID, relativePath string) (string, error) {
	if err := validateID(workspaceID); err != nil {
		return "", fmt.Errorf("invalid workspaceID: %w", err)
	}
	if err := validateID(userID); err != nil {
		return "", fmt.Errorf("invalid userID: %w", err)
	}

	base := filepath.Join(workspaceRoot, workspaceID, userID, object.ProductSpaceRoot)
	if err := rejectSymlink(base); err != nil {
		return "", fmt.Errorf("base directory symlink check failed: %w", err)
	}
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", fmt.Errorf("resolve base path failed: %w", err)
	}
	target := filepath.Join(absBase, relativePath)
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", fmt.Errorf("resolve target path failed: %w", err)
	}
	if !strings.HasPrefix(absTarget, absBase+string(filepath.Separator)) && absTarget != absBase {
		return "", errors.New(errMsgPathTraversal)
	}
	return absTarget, nil
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
		base := filepath.Join(s.workspaceRoot, workspaceID, userID, object.ProductSpaceRoot)
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
	base := filepath.Join(s.workspaceRoot, workspaceID, userID, object.ProductSpaceRoot)
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

// buildRelativePath 构造相对路径：category/[folder/]filename.ext。
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
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
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

// escapeLikePattern 对字符串中的 LIKE 通配符与转义字符进行转义，配合 ESCAPE '\\' 使用。
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

// ensureParentDir 确保文件所在父目录存在。
func ensureParentDir(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, defaultDirPerm); err != nil {
		return fmt.Errorf("create directory failed: %w", err)
	}
	return nil
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
func parseRelativePath(relativePath string) (category, folder, name, ext string, err error) {
	parts := strings.Split(relativePath, string(filepath.Separator))
	if len(parts) != 2 && len(parts) != 3 {
		return "", "", "", "", fmt.Errorf("invalid relative path format: %s", relativePath)
	}
	category = parts[0]
	folder = ""
	if len(parts) == 3 {
		folder = parts[1]
	}
	filename := parts[len(parts)-1]
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
		if err := os.Remove(filepath.Join(dir, fname)); err != nil {
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
		return nil, errors.New(errMsgItemNotFound)
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
			return nil, errors.New(errMsgItemNotFound)
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
		WHERE workspace_id = $1 AND user_id = $2 AND relative_path LIKE $3 ESCAPE '\\'
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
		return nil, errors.New(errMsgVersionNotFound)
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
			status, current_version, file_ext, mime_type, size_bytes, created_by, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING id, workspace_id, user_id, type, title, relative_path, current_version,
		          file_ext, mime_type, size_bytes, status, created_by, created_at, updated_at
	`, id, workspaceID, userID, itemType, title, slug, relativePath, content,
		status, currentVersion, fileExt, mimeType, sizeBytes, createdBy, now, now,
	), &item)
	if err != nil {
		return nil, fmt.Errorf("insert product doc failed: %w", err)
	}
	return &item, nil
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
			Name: name,
			Path: item.RelativePath,
			Type: item.Type,
		}
		if folder == "" {
			rootNode.Children = append(rootNode.Children, fileNode)
			continue
		}
		folderIdx := findOrCreateFolder(rootNode, folder)
		rootNode.Children[folderIdx].Children = append(rootNode.Children[folderIdx].Children, fileNode)
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
		entries, err := os.ReadDir(catPath)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("read category directory %s failed: %w", cat.name, err)
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			folderName := entry.Name()
			findOrCreateFolder(&roots[cat.idx], folderName)
		}
	}
	return roots, nil
}

// findOrCreateFolder 在父节点下查找或创建文件夹节点，并返回其在 Children 中的索引。
func findOrCreateFolder(parent *object.ProductSpaceTreeNode, folder string) int {
	folderPath := filepath.Join(parent.Path, folder)
	for i := range parent.Children {
		if parent.Children[i].Name == folder && parent.Children[i].Type == object.NodeTypeFolder {
			return i
		}
	}
	parent.Children = append(parent.Children, object.ProductSpaceTreeNode{
		Name: folder,
		Path: folderPath,
		Type: object.NodeTypeFolder,
	})
	return len(parent.Children) - 1
}

// CreateItem 创建新的文档或原型条目，并写入初始文件。
func (s *DBProductSpaceService) CreateItem(ctx context.Context, workspaceID, userID string, req object.CreateItemRequest) (*object.ProductSpaceItem, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return nil, err
	}

	if err := validateCreateItemRequest(&req); err != nil {
		return nil, err
	}

	if req.Type == object.ItemTypeDoc && int64(len(req.Content)) > object.MaxDocSizeBytes {
		return nil, errors.New(errMsgDocTooLarge)
	}

	categoryDir, err := typeToCategoryDir(req.Type)
	if err != nil {
		return nil, err
	}

	if strings.ContainsAny(req.Title, `/\`) {
		return nil, errors.New(errMsgTitlePathSeparator)
	}

	title, err := sanitizeName(req.Title)
	if err != nil {
		return nil, fmt.Errorf("invalid title: %w", err)
	}
	if len([]rune(title)) > maxTitleLength {
		return nil, errors.New(errMsgTitleTooLong)
	}
	folder := ""
	if req.Folder != "" {
		if strings.ContainsAny(req.Folder, "/\\") {
			return nil, errors.New(errMsgFolderPathSeparator)
		}
		folder, err = sanitizeName(req.Folder)
		if err != nil {
			return nil, err
		}
	}

	ext, err := parseAndValidateExt(req.Type, title)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, err
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
			return nil, errors.New(errMsgItemAlreadyExists)
		}
		return nil, err
	}

	// 数据库记录插入成功后，再创建目录并写入文件；此时唯一索引已保证路径未被占用。
	if err := rejectSymlink(absPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}
	if err := ensureParentDir(absPath); err != nil {
		return nil, err
	}

	if err := os.WriteFile(absPath, data, defaultFilePerm); err != nil {
		_ = tx.Rollback()
		_ = os.Remove(absPath)
		return nil, fmt.Errorf("write initial file failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		_ = os.Remove(absPath)
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
		return nil, errors.New(errMsgDocTooLarge)
	}

	// 先校验并解码新内容，确认合法后再创建版本快照，避免生成孤儿版本文件。
	var newData []byte
	if item.Type == object.ItemTypePrototype {
		// Base64 is ~4/3 of original size plus padding
		maxBase64Len := int(base64.StdEncoding.EncodedLen(int(object.MaxPrototypeSizeBytes)))
		if len(req.Content) > maxBase64Len {
			return nil, errors.New(errMsgPrototypeTooLarge)
		}
		decoded, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return nil, fmt.Errorf("invalid base64 data: %w", err)
		}
		if int64(len(decoded)) > object.MaxPrototypeSizeBytes {
			return nil, errors.New(errMsgPrototypeTooLarge)
		}
		newData = decoded
	} else {
		newData = []byte(req.Content)
	}

	category, folder, name, ext, err := parseRelativePath(item.RelativePath)
	if err != nil {
		return nil, err
	}

	currentAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, item.RelativePath)
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
		return nil, errors.New(errMsgChangeSummaryTooLong)
	}

	versionRelPath := buildVersionRelativePath(category, folder, name, ext, item.CurrentVersion)
	versionAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, versionRelPath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(versionAbsPath); err != nil {
		return nil, fmt.Errorf("version file symlink check failed: %w", err)
	}
	if err := ensureParentDir(versionAbsPath); err != nil {
		return nil, err
	}
	if err := copyFile(currentAbsPath, versionAbsPath); err != nil {
		return nil, fmt.Errorf("backup current version failed: %w", err)
	}

	if err := os.WriteFile(currentAbsPath, newData, defaultFilePerm); err != nil {
		_ = os.Remove(versionAbsPath)
		return nil, fmt.Errorf("write new content failed: %w", err)
	}

	if err := s.saveVersionAndUpdateTx(ctx, tx, item, versionRelPath, req.Content, req.ChangeSummary, userID, oldBytes, newData); err != nil {
		_ = os.WriteFile(currentAbsPath, oldBytes, defaultFilePerm)
		_ = os.Remove(versionAbsPath)
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		_ = os.WriteFile(currentAbsPath, oldBytes, defaultFilePerm)
		_ = os.Remove(versionAbsPath)
		return nil, fmt.Errorf("commit transaction failed: %w", err)
	}

	return s.fetchItem(ctx, workspaceID, userID, itemID)
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
		return errors.New(errMsgItemNotFound)
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
		return nil, errors.New(errMsgInvalidVersion)
	}

	versionRecord, err := s.fetchVersionWithExecer(ctx, tx, workspaceID, userID, itemID, targetVersion)
	if err != nil {
		return nil, err
	}

	currentAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, item.RelativePath)
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
		return nil, err
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
	if err := ensureParentDir(snapshotAbsPath); err != nil {
		return nil, err
	}

	changeSummary := fmt.Sprintf(changeSummaryRestoreToVersion, targetVersion)
	if len([]rune(changeSummary)) > maxChangeSummaryLength {
		return nil, errors.New(errMsgChangeSummaryTooLong)
	}

	oldBytes, err := os.ReadFile(currentAbsPath)
	if err != nil {
		return nil, fmt.Errorf("read current file failed: %w", err)
	}

	rollbackFS := func() {
		_ = os.WriteFile(currentAbsPath, oldBytes, defaultFilePerm)
		_ = os.Remove(snapshotAbsPath)
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

	if err := os.WriteFile(snapshotAbsPath, restoredBytes, defaultFilePerm); err != nil {
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
		return nil, errors.New(errMsgItemNotFound)
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
		return errors.New(errMsgItemNotFound)
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

	if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
		log.Printf("remove current file %s failed: %v", absPath, err)
	}
	if err := deleteVersionFiles(versionDir, name, ext); err != nil {
		log.Printf("remove version files in %s failed: %v", versionDir, err)
	}

	return nil
}

// CreateFolder 在磁盘上创建产品空间文件夹。
func (s *DBProductSpaceService) CreateFolder(ctx context.Context, workspaceID, userID string, req object.CreateFolderRequest) error {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return err
	}

	if err := validateCategory(req.Category); err != nil {
		return err
	}
	if strings.ContainsAny(req.Name, "/\\") {
		return errors.New("folder name cannot contain path separators")
	}
	folder, err := sanitizeName(req.Name)
	if err != nil {
		return err
	}
	relativePath := filepath.Join(req.Category, folder)
	if err := validateRelativePath(relativePath); err != nil {
		return err
	}
	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return err
	}
	if err := rejectSymlink(absPath); err != nil {
		return fmt.Errorf("folder symlink check failed: %w", err)
	}
	if err := os.MkdirAll(absPath, defaultDirPerm); err != nil {
		return fmt.Errorf("create folder failed: %w", err)
	}
	return nil
}

// DeleteFolder 删除空文件夹。
func (s *DBProductSpaceService) DeleteFolder(ctx context.Context, workspaceID, userID string, req object.DeleteFolderRequest) error {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return err
	}

	if err := validateCategory(req.Category); err != nil {
		return err
	}
	if strings.ContainsAny(req.Name, "/\\") {
		return errors.New("folder name cannot contain path separators")
	}
	folder, err := sanitizeName(req.Name)
	if err != nil {
		return err
	}
	relativePath := filepath.Join(req.Category, folder)
	if err := validateRelativePath(relativePath); err != nil {
		return err
	}
	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return err
	}
	if err := rejectSymlink(absPath); err != nil {
		return fmt.Errorf("folder symlink check failed: %w", err)
	}

	hasItems, err := s.folderHasItems(ctx, workspaceID, userID, req.Category, folder)
	if err != nil {
		return fmt.Errorf("check folder items failed: %w", err)
	}
	if hasItems {
		return errors.New(errMsgFolderNotEmpty)
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return errors.New(errMsgFolderNotFound)
		}
		return fmt.Errorf("read folder failed: %w", err)
	}
	if len(entries) > 0 {
		return errors.New(errMsgFolderNotEmpty)
	}
	if err := os.Remove(absPath); err != nil {
		return fmt.Errorf("remove folder failed: %w", err)
	}
	return nil
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
		return "", nil, err
	}

	if version <= 0 || version > item.CurrentVersion {
		return "", nil, errors.New(errMsgInvalidVersion)
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
