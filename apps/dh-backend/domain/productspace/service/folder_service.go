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
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
)

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
			if rerr := stubWriteFile(ctx, currentAbsPath, oldBytes); rerr != nil {
				logRollbackWriteErr(currentAbsPath, rerr)
			}
			if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
				logRollbackDeleteErr(versionAbsPath, rerr)
			}
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

	oldBytes, err := stubReadFile(ctx, currentAbsPath)
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
	if err := safeMkdirAll(ctx, baseAbs, filepath.Dir(versionAbsPath)); err != nil {
		return nil, err
	}
	if err := copyFile(ctx, currentAbsPath, versionAbsPath); err != nil {
		return nil, fmt.Errorf("backup current version failed: %w", err)
	}

	if err := stubWriteFile(ctx, currentAbsPath, newData); err != nil {
		if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
			logRollbackDeleteErr(versionAbsPath, rerr)
		}
		return nil, fmt.Errorf("write new content failed: %w", err)
	}

	if err := s.saveVersionAndUpdateTx(ctx, tx, item, versionRelPath, req.Content, req.ChangeSummary, userID, oldBytes, newData); err != nil {
		if rerr := stubWriteFile(ctx, currentAbsPath, oldBytes); rerr != nil {
			logRollbackWriteErr(currentAbsPath, rerr)
		}
		if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
			logRollbackDeleteErr(versionAbsPath, rerr)
		}
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		if rerr := stubWriteFile(ctx, currentAbsPath, oldBytes); rerr != nil {
			logRollbackWriteErr(currentAbsPath, rerr)
		}
		if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
			logRollbackDeleteErr(versionAbsPath, rerr)
		}
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

	sc := stubclient.FromContext(ctx)
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

// fetchItemBySourcePath 按 workspace_id、user_id 与 source_path 查询文档条目。
func (s *DBProductSpaceService) fetchItemBySourcePath(ctx context.Context, workspaceID, userID, sourcePath string) (*object.ProductSpaceItem, error) {
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
		return nil, fmt.Errorf("fetch item by source path failed: %w", err)
	}
	return &item, nil
}

// ImportProcessDeliverable 将流程产物按流程所有者身份导入产品空间并生成需求级分享链接。
// 当前用户只需是工作空间成员，产物实际以 ownerUserID（工作项负责人）身份写入其个人工作目录对应的产品空间。
// agent 标记中的路径为绝对路径（{workspaceRoot}/{operatorId}/{workspaceId}/...），
// 需保留原始绝对路径用于读取源文件，同时归一化为相对路径用于 DB 去重。
func (s *DBProductSpaceService) ImportProcessDeliverable(
	ctx context.Context,
	workspaceID, actingUserID, ownerUserID, workitemTitle, deliverableType, path string,
) (object.RequirementShare, error) {
	if err := s.requireMember(ctx, workspaceID, actingUserID); err != nil {
		return object.RequirementShare{}, err
	}
	if path == "" {
		return object.RequirementShare{}, invalidInput(errors.New("path is required"))
	}
	originalPath := path
	normalizedPath, err := normalizeDeliverablePath(s.workspaceRoot, workspaceID, path)
	if err != nil {
		return object.RequirementShare{}, invalidInput(err)
	}
	path = normalizedPath
	if err := validateRelativePath(path); err != nil {
		return object.RequirementShare{}, invalidInput(err)
	}

	absSourcePath := ""
	if filepath.IsAbs(originalPath) {
		absSourcePath = originalPath
	}

	switch deliverableType {
	case "file":
		return s.importProcessDoc(ctx, workspaceID, ownerUserID, workitemTitle, path, absSourcePath)
	case "project":
		return s.importProcessPrototype(ctx, workspaceID, ownerUserID, workitemTitle, path, absSourcePath)
	default:
		return object.RequirementShare{}, invalidInput(errors.New("deliverable type must be file or project"))
	}
}

