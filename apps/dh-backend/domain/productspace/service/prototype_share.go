package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

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
	data, err := stubReadFile(ctx, absPath)
	if err != nil {
		if !stubFileExists(ctx, absPath) {
			return nil, "", fmt.Errorf("%w: %s", ErrNotFound, errMsgItemNotFound)
		}
		return nil, "", fmt.Errorf("read file failed: %w", err)
	}
	ext := parseExtFromName(absPath)
	return data, mimeTypeForExt(ext), nil
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
		idutil.GenerateID(), token, workspaceID, userID, folder, now,
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
	// 确保 per-user personal-stub 运行（direct-host 按需启动，免登录请求不经过 containerMW）。
	if s.ensureStubRunning != nil {
		_ = s.ensureStubRunning(context.Background(), userID)
	}
	data, err := stubReadFile(context.Background(), absPath)
	if err != nil {
		if !stubFileExists(context.Background(), absPath) {
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
