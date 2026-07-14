package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/google/uuid"
)

const (
	// maxShareCommentAuthorLen 批注昵称最大长度（rune 计）。
	maxShareCommentAuthorLen = 64
	// maxShareCommentQuoteLen 批注引用文本最大长度（rune 计）。
	maxShareCommentQuoteLen = 500
	// maxShareCommentContentLen 批注内容最大长度（rune 计）。
	maxShareCommentContentLen = 2000
)

// 分享批注状态。
const (
	shareCommentStatusOpen     = "open"
	shareCommentStatusResolved = "resolved"
)

// shareCommentColumns 批注表查询列清单，顺序与 scanShareComment 的扫描参数一一对应。
const shareCommentColumns = "id, share_token, doc_id, workspace_id, author_name, quote_text, content, status, created_at, resolved_at, resolved_by"

// shareCommentScanner 抽象 *sql.Row / *sql.Rows 的 Scan 能力，供 scanShareComment 复用。
type shareCommentScanner interface {
	Scan(dest ...any) error
}

// scanShareComment 扫描一行批注记录；resolved_at/resolved_by 为可空列，仅在已解决时有值。
func scanShareComment(sc shareCommentScanner) (object.ShareComment, error) {
	var c object.ShareComment
	var resolvedAt sql.NullTime
	var resolvedBy sql.NullString
	err := sc.Scan(
		&c.ID, &c.ShareToken, &c.DocID, &c.WorkspaceID,
		&c.AuthorName, &c.QuoteText, &c.Content, &c.Status,
		&c.CreatedAt, &resolvedAt, &resolvedBy,
	)
	if err != nil {
		return object.ShareComment{}, err
	}
	if resolvedAt.Valid {
		c.ResolvedAt = &resolvedAt.Time
	}
	if resolvedBy.Valid {
		c.ResolvedBy = resolvedBy.String
	}
	return c, nil
}

// lookupShare 校验分享 token 是否有效，有效时返回其关联的 docID 与 workspaceID。
func (s *DBProductDocService) lookupShare(token string) (docID, workspaceID string, err error) {
	err = s.db.QueryRow(
		`SELECT doc_id, workspace_id FROM product_doc_shares WHERE token = $1`, token,
	).Scan(&docID, &workspaceID)
	if err != nil {
		return "", "", errors.New("分享链接不存在或已失效")
	}
	return docID, workspaceID, nil
}

// listShareComments 按给定 WHERE 子句查询批注，统一按创建时间升序返回。
func (s *DBProductDocService) listShareComments(where string, args ...any) ([]object.ShareComment, error) {
	rows, err := s.db.Query(
		`SELECT `+shareCommentColumns+` FROM product_doc_share_comments `+where+` ORDER BY created_at ASC`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("查询分享批注失败: %w", err)
	}
	defer rows.Close()

	comments := make([]object.ShareComment, 0)
	for rows.Next() {
		c, err := scanShareComment(rows)
		if err != nil {
			return nil, fmt.Errorf("扫描分享批注失败: %w", err)
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历分享批注失败: %w", err)
	}
	return comments, nil
}

// validateShareCommentInput 校验并规范化批注输入：三字段 trim 后必须非空且长度不超上限（按 rune 计，
// 避免中文等多字节字符被按字节截断）。
func validateShareCommentInput(req object.AddShareCommentRequest) (authorName, quoteText, content string, err error) {
	authorName = strings.TrimSpace(req.AuthorName)
	if authorName == "" || utf8.RuneCountInString(authorName) > maxShareCommentAuthorLen {
		return "", "", "", fmt.Errorf("昵称不能为空且不超过 %d 个字符", maxShareCommentAuthorLen)
	}
	quoteText = strings.TrimSpace(req.QuoteText)
	if quoteText == "" || utf8.RuneCountInString(quoteText) > maxShareCommentQuoteLen {
		return "", "", "", fmt.Errorf("引用文本不能为空且不超过 %d 个字符", maxShareCommentQuoteLen)
	}
	content = strings.TrimSpace(req.Content)
	if content == "" || utf8.RuneCountInString(content) > maxShareCommentContentLen {
		return "", "", "", fmt.Errorf("批注内容不能为空且不超过 %d 个字符", maxShareCommentContentLen)
	}
	return authorName, quoteText, content, nil
}

// ListShareCommentsByToken 免登录场景：按分享 token 列出该文档的全部批注（按创建时间升序）。
func (s *DBProductDocService) ListShareCommentsByToken(token string) ([]object.ShareComment, error) {
	docID, _, err := s.lookupShare(token)
	if err != nil {
		return nil, err
	}
	return s.listShareComments(`WHERE doc_id = $1`, docID)
}

// AddShareComment 免登录场景：访客在分享页新增批注，初始状态为 open。
func (s *DBProductDocService) AddShareComment(token string, req object.AddShareCommentRequest) (*object.ShareComment, error) {
	docID, workspaceID, err := s.lookupShare(token)
	if err != nil {
		return nil, err
	}
	authorName, quoteText, content, err := validateShareCommentInput(req)
	if err != nil {
		return nil, err
	}

	comment, err := scanShareComment(s.db.QueryRow(`
		INSERT INTO product_doc_share_comments
			(id, share_token, doc_id, workspace_id, author_name, quote_text, content, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+shareCommentColumns,
		uuid.New().String(), token, docID, workspaceID, authorName, quoteText, content, shareCommentStatusOpen,
	))
	if err != nil {
		return nil, fmt.Errorf("新增分享批注失败: %w", err)
	}
	return &comment, nil
}

// ListDocShareComments 登录场景：列出工作空间内某文档的全部分享批注（按创建时间升序）。
func (s *DBProductDocService) ListDocShareComments(workspaceID, docID string) ([]object.ShareComment, error) {
	doc, err := s.GetDoc(docID)
	if err != nil {
		return nil, errors.New("文档不存在")
	}
	if doc.WorkspaceID != workspaceID {
		return nil, errors.New("文档不属于当前工作空间")
	}
	return s.listShareComments(`WHERE doc_id = $1 AND workspace_id = $2`, docID, workspaceID)
}

// ResolveShareComment 登录场景：将批注标记为已解决。
// 幂等设计：UPDATE 仅匹配 status='open' 的记录，若影响 0 行则回查——
// 记录存在说明已被解决（重复调用），直接返回当前记录；不存在则返回“批注不存在”。
func (s *DBProductDocService) ResolveShareComment(workspaceID, docID, commentID, userID string) (*object.ShareComment, error) {
	comment, err := scanShareComment(s.db.QueryRow(`
		UPDATE product_doc_share_comments
		SET status = $1, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2
		WHERE id = $3 AND doc_id = $4 AND workspace_id = $5 AND status = $6
		RETURNING `+shareCommentColumns,
		shareCommentStatusResolved, userID, commentID, docID, workspaceID, shareCommentStatusOpen,
	))
	if err == nil {
		return &comment, nil
	}

	existing, qerr := scanShareComment(s.db.QueryRow(
		`SELECT `+shareCommentColumns+` FROM product_doc_share_comments WHERE id = $1 AND doc_id = $2 AND workspace_id = $3`,
		commentID, docID, workspaceID,
	))
	if qerr != nil {
		return nil, errors.New("批注不存在")
	}
	return &existing, nil
}