// importProcessDoc 将流程中的文档产物（如 PRD）按所有者身份导入产品空间 docs 目录并发布。
// absSourcePath 非空时直接使用该绝对路径读取源文件（agent 标记路径），
// 为空时从 ownerUserID + sourcePath 重建路径（兼容相对路径调用）。
func (s *DBProductSpaceService) importProcessDoc(
	ctx context.Context,
	workspaceID, ownerUserID, workitemTitle, sourcePath, absSourcePath string,
) (object.RequirementShare, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return object.RequirementShare{}, errors.New("personal-stub client not initialized")
	}

	if absSourcePath == "" {
		ownerRoot, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, ownerUserID, workspaceID)
		if err != nil {
			return object.RequirementShare{}, invalidInput(err)
		}
		absSourcePath = filepath.Join(ownerRoot, sourcePath)
	}

	content, err := sc.ReadFile(ctx, absSourcePath)
	if err != nil {
		return object.RequirementShare{}, fmt.Errorf("%w: source file not found", ErrNotFound)
	}
	if int64(len(content)) > object.MaxDocSizeBytes {
		return object.RequirementShare{}, invalidInput(errors.New(errMsgDocTooLarge))
	}

	title := filepath.Base(sourcePath)
	ext := parseExtFromName(title)
	if ext == "" {
		ext = object.DocExtMarkdown
		title = title + "." + ext
	}
	if !object.AllowedDocExts[ext] {
		return object.RequirementShare{}, invalidInput(errors.New(errMsgInvalidExtension))
	}

	folder := ""
	if workitemTitle != "" {
		folder, err = sanitizeFolderPath(workitemTitle)
		if err != nil {
			return object.RequirementShare{}, invalidInput(err)
		}
	}
	name := stripExt(title, ext)
	relativePath := buildRelativePath(object.ProductSpaceDocsDir, folder, name, ext)
	if err := validateRelativePath(relativePath); err != nil {
		return object.RequirementShare{}, invalidInput(err)
	}

	var item *object.ProductSpaceItem
	existingBySource, err := s.fetchItemBySourcePath(ctx, workspaceID, ownerUserID, sourcePath)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return object.RequirementShare{}, err
	}
	if existingBySource != nil {
		item, err = s.updateDocContentAndPublish(ctx, workspaceID, ownerUserID, existingBySource.ID, content)
		if err != nil {
			return object.RequirementShare{}, err
		}
	} else {
		existingByPath, err := s.fetchItemByRelativePath(ctx, workspaceID, ownerUserID, relativePath)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return object.RequirementShare{}, err
		}
		if existingByPath != nil {
			item, err = s.updateDocContentAndPublish(ctx, workspaceID, ownerUserID, existingByPath.ID, content)
			if err != nil {
				return object.RequirementShare{}, err
			}
		} else {
			item, err = s.createDocItemAndPublish(ctx, workspaceID, ownerUserID, title, relativePath, content)
			if err != nil {
				return object.RequirementShare{}, err
			}
		}
	}

	if err := s.updateSourcePath(ctx, item.ID, sourcePath); err != nil {
		log.Printf("[ProductSpace] importProcessDoc update source_path failed for %s: %v", item.ID, err)
	}

	return s.createRequirementShareInternal(ctx, workspaceID, ownerUserID, object.CreateRequirementShareRequest{
		Title:         workitemTitle,
		DocID:         item.ID,
		AllowComments: true,
	})
}

// createDocItemAndPublish 在产品空间 docs 目录下新建文档条目并发布为可分享版本。
// 不校验 PM 权限，用于流程交付物等后端代为导入的场景。
func (s *DBProductSpaceService) createDocItemAndPublish(
	ctx context.Context,
	workspaceID, userID, title, relativePath, content string,
) (*object.ProductSpaceItem, error) {
	size := int64(len(content))
	ext, _ := parseAndValidateExt(object.ItemTypeDoc, title)
	mime := mimeTypeForExt(ext)

	baseAbs, absPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, invalidInput(err)
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}

	id := idutil.GenerateID()
	item, err := s.insertProductDoc(
		ctx, s.db, id, workspaceID, userID, object.ItemTypeDoc, title, id, relativePath,
		content, ItemStatusPublished, 1, ext, mime, size, userID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: %s", ErrConflict, errMsgItemAlreadyExists)
		}
		return nil, fmt.Errorf("insert product doc failed: %w", err)
	}

	if err := safeMkdirAll(ctx, baseAbs, filepath.Dir(absPath)); err != nil {
		return nil, err
	}
	if err := stubWriteFile(ctx, absPath, []byte(content)); err != nil {
		if rerr := stubDeleteFile(ctx, absPath); rerr != nil {
			logRollbackDeleteErr(absPath, rerr)
		}
		if _, rerr := s.db.ExecContext(ctx, "DELETE FROM product_docs WHERE id = $1", id); rerr != nil {
			log.Printf("[ProductSpace] rollback delete product_docs %s failed: %v", id, rerr)
		}
		return nil, fmt.Errorf("write initial file failed: %w", err)
	}

	if err := s.publishDocContentVersion(ctx, item.ID, item.Title, content, 1, userID); err != nil {
		return nil, err
	}
	return item, nil
}

