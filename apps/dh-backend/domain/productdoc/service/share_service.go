package service

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

const (
	// shareTokenLength 分享短链 token 长度（base62 字符集）。
	shareTokenLength = 10
	// shareTokenAlphabet 短链 token 字符集。
	shareTokenAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
)

// generateShareToken 生成指定长度的 base62 随机 token。
func generateShareToken(length int) (string, error) {
	max := big.NewInt(int64(len(shareTokenAlphabet)))
	buf := make([]byte, length)
	for i := range buf {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generate share token failed: %w", err)
		}
		buf[i] = shareTokenAlphabet[n.Int64()]
	}
	return string(buf), nil
}

// CreateShare 为已发布文档创建分享短链；同一文档重复调用返回已有链接（幂等）。
// 草稿/归档文档不可分享。
func (s *DBProductDocService) CreateShare(workspaceID, docID string) (object.ProductDocShare, error) {
	doc, err := s.GetDoc(docID)
	if err != nil {
		return object.ProductDocShare{}, errors.New("文档不存在")
	}
	if doc.WorkspaceID != workspaceID {
		return object.ProductDocShare{}, errors.New("文档不属于当前工作空间")
	}
	if doc.Status != object.DocStatusPublished {
		return object.ProductDocShare{}, errors.New("仅已发布文档可分享")
	}

	// 已存在分享链接时直接返回，保证同一文档链接稳定不变
	var existing object.ProductDocShare
	err = s.db.QueryRow(
		`SELECT token, doc_id, created_at FROM product_doc_shares WHERE doc_id = $1`, docID,
	).Scan(&existing.Token, &existing.DocID, &existing.CreatedAt)
	if err == nil {
		return existing, nil
	}

	token, err := generateShareToken(shareTokenLength)
	if err != nil {
		return object.ProductDocShare{}, err
	}
	now := time.Now().UTC()
	share := object.ProductDocShare{Token: token, DocID: docID, CreatedAt: now}
	_, err = s.db.Exec(
		`INSERT INTO product_doc_shares (id, token, doc_id, workspace_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
		idutil.GenerateID(), token, docID, workspaceID, now,
	)
	if err != nil {
		return object.ProductDocShare{}, fmt.Errorf("create product doc share failed: %w", err)
	}
	return share, nil
}

// GetSharedDoc 免登录访问：按 token 解析文档的最新已发布版本，并附带文档创建人姓名。
// LEFT JOIN users 容错创建人已删除的场景，此时 createdByName 返回空字符串。
// 创建人姓名解析优先级：文档创建人 d.created_by 优先；历史数据中该字段为空（建文档流程未写入），
// 此时回退到最新版本发布人 v.created_by（v2 起发布流程会写入）。
func (s *DBProductDocService) GetSharedDoc(token string) (object.SharedDocView, error) {
	var view object.SharedDocView
	err := s.db.QueryRow(`
		SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
		FROM product_doc_shares s
		JOIN product_docs d ON d.id = s.doc_id
		JOIN product_doc_versions v ON v.doc_id = s.doc_id
		LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
		WHERE s.token = $1
		ORDER BY v.version DESC
		LIMIT 1
	`, token).Scan(&view.Title, &view.Content, &view.Version, &view.PublishedAt, &view.CreatedByName)
	if err != nil {
		return object.SharedDocView{}, errors.New("分享链接不存在或已失效")
	}
	return view, nil
}
