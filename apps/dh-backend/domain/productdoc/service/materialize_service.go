package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
)

const (
	// materializeDirName 是 agent 工作目录下产品文档落盘的根目录名。
	materializeDirName = "products"
	// defaultDocRelativeDir 是历史文档（relative_path 为空）的默认落盘子目录。
	defaultDocRelativeDir = "docs"
	// materializeDocFileExt 默认落盘文件扩展名。
	materializeDocFileExt = "md"
	// materializeDocMimeType 默认落盘文件 MIME 类型。
	materializeDocMimeType = "text/markdown"
)

// MaterializeDoc 将数据库中的产品文档按需写入 agent 工作目录下的 products/ 目录，
// 返回相对 agent 工作目录的路径（如 products/docs/xxx.md），供 agent 直接按路径读取。
// 流程：校验文档归属 → 解析（必要时回填）relative_path → 安全写盘。
func (s *DBProductDocService) MaterializeDoc(workspaceID, userID, docID string) (string, error) {
	doc, err := s.GetDoc(docID)
	if err != nil {
		return "", errors.New("文档不存在")
	}
	if doc.WorkspaceID != workspaceID {
		return "", errors.New("文档不属于当前工作空间")
	}

	relativePath, err := s.resolveMaterializeRelativePath(docID)
	if err != nil {
		return "", err
	}

	target, err := s.resolveMaterializeTarget(workspaceID, userID, relativePath)
	if err != nil {
		return "", err
	}

	if err := writeMaterializedDoc(target, doc.Content); err != nil {
		return "", err
	}

	// 统一使用 "/" 分隔，保证返回路径与 agent 工作目录约定一致（跨平台可读）。
	return materializeDirName + "/" + filepath.ToSlash(relativePath), nil
}

// resolveMaterializeRelativePath 读取文档的 relative_path；为空时生成 docs/{docID}.md
// 并回填到数据库，使后续 product-space 树形解析与再次落盘保持一致。
func (s *DBProductDocService) resolveMaterializeRelativePath(docID string) (string, error) {
	var relativePath sql.NullString
	err := s.db.QueryRow("SELECT relative_path FROM product_docs WHERE id = $1", docID).Scan(&relativePath)
	if err != nil {
		return "", fmt.Errorf("query product doc relative path failed: %w", err)
	}
	if relativePath.Valid && relativePath.String != "" {
		return relativePath.String, nil
	}

	generated := fmt.Sprintf("%s/%s.%s", defaultDocRelativeDir, docID, materializeDocFileExt)
	if _, err := s.db.Exec(
		"UPDATE product_docs SET relative_path = $1, file_ext = $2, mime_type = $3 WHERE id = $4",
		generated, materializeDocFileExt, materializeDocMimeType, docID,
	); err != nil {
		return "", fmt.Errorf("backfill product doc relative path failed: %w", err)
	}
	return generated, nil
}

// resolveMaterializeTarget 计算落盘绝对路径并校验路径逃逸：
// filepath.Clean 后的目标必须仍以 {workspaceRoot}/{wsID}/{userID}/products/ 为前缀，
// 防止恶意 relative_path（如 ../../etc/passwd）写穿工作区。
func (s *DBProductDocService) resolveMaterializeTarget(workspaceID, userID, relativePath string) (string, error) {
	base := filepath.Join(s.workspaceRoot, workspaceID, userID, materializeDirName)
	target := filepath.Clean(filepath.Join(base, relativePath))
	if !strings.HasPrefix(target, base+string(filepath.Separator)) {
		return "", errors.New("文档落盘路径非法")
	}
	return target, nil
}

// writeMaterializedDoc 通过 personal-stub 安全写入文档内容。
// 架构合规：dh-backend 不直接写共享目录，委托 personal-stub 执行文件写入。
// personal-stub 的 FileWrite 会自动创建父目录并进行路径安全校验。
func writeMaterializedDoc(target, content string) error {
	sc := stubclient.Default()
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	if err := sc.WriteFile(context.Background(), target, content); err != nil {
		return fmt.Errorf("write materialized doc via stub failed: %w", err)
	}
	return nil
}