// updateDocContentAndPublish 更新产品空间文档内容并发布新版本。
// 不校验 PM 权限，用于流程交付物等后端代为导入的场景。
func (s *DBProductSpaceService) updateDocContentAndPublish(
	ctx context.Context,
	workspaceID, userID, itemID, content string,
) (*object.ProductSpaceItem, error) {
	item, err := s.fetchItem(ctx, workspaceID, userID, itemID)
	if err != nil {
		return nil, err
	}
	if item.Type != object.ItemTypeDoc {
		return nil, invalidInput(errors.New(errMsgInvalidItemType))
	}
	if int64(len(content)) > object.MaxDocSizeBytes {
		return nil, invalidInput(errors.New(errMsgDocTooLarge))
	}

	_, absPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, userID, item.RelativePath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}
	if err := stubWriteFile(ctx, absPath, []byte(content)); err != nil {
		return nil, fmt.Errorf("write file failed: %w", err)
	}

	nextVersion := item.CurrentVersion + 1
	if err := s.publishDocContentVersion(ctx, item.ID, item.Title, content, nextVersion, userID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		UPDATE product_docs
		SET content = $1, status = $2, current_version = $3, size_bytes = $4, updated_at = $5
		WHERE id = $6 AND workspace_id = $7 AND user_id = $8
	`, content, ItemStatusPublished, nextVersion, int64(len(content)), now, item.ID, item.WorkspaceID, item.UserID)
	if err != nil {
		return nil, fmt.Errorf("update doc content failed: %w", err)
	}
	item.Status = ItemStatusPublished
	item.CurrentVersion = nextVersion
	item.SizeBytes = int64(len(content))
	item.UpdatedAt = now
	return item, nil
}

// publishDocContentVersion 向 product_doc_versions 插入一条带内容的新版本记录。
// 需求级分享视图通过 JOIN 该表读取文档内容，因此流程交付物必须创建内容版本。
func (s *DBProductSpaceService) publishDocContentVersion(
	ctx context.Context,
	itemID, title, content string,
	version int,
	userID string,
) error {
	id := idutil.GenerateID()
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO product_doc_versions (id, doc_id, version, title, content, change_summary, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, id, itemID, version, title, content, "流程交付物发布", userID, now)
	if err != nil {
		return fmt.Errorf("publish doc content version failed: %w", err)
	}
	return nil
}

// importProcessPrototype 将流程中的原型工程目录按所有者身份复制到产品空间 prototypes 目录。
// 只导入 .html 页面，并保留 Vite 工程的 dist/index.html 优先规则。
// absSourceFolder 非空时直接使用该绝对路径读取源目录（agent 标记路径），
// 为空时从 ownerUserID + sourceFolder 重建路径（兼容相对路径调用）。
func (s *DBProductSpaceService) importProcessPrototype(
	ctx context.Context,
	workspaceID, ownerUserID, workitemTitle, sourceFolder, absSourceFolder string,
) (object.RequirementShare, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return object.RequirementShare{}, errors.New("personal-stub client not initialized")
	}
	if sourceFolder == "" {
		return object.RequirementShare{}, invalidInput(errors.New("source folder is required"))
	}
	if err := validateRelativePath(sourceFolder); err != nil {
		return object.RequirementShare{}, invalidInput(err)
	}

	if absSourceFolder == "" {
		ownerRoot, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, ownerUserID, workspaceID)
		if err != nil {
			return object.RequirementShare{}, invalidInput(err)
		}
		absSourceFolder = filepath.Join(ownerRoot, sourceFolder)
	}

	folderName := filepath.Base(sourceFolder)
	sanitizedFolder, err := sanitizeFolderPath(folderName)
	if err != nil {
		return object.RequirementShare{}, invalidInput(fmt.Errorf("invalid folder name: %w", err))
	}
	if strings.Contains(sanitizedFolder, "/") {
		return object.RequirementShare{}, invalidInput(errors.New("source folder must be a top-level product"))
	}

	sourceDir := absSourceFolder
	targetRelPrefix := filepath.Join(object.ProductSpacePrototypesDir, sanitizedFolder)

	fi, err := stubFileInfo(ctx, sourceDir)
	if err != nil {
		return object.RequirementShare{}, fmt.Errorf("stat prototype folder failed: %w", err)
	}
	if !fi.Exists {
		return object.RequirementShare{}, fmt.Errorf("%w: %s", ErrNotFound, errMsgFolderNotFound)
	}
	if !fi.IsDir {
		return object.RequirementShare{}, invalidInput(errors.New("prototype path is not a directory"))
	}

	entries, err := sc.WalkDir(ctx, sourceDir)
	if err != nil {
		return object.RequirementShare{}, fmt.Errorf("walk prototype folder failed: %w", err)
	}

	imported := 0
	skipPrefixes := []string{}
	for _, we := range entries {
		if we.Path == sourceDir {
			continue
		}
		if we.IsDir {
			name := we.Name
			if strings.HasPrefix(name, ".") || name == "node_modules" {
				skipPrefixes = append(skipPrefixes, we.Path+string(filepath.Separator))
				continue
			}
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
		if strings.ToLower(filepath.Ext(we.Path)) != ".html" {
			continue
		}
		if err := rejectSymlink(we.Path); err != nil {
			log.Printf("reject symlink for prototype file %s failed: %v", we.Path, err)
			continue
		}

		rel, err := filepath.Rel(sourceDir, we.Path)
		if err != nil {
			log.Printf("compute relative path for prototype file %s failed: %v", we.Path, err)
			continue
		}
		rel = filepath.ToSlash(rel)

		// Vite 工程：根目录存在 dist/index.html 时跳过根 index.html。
		if strings.EqualFold(filepath.Base(we.Path), "index.html") {
			dirParts := strings.Split(rel, "/")
			if len(dirParts) == 1 {
				distIndex := filepath.Join(filepath.Dir(we.Path), "dist", "index.html")
				if fi, err := stubFileInfo(ctx, distIndex); err == nil && fi != nil && fi.Exists && !fi.IsDir {
					continue
				}
			}
		}

		data, err := stubReadFile(ctx, we.Path)
		if err != nil {
			log.Printf("read prototype file %s failed: %v", we.Path, err)
			continue
		}

		targetRelPath := filepath.Join(targetRelPrefix, rel)
		if err := validateRelativePath(targetRelPath); err != nil {
			log.Printf("invalid target relative path %s: %v", targetRelPath, err)
			continue
		}
		baseAbs, targetAbsPath, err := resolveProductSpacePathWithBase(s.workspaceRoot, workspaceID, ownerUserID, targetRelPath)
		if err != nil {
			log.Printf("resolve target path for %s failed: %v", targetRelPath, err)
			continue
		}
		if err := rejectSymlink(targetAbsPath); err != nil {
			log.Printf("reject symlink target %s failed: %v", targetAbsPath, err)
			continue
		}

		existing, err := s.fetchItemByRelativePath(ctx, workspaceID, ownerUserID, targetRelPath)
		if err != nil && !errors.Is(err, ErrNotFound) {
			log.Printf("fetch existing item %s failed: %v", targetRelPath, err)
			continue
		}

		if err := safeMkdirAll(ctx, baseAbs, filepath.Dir(targetAbsPath)); err != nil {
			log.Printf("mkdir target dir for %s failed: %v", targetAbsPath, err)
			continue
		}
		if err := stubWriteFile(ctx, targetAbsPath, data); err != nil {
			log.Printf("write prototype file %s failed: %v", targetAbsPath, err)
			continue
		}

		contentBase64 := base64.StdEncoding.EncodeToString(data)
		size := int64(len(data))
		title := filepath.Base(we.Path)
		if existing != nil {
			_, err := s.db.ExecContext(ctx, `
				UPDATE product_docs
				SET content = $1, size_bytes = $2, updated_at = $3
				WHERE id = $4 AND workspace_id = $5 AND user_id = $6
			`, contentBase64, size, time.Now().UTC(), existing.ID, workspaceID, ownerUserID)
			if err != nil {
				log.Printf("update product_docs for %s failed: %v", targetRelPath, err)
				continue
			}
		} else {
			id := idutil.GenerateID()
			_, err := s.insertProductDoc(ctx, s.db, id, workspaceID, ownerUserID, object.ItemTypePrototype, title, id, targetRelPath,
				contentBase64, ItemStatusDraft, 1, "html", mimeTypeForExt("html"), size, ownerUserID)
			if err != nil {
				log.Printf("import prototype file %s failed: %v", targetRelPath, err)
				_, _ = s.db.ExecContext(ctx, "DELETE FROM product_docs WHERE id = $1", id)
				continue
			}
		}
		imported++
	}

	if imported == 0 {
		return object.RequirementShare{}, invalidInput(errors.New("未找到可导入的 .html 原型页面"))
	}

	return s.createRequirementShareInternal(ctx, workspaceID, ownerUserID, object.CreateRequirementShareRequest{
		Title:         workitemTitle,
		ProductFolder: sanitizedFolder,
		AllowComments: true,
	})
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
	if err := safeMkdirAll(ctx, baseAbs, absPath); err != nil {
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

	entries, err := stubListDir(ctx, absPath)
	if err != nil {
		if !stubFileExists(ctx, absPath) {
			return fmt.Errorf("%w: %s", ErrNotFound, errMsgFolderNotFound)
		}
		return fmt.Errorf("read folder failed: %w", err)
	}
	if len(entries) > 0 {
		return fmt.Errorf("%w: %s", ErrConflict, errMsgFolderNotEmpty)
	}
	if err := stubDeleteFile(ctx, absPath); err != nil {
		return fmt.Errorf("remove folder failed: %w", err)
	}

	// 删除成功后，清理并行存储版本文件的对应空目录。
	versionsAbsPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, filepath.Join(object.ProductSpaceVersionsDir, req.Category, folder))
	if err == nil {
		if entries, err := stubListDir(ctx, versionsAbsPath); err == nil && len(entries) == 0 {
			if rerr := stubDeleteFile(ctx, versionsAbsPath); rerr != nil {
				logRollbackDeleteErr(versionsAbsPath, rerr)
			}
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
	fi, err := stubFileInfo(ctx, protoPath)
	if err != nil {
		return nil, fmt.Errorf("stat prototype folder failed: %w", err)
	}
	if !fi.Exists {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, errMsgFolderNotFound)
	}
	if !fi.IsDir {
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
	// 架构合规：通过 stubclient.WalkDir 委托 personal-stub 遍历，不直接访问文件系统。
	importSC := stubclient.FromContext(ctx)
	if importSC == nil {
		return nil, errors.New("personal-stub client not initialized")
	}
	importEntries, importWalkErr := importSC.WalkDir(context.Background(), protoPath)
	if importWalkErr != nil {
		return nil, fmt.Errorf("walk prototype folder failed: %w", importWalkErr)
	}
	skipPrefixes2 := []string{}
	for _, we := range importEntries {
		if we.Path == protoPath {
			continue
		}
		if we.IsDir {
			name := we.Name
			if strings.HasPrefix(name, ".") || name == "node_modules" {
				skipPrefixes2 = append(skipPrefixes2, we.Path+string(filepath.Separator))
				continue
			}
			continue
		}
		skipped := false
		for _, prefix := range skipPrefixes2 {
			if strings.HasPrefix(we.Path, prefix) {
				skipped = true
				break
			}
		}
		if skipped {
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
		rel = filepath.ToSlash(rel)
		relPath := filepath.Join(protoRelPrefix, rel)

		// Vite 工程：根目录存在 dist/index.html 时跳过根 index.html。
		if strings.EqualFold(filepath.Base(path), "index.html") {
			dirParts := strings.Split(rel, "/")
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

		if itemID, ok := existing[relPath]; ok {
			// 已存在：更新内容为新生成的文件，并创建新版本。
			changed, updateErr := s.updatePrototypeContentByID(ctx, workspaceID, userID, itemID, data, "采纳原型")
			if updateErr != nil {
				log.Printf("update prototype file %s failed: %v", relPath, updateErr)
				continue
			}
			if changed {
				affectedIDs = append(affectedIDs, itemID)
				updated++
			}
			continue
		}

		title := filepath.Base(path)
		size := int64(len(data))
		content := base64.StdEncoding.EncodeToString(data)
		id := idutil.GenerateID()
		item, err := s.insertProductDoc(ctx, s.db, id, workspaceID, userID, object.ItemTypePrototype, title, id, relPath, content, ItemStatusDraft, 1, "html", mimeTypeForExt("html"), size, userID)
		if err != nil {
			log.Printf("import prototype file %s failed: %v", relPath, err)
			continue
		}
		affectedIDs = append(affectedIDs, item.ID)
		imported++
	}
	if imported == 0 && updated == 0 && len(existing) == 0 {
		return nil, invalidInput(errors.New("未找到可导入的 .html 原型页面"))
	}
	// 没有新增也未更新时返回空列表，避免创建无意义的设计版本。
	return affectedIDs, nil
}
