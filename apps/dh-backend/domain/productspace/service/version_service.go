package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/google/uuid"
)

// resolveVersionFilePath 解析 product_doc_versions 中存储的文件路径。
// 历史版本表中可能存储绝对路径；若路径已是绝对路径，则校验其位于用户的产品空间根目录下后直接使用。
func (s *DBProductSpaceService) resolveVersionFilePath(workspaceID, userID, storedPath string) (string, error) {
	if storedPath == "" {
		return "", errors.New("version file path is empty")
	}
	if filepath.IsAbs(storedPath) {
		// 校验已存储的绝对路径位于用户的产品空间根目录下，防止路径逃逸。
		// 先对 storedPath 做 Clean，避免 /base/.../etc/passwd 这类路径绕过前缀检查。
		baseRoot, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
		if err != nil {
			return "", err
		}
		base := filepath.Join(baseRoot, object.ProductSpaceRoot)
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
	baseRoot, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return "", err
	}
	base := filepath.Join(baseRoot, object.ProductSpaceRoot)
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

// readFileBytes 根据相对路径读取文件内容。
func (s *DBProductSpaceService) readFileBytes(ctx context.Context, workspaceID, userID, relativePath string) ([]byte, error) {
	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, userID, relativePath)
	if err != nil {
		return nil, err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, fmt.Errorf("symlink check failed: %w", err)
	}
	data, err := stubReadFile(ctx, absPath)
	if err != nil {
		return nil, fmt.Errorf("read file failed: %w", err)
	}
	return data, nil
}

// deleteVersionFiles 删除目录下所有匹配 name-v*.ext 的版本文件。
func deleteVersionFiles(ctx context.Context, dir, name, ext string) error {
	entries, err := stubListDir(ctx, dir)
	if err != nil {
		if !stubFileExists(ctx, dir) {
			return nil
		}
		return fmt.Errorf("read directory failed: %w", err)
	}
	prefix := name + versionSuffix
	suffix := "." + ext
	for _, entry := range entries {
		if entry.IsDir {
			continue
		}
		fname := entry.Name
		if !strings.HasPrefix(fname, prefix) {
			continue
		}
		if !strings.HasSuffix(fname, suffix) {
			continue
		}
		if err := stubDeleteFile(ctx, filepath.Join(dir, fname)); err != nil {
			return fmt.Errorf("remove version file %s failed: %w", fname, err)
		}
	}
	return nil
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

	oldBytes, err = stubReadFile(ctx, currentAbsPath)
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
	if err := safeMkdirAll(ctx, baseAbs, filepath.Dir(versionAbsPath)); err != nil {
		return "", "", nil, err
	}
	if err := copyFile(ctx, currentAbsPath, versionAbsPath); err != nil {
		return "", "", nil, fmt.Errorf("backup current version failed: %w", err)
	}

	if err := stubWriteFile(ctx, currentAbsPath, newContent); err != nil {
		if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
			logRollbackDeleteErr(versionAbsPath, rerr)
		}
		return "", "", nil, fmt.Errorf("write new content failed: %w", err)
	}

	contentBase64 := base64.StdEncoding.EncodeToString(newContent)
	if err := s.saveVersionAndUpdateTx(ctx, tx, item, versionRelPath, contentBase64, changeSummary, userID, oldBytes, newContent); err != nil {
		if rerr := stubWriteFile(ctx, currentAbsPath, oldBytes); rerr != nil {
			logRollbackWriteErr(currentAbsPath, rerr)
		}
		if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
			logRollbackDeleteErr(versionAbsPath, rerr)
		}
		return "", "", nil, err
	}

	return currentAbsPath, versionAbsPath, oldBytes, nil
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
		if rerr := stubWriteFile(ctx, currentAbsPath, oldBytes); rerr != nil {
			logRollbackWriteErr(currentAbsPath, rerr)
		}
		if rerr := stubDeleteFile(ctx, versionAbsPath); rerr != nil {
			logRollbackDeleteErr(versionAbsPath, rerr)
		}
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
	if err := safeMkdirAll(ctx, baseAbs, filepath.Dir(snapshotAbsPath)); err != nil {
		return nil, err
	}

	changeSummary := fmt.Sprintf(changeSummaryRestoreToVersion, targetVersion)
	if len([]rune(changeSummary)) > maxChangeSummaryLength {
		return nil, invalidInput(errors.New(errMsgChangeSummaryTooLong))
	}

	oldBytes, err := stubReadFile(ctx, currentAbsPath)
	if err != nil {
		return nil, fmt.Errorf("read current file failed: %w", err)
	}

	rollbackFS := func() {
		if rerr := stubWriteFile(ctx, currentAbsPath, oldBytes); rerr != nil {
			logRollbackWriteErr(currentAbsPath, rerr)
		}
		if rerr := stubDeleteFile(ctx, snapshotAbsPath); rerr != nil {
			logRollbackDeleteErr(snapshotAbsPath, rerr)
		}
	}

	if err := copyFile(ctx, sourceVersionAbsPath, currentAbsPath); err != nil {
		rollbackFS()
		return nil, fmt.Errorf("restore version file failed: %w", err)
	}

	restoredBytes, err := stubReadFile(ctx, currentAbsPath)
	if err != nil {
		rollbackFS()
		return nil, fmt.Errorf("read restored file failed: %w", err)
	}

	if err := stubWriteFile(ctx, snapshotAbsPath, restoredBytes); err != nil {
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
	data, err := stubReadFile(ctx, absPath)
	if err != nil {
		return "", nil, fmt.Errorf("read version file failed: %w", err)
	}

	return buildVersionFileName(name, ext, version), data, nil
}
