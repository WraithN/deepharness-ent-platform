package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"math/big"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

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

// GetOrCreateRequirementShare 为工作空间任意成员获取需求分享链接（无需 PM 权限），幂等。
// 其他行为与 CreateRequirementShare 一致，但仅校验成员资格，不要求 PM 角色。
func (s *DBProductSpaceService) GetOrCreateRequirementShare(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error) {
	if err := s.requireMember(ctx, workspaceID, userID); err != nil {
		return object.RequirementShare{}, err
	}
	return s.createRequirementShareInternal(ctx, workspaceID, userID, req)
}

// CreateRequirementShare 为需求创建统一的文档+原型分享链接（需 PM 权限）。
// doc_id 与 product_folder 至少提供一个；两者都为空时返回参数错误。
// 同一需求（workspace+user+doc+product）重复调用返回已有链接（幂等）。
// allowComments 在重复创建时也会同步更新。
func (s *DBProductSpaceService) CreateRequirementShare(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error) {
	if err := s.requirePM(ctx, workspaceID, userID); err != nil {
		return object.RequirementShare{}, err
	}
	return s.createRequirementShareInternal(ctx, workspaceID, userID, req)
}

// createRequirementShareInternal 为共享逻辑实现，输入校验后幂等创建或返回已有分享。
func (s *DBProductSpaceService) createRequirementShareInternal(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error) {
	folder := req.ProductFolder

	// 未提供 product_folder 但提供了 proto_item_id 时，从 DB 解析产品文件夹名
	if folder == "" && req.ProtoItemID != "" {
		resolved, resolveErr := s.resolveProductFolderFromProtoItem(ctx, workspaceID, req.ProtoItemID)
		if resolveErr != nil {
			return object.RequirementShare{}, invalidInput(fmt.Errorf("resolve product folder from proto item: %w", resolveErr))
		}
		folder = resolved
	}

	if req.DocID == "" && folder == "" {
		return object.RequirementShare{}, fmt.Errorf("%w: doc_id 或 product_folder 至少提供一个", ErrInvalidInput)
	}

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
		// 老数据兼容：幂等返回已有分享时，若快照缺失则补写。
		if existing.DocID != "" {
			s.ensureDocSnapshot(ctx, existing.Token, existing.DocID)
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
		idutil.GenerateID(), token, workspaceID, userID, nullIfEmpty(req.Title), nullIfEmpty(req.DocID), nullIfEmpty(folder), req.AllowComments, now,
	)
	if err != nil {
		return object.RequirementShare{}, fmt.Errorf("create requirement share failed: %w", err)
	}
	// 创建分享时锁定文档版本快照，后续文档上下线不影响已发出的分享。
	if share.DocID != "" {
		s.writeDocSnapshot(ctx, share.Token, share.DocID)
	}
	return share, nil
}

