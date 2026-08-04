package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/google/uuid"
)

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
