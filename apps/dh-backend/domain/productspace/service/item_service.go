package service

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/google/uuid"
)

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

	// 架构合规：通过 stubclient.WalkDir 委托 personal-stub 遍历，不直接访问文件系统。
	syncSC := stubclient.FromContext(ctx)
	if syncSC == nil {
		return nil
	}
	walkEntries, walkErr := syncSC.WalkDir(context.Background(), protoPath)
	if walkErr != nil {
		return walkErr
	}
	// skipPrefixes 记录需要跳过的隐藏目录前缀，模拟 filepath.SkipDir 行为。
	skipPrefixes := []string{}
	for _, we := range walkEntries {
		if we.Path == protoPath {
			continue
		}
		// 跳过隐藏目录及其子条目
		if we.IsDir && strings.HasPrefix(we.Name, ".") {
			skipPrefixes = append(skipPrefixes, we.Path+string(filepath.Separator))
			continue
		}
		skipped := false
		for _, prefix := range skipPrefixes {
			if strings.HasPrefix(we.Path, prefix) {
				skipped = true
				break
			}
		}
		if skipped {
			continue
		}
		if we.IsDir {
			continue
		}
		path := we.Path
		if strings.ToLower(filepath.Ext(path)) != ".html" {
			continue
		}
		if err := rejectSymlink(path); err != nil {
			log.Printf("reject symlink for prototype file %s failed: %v", path, err)
			continue
		}
		rel, err := filepath.Rel(protoPath, path)
		if err != nil {
			log.Printf("compute relative path for prototype file %s failed: %v", path, err)
			continue
		}
		relPath := filepath.Join(object.ProductSpacePrototypesDir, filepath.ToSlash(rel))
		if _, ok := existing[relPath]; ok {
			continue
		}

		// 对 Node/Vite 工程，优先使用 dist/index.html 作为产品空间入口。
		// 如果工程根目录存在 dist/index.html，则忽略根目录的 index.html（无法直接预览）。
		if strings.EqualFold(filepath.Base(path), "index.html") {
			dirParts := strings.Split(filepath.ToSlash(filepath.Dir(rel)), "/")
			if len(dirParts) == 1 {
				distIndex := filepath.Join(filepath.Dir(path), "dist", "index.html")
			if fi, err := stubFileInfo(ctx, distIndex); err == nil && fi != nil && fi.Exists && !fi.IsDir {
				continue
			}
			}
		}

		data, err := stubReadFile(ctx, path)
		if err != nil {
			log.Printf("read prototype file %s failed: %v", path, err)
			continue
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
			continue
		}
		existing[relPath] = struct{}{}

		category, folder, name, _, err := parseRelativePath(item.RelativePath)
		if err != nil {
			log.Printf("parse relative path %s failed: %v", item.RelativePath, err)
			continue
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
	return nil
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
		// 架构合规：通过 stubclient.WalkDir 委托 personal-stub 遍历，不直接访问文件系统。
		sc := stubclient.FromContext(ctx)
		if sc == nil {
			continue
		}
		walkEntries, walkErr := sc.WalkDir(context.Background(), catPath)
		if walkErr != nil {
			if !stubFileExists(ctx, catPath) {
				continue
			}
			return nil, fmt.Errorf("walk category directory %s failed: %w", cat.name, walkErr)
		}
		for _, we := range walkEntries {
			if we.Path == catPath || !we.IsDir {
				continue
			}
			// 隐藏目录（.git / .vite / node_modules 等）不展示在树中
			if strings.HasPrefix(we.Name, ".") {
				continue
			}
			if err := rejectSymlink(we.Path); err != nil {
				return nil, fmt.Errorf("folder symlink check failed: %w", err)
			}
			rel, err := filepath.Rel(catPath, we.Path)
			if err != nil {
				return nil, err
			}
			findOrCreateFolder(&roots[cat.idx], filepath.ToSlash(rel))
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
	if err := safeMkdirAll(ctx, baseAbs, filepath.Dir(absPath)); err != nil {
		return nil, err
	}

	if err := stubWriteFile(ctx, absPath, data); err != nil {
		_ = tx.Rollback()
		if rerr := stubDeleteFile(ctx, absPath); rerr != nil {
			logRollbackDeleteErr(absPath, rerr)
		}
		return nil, fmt.Errorf("write initial file failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		if rerr := stubDeleteFile(ctx, absPath); rerr != nil {
			logRollbackDeleteErr(absPath, rerr)
		}
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

	if err := stubDeleteFile(ctx, absPath); err != nil {
		log.Printf("remove current file %s failed: %v", absPath, err)
	}
	if err := deleteVersionFiles(ctx, versionDir, name, ext); err != nil {
		log.Printf("remove version files in %s failed: %v", versionDir, err)
	}

	return nil
}