// resolveProductFolderFromProtoItem 按原型条目 ID 从 product_docs 表直接查询 relative_path，
// 解析出产品文件夹名称（如 "产品A"），不做 user_id 校验以便普通成员也可使用。
func (s *DBProductSpaceService) resolveProductFolderFromProtoItem(ctx context.Context, workspaceID, itemID string) (string, error) {
	var relativePath string
	err := s.db.QueryRowContext(ctx,
		`SELECT relative_path FROM product_docs
		 WHERE id = $1 AND workspace_id = $2 AND type = 'prototype'`,
		itemID, workspaceID,
	).Scan(&relativePath)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("prototype item not found: %w", ErrNotFound)
	}
	if err != nil {
		return "", fmt.Errorf("query prototype item relative path: %w", err)
	}

	prefix := object.ProductSpacePrototypesDir + "/"
	if !strings.HasPrefix(relativePath, prefix) {
		return "", fmt.Errorf("prototype item path does not start with %s: %s", prefix, relativePath)
	}
	rest := relativePath[len(prefix):]
	if idx := strings.Index(rest, "/"); idx >= 0 {
		return rest[:idx], nil
	}
	return rest, nil
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
	workspaceID, _, title, docID, productFolder, allowComments, err := s.resolveRequirementShareByToken(token)
	if err != nil {
		return object.SharedRequirementView{}, err
	}

	var view object.SharedRequirementView
	view.Title = title
	view.AllowComments = allowComments

	// 文档：优先读快照（文档后续上下线不影响分享）；快照缺失时回退查 product_docs（兼容老数据）。
	if docID != "" {
		view.Doc = s.loadDocSnapshotOrFallback(token, docID)
	}

	// 原型：复用 GetSharedPrototype 的页面列表逻辑
	if productFolder != "" {
		prefix := filepath.Join(object.ProductSpacePrototypesDir, productFolder) + "/"
		rows, err := s.db.Query(
			`SELECT id, title, relative_path FROM product_docs
			 WHERE workspace_id = $1 AND type = $2 AND relative_path LIKE $3 ESCAPE '\'
			 ORDER BY title`,
			workspaceID, object.ItemTypePrototype, escapeLikePattern(prefix)+"%",
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

// loadDocSnapshotOrFallback 优先读分享文档快照；快照缺失时回退查 product_docs 已发布版本（兼容老数据）。
func (s *DBProductSpaceService) loadDocSnapshotOrFallback(token, docID string) *object.SharedDocInfo {
	// 1. 读快照
	var doc object.SharedDocInfo
	var createdByName sql.NullString
	err := s.db.QueryRow(`
		SELECT doc_title, doc_content, doc_version, published_at, created_by_name
		FROM requirement_share_doc_snapshots WHERE share_token = $1
	`, token).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
	if err == nil {
		doc.CreatedByName = createdByName.String
		return &doc
	}
	// 2. 快照缺失：回退查 product_docs（兼容快照机制上线前的老分享）
	err = s.db.QueryRow(`
		SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
		FROM product_docs d
		JOIN product_doc_versions v ON v.doc_id = d.id
		LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
		WHERE d.id = $1 AND d.status = 'published'
		ORDER BY v.version DESC
		LIMIT 1
	`, docID).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
	if err != nil {
		return nil
	}
	doc.CreatedByName = createdByName.String
	return &doc
}

// ServeSharedRequirementFile 免登录 serve 需求分享中的原型文件。
// 校验逻辑与 ServeSharedFile 一致，只是 token 来源为 requirement_shares 表。
func (s *DBProductSpaceService) ServeSharedRequirementFile(token, relativePath string) ([]byte, string, error) {
	workspaceID, _, _, _, productFolder, _, err := s.resolveRequirementShareByToken(token)
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

	// 按原型文件的相对路径查找正确的 user_id，而非使用分享创建者的 user_id。
	// 原型文件可能由 agent 或其他用户上传，与分享创建者不是同一人。
	var fileUserID string
	findErr := s.db.QueryRow(
		`SELECT DISTINCT user_id FROM product_docs
		 WHERE workspace_id = $1 AND type = $2 AND relative_path LIKE $3 ESCAPE '\'
		 LIMIT 1`,
		workspaceID, object.ItemTypePrototype, escapeLikePattern(allowedPrefix)+"%",
	).Scan(&fileUserID)
	if findErr != nil {
		return nil, "", fmt.Errorf("cannot determine file owner: %w", findErr)
	}

	absPath, err := resolveProductSpacePath(s.workspaceRoot, workspaceID, fileUserID, relativePath)
	if err != nil {
		return nil, "", err
	}
	if err := rejectSymlink(absPath); err != nil {
		return nil, "", fmt.Errorf("symlink check failed: %w", err)
	}
	data, err := stubReadFile(context.Background(), absPath)
	if err != nil {
		if !stubFileExists(context.Background(), absPath) {
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
	`, idutil.GenerateID(), itemID, workspaceID, anonymousVisitorUserID, content, selector, targetText, req.X, req.Y), &c)
	if err != nil {
		return nil, fmt.Errorf("insert requirement share prototype comment failed: %w", err)
	}
	return &c, nil
}

// toDocShareComment 将 productdoc 的 ShareComment 字段映射为 productspace 自有的 DocShareComment。
func toDocShareComment(c *shareCommentInternal) object.DocShareComment {
	if c == nil {
		return object.DocShareComment{}
	}
	return object.DocShareComment{
		ID:          c.ID,
		ShareToken:  c.ShareToken,
		DocID:       c.DocID,
		WorkspaceID: c.WorkspaceID,
		AuthorName:  c.AuthorName,
		QuoteText:   c.QuoteText,
		Content:     c.Content,
		Status:      c.Status,
		CreatedAt:   c.CreatedAt,
		ResolvedAt:  c.ResolvedAt,
		ResolvedBy:  c.ResolvedBy,
	}
}

// shareCommentInternal 是数据库扫描使用的内部结构，字段与 productdoc/object.ShareComment 一致，
// 但 productspace 不导入 productdoc 包。
type shareCommentInternal struct {
	ID          string
	ShareToken  string
	DocID       string
	WorkspaceID string
	AuthorName  string
	QuoteText   string
	Content     string
	Status      string
	CreatedAt   time.Time
	ResolvedAt  *time.Time
	ResolvedBy  string
}

// AddRequirementShareDocComment 免登录：访客为需求分享中的文档添加文本批注。
// 写入 product_doc_share_comments，share_token 记录需求分享 token，便于同一 token 下聚合查询。
func (s *DBProductSpaceService) AddRequirementShareDocComment(token string, req object.AddRequirementShareDocCommentRequest) (*object.DocShareComment, error) {
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
	c := shareCommentInternal{
		ID:          idutil.GenerateID(),
		ShareToken:  token,
		DocID:       docID,
		WorkspaceID: workspaceID,
		AuthorName:  authorName,
		QuoteText:   quoteText,
		Content:     content,
		Status:      "open",
		CreatedAt:   now,
	}
	_, err = s.db.Exec(
		`INSERT INTO product_doc_share_comments (id, share_token, doc_id, workspace_id, author_name, quote_text, content, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		c.ID, c.ShareToken, c.DocID, c.WorkspaceID, c.AuthorName, c.QuoteText, c.Content, c.Status, c.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert requirement share doc comment failed: %w", err)
	}
	result := toDocShareComment(&c)
	return &result, nil
}

// ListRequirementShareDocComments 免登录：按需求分享 token 列出关联文档的文本批注。
func (s *DBProductSpaceService) ListRequirementShareDocComments(token string) ([]object.DocShareComment, error) {
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

	comments := make([]object.DocShareComment, 0)
	for rows.Next() {
		var c shareCommentInternal
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
		comments = append(comments, toDocShareComment(&c))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate requirement share doc comments failed: %w", err)
	}
	return comments, nil
}

// writeDocSnapshot 查询文档当前最新已发布版本，写入分享快照表。
// 文档不存在或非 published 状态时跳过（不阻断分享创建）。
func (s *DBProductSpaceService) writeDocSnapshot(ctx context.Context, shareToken, docID string) {
	if docID == "" {
		return
	}
	var (
		doc           object.SharedDocInfo
		createdByName sql.NullString
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
		FROM product_docs d
		JOIN product_doc_versions v ON v.doc_id = d.id
		LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
		WHERE d.id = $1 AND d.status = 'published'
		ORDER BY v.version DESC
		LIMIT 1
	`, docID).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
	if err != nil {
		log.Printf("[RequirementShare] writeDocSnapshot skip (doc=%s): %v", docID, err)
		return
	}
	doc.CreatedByName = createdByName.String
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO requirement_share_doc_snapshots
			(share_token, doc_id, doc_title, doc_content, doc_version, published_at, created_by_name, snapshot_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (share_token) DO UPDATE SET
			doc_id = EXCLUDED.doc_id, doc_title = EXCLUDED.doc_title,
			doc_content = EXCLUDED.doc_content, doc_version = EXCLUDED.doc_version,
			published_at = EXCLUDED.published_at, created_by_name = EXCLUDED.created_by_name,
			snapshot_at = NOW()
	`, shareToken, docID, doc.Title, doc.Content, doc.Version, doc.PublishedAt, doc.CreatedByName)
	if err != nil {
		log.Printf("[RequirementShare] writeDocSnapshot insert failed (token=%s): %v", shareToken, err)
	}
}

// ensureDocSnapshot 仅在快照不存在时补写，用于兼容老数据。
func (s *DBProductSpaceService) ensureDocSnapshot(ctx context.Context, shareToken, docID string) {
	var exists bool
	_ = s.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM requirement_share_doc_snapshots WHERE share_token = $1)`,
		shareToken,
	).Scan(&exists)
	if exists {
		return
	}
	s.writeDocSnapshot(ctx, shareToken, docID)
}
