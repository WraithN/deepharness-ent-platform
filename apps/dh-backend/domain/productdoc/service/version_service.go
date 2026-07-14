package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// 版本管理相关常量（规则7：禁止魔法值）。
const (
	defaultVersionPageSize  = 20
	maxVersionPageSize      = 100
	maxVersionQuerySpanDays = 90
	maxVersionSummaryLength = 500
	minVersionRetainCount   = 1
	hoursPerDay             = 24

	// changeSummaryRestoreFormat 回滚生成的新版本说明模板，N 为目标版本号。
	changeSummaryRestoreFormat = "恢复至 v%d"

	// 审计动作类型（audit_events.action）。
	auditActionVersionRestore       = "product_doc_version_restore"
	auditActionVersionDelete        = "product_doc_version_delete"
	auditActionVersionUpdateSummary = "product_doc_version_update_summary"
)

// ListWorkspaceVersions 按工作空间维度分页查询文档版本历史。
// 通过 JOIN product_docs 支持按文档状态过滤，并附带文档标题/状态。
// 时间跨度超过 maxVersionQuerySpanDays 天时拒绝查询，避免大范围扫表。
func (s *DBProductDocService) ListWorkspaceVersions(workspaceID string, filter object.WorkspaceVersionFilter) (*object.WorkspaceVersionList, error) {
	if filter.StartTime != nil && filter.EndTime != nil {
		span := filter.EndTime.Sub(*filter.StartTime)
		if span > time.Duration(maxVersionQuerySpanDays)*hoursPerDay*time.Hour {
			return nil, fmt.Errorf("查询时间跨度不能超过 %d 天", maxVersionQuerySpanDays)
		}
	}
	if filter.Page <= 0 {
		filter.Page = 1
	}
	if filter.PageSize <= 0 {
		filter.PageSize = defaultVersionPageSize
	}
	if filter.PageSize > maxVersionPageSize {
		filter.PageSize = maxVersionPageSize
	}

	// 动态拼接 WHERE 条件：$1 固定为 workspace_id，其余条件按需追加
	conditions := []string{"d.workspace_id = $1"}
	args := []any{workspaceID}
	argIdx := 2
	if filter.StartTime != nil {
		conditions = append(conditions, fmt.Sprintf("v.created_at >= $%d", argIdx))
		args = append(args, *filter.StartTime)
		argIdx++
	}
	if filter.EndTime != nil {
		conditions = append(conditions, fmt.Sprintf("v.created_at <= $%d", argIdx))
		args = append(args, *filter.EndTime)
		argIdx++
	}
	if len(filter.DocIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf("v.doc_id = ANY($%d)", argIdx))
		args = append(args, pq.Array(filter.DocIDs))
		argIdx++
	}
	if filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("d.status = $%d", argIdx))
		args = append(args, filter.Status)
		argIdx++
	}
	if filter.CreatedBy != "" {
		conditions = append(conditions, fmt.Sprintf("v.created_by = $%d", argIdx))
		args = append(args, filter.CreatedBy)
		argIdx++
	}
	if filter.Keyword != "" {
		// 转义 LIKE 通配符，避免用户输入的 % / _ 被当作模式字符
		pattern := "%" + escapeLikePattern(filter.Keyword) + "%"
		conditions = append(conditions, fmt.Sprintf("(d.title ILIKE $%d ESCAPE '\\' OR v.change_summary ILIKE $%d ESCAPE '\\')", argIdx, argIdx))
		args = append(args, pattern)
		argIdx++
	}

	base := "FROM product_doc_versions v JOIN product_docs d ON d.id = v.doc_id " +
		"LEFT JOIN users u ON u.id = v.created_by WHERE " + strings.Join(conditions, " AND ")

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("统计版本数量失败: %w", err)
	}

	dataQuery := `SELECT v.id, v.doc_id, v.version, v.title, v.content, v.change_summary, v.created_by, v.created_at, d.title, d.status, u.name ` +
		base + fmt.Sprintf(" ORDER BY v.created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	dataArgs := append(args, filter.PageSize, (filter.Page-1)*filter.PageSize)

	rows, err := s.db.Query(dataQuery, dataArgs...)
	if err != nil {
		return nil, fmt.Errorf("查询工作空间版本列表失败: %w", err)
	}
	defer rows.Close()

	items := make([]object.WorkspaceVersionItem, 0)
	for rows.Next() {
		var item object.WorkspaceVersionItem
		var title, content, changeSummary, createdBy, createdByName sql.NullString
		err := rows.Scan(
			&item.ID, &item.DocID, &item.Version,
			&title, &content, &changeSummary, &createdBy,
			&item.CreatedAt, &item.DocTitle, &item.DocStatus, &createdByName,
		)
		if err != nil {
			return nil, fmt.Errorf("扫描版本记录失败: %w", err)
		}
		if title.Valid {
			item.Title = title.String
		}
		if content.Valid {
			item.Content = content.String
		}
		if changeSummary.Valid {
			item.ChangeSummary = changeSummary.String
		}
		if createdBy.Valid {
			item.CreatedBy = createdBy.String
		}
		if createdByName.Valid {
			item.CreatedByName = createdByName.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历版本记录失败: %w", err)
	}

	return &object.WorkspaceVersionList{
		Items:    items,
		Total:    total,
		Page:     filter.Page,
		PageSize: filter.PageSize,
	}, nil
}

// RestoreVersion 将文档回滚到指定历史版本。
// 状态转换流程（事务内执行，任一步失败整体回滚）：
//  1. 校验文档存在且属于该工作空间；
//  2. 读取目标版本快照（不存在则报错）；
//  3. 将目标版本的 title/content 写回 product_docs，当前文档内容变为目标版本内容；
//  4. 追加一条新版本记录（version = 当前最大版本号 + 1，change_summary = "恢复至 vN"）——
//     回滚以"生成新版本"的方式实现，不覆盖任何历史版本，保证版本链完整可追溯；
//  5. 提交事务后写入审计日志并返回新版本。
func (s *DBProductDocService) RestoreVersion(workspaceID, docID string, version int, userID string) (*object.ProductDocVersion, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback() // 提交成功后 Rollback 为 no-op

	var exists bool
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM product_docs WHERE id = $1 AND workspace_id = $2)", docID, workspaceID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("校验文档归属失败: %w", err)
	}
	if !exists {
		return nil, errors.New("文档不存在或不属于该工作空间")
	}

	var title, content sql.NullString
	err = tx.QueryRow("SELECT title, content FROM product_doc_versions WHERE doc_id = $1 AND version = $2", docID, version).Scan(&title, &content)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("目标版本不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("读取目标版本失败: %w", err)
	}

	now := time.Now().UTC()
	if _, err := tx.Exec("UPDATE product_docs SET title = $1, content = $2, updated_at = $3 WHERE id = $4",
		title.String, content.String, now, docID); err != nil {
		return nil, fmt.Errorf("恢复文档内容失败: %w", err)
	}

	var nextVersion int
	if err := tx.QueryRow("SELECT COALESCE(MAX(version), 0) + 1 FROM product_doc_versions WHERE doc_id = $1", docID).Scan(&nextVersion); err != nil {
		return nil, fmt.Errorf("计算新版本号失败: %w", err)
	}

	newVersion := &object.ProductDocVersion{}
	var vTitle, vContent, vSummary, vCreatedBy sql.NullString
	err = tx.QueryRow(`
		INSERT INTO product_doc_versions (id, doc_id, version, title, content, change_summary, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, doc_id, version, title, content, change_summary, created_by, created_at
	`, uuid.New().String(), docID, nextVersion, title.String, content.String,
		fmt.Sprintf(changeSummaryRestoreFormat, version), userID, now).Scan(
		&newVersion.ID, &newVersion.DocID, &newVersion.Version,
		&vTitle, &vContent, &vSummary, &vCreatedBy, &newVersion.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("创建恢复版本失败: %w", err)
	}
	if vTitle.Valid {
		newVersion.Title = vTitle.String
	}
	if vContent.Valid {
		newVersion.Content = vContent.String
	}
	if vSummary.Valid {
		newVersion.ChangeSummary = vSummary.String
	}
	if vCreatedBy.Valid {
		newVersion.CreatedBy = vCreatedBy.String
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务失败: %w", err)
	}

	s.recordVersionAudit(auditActionVersionRestore, workspaceID, docID, nextVersion, userID)
	return newVersion, nil
}

// DeleteVersion 删除指定文档的某个历史版本。
// 为保证文档至少有一条可追溯的版本记录，当文档仅剩一个版本时拒绝删除。
func (s *DBProductDocService) DeleteVersion(workspaceID, docID string, version int, userID string) error {
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*)
		FROM product_doc_versions v JOIN product_docs d ON d.id = v.doc_id
		WHERE v.doc_id = $1 AND d.workspace_id = $2
	`, docID, workspaceID).Scan(&count)
	if err != nil {
		return fmt.Errorf("统计版本数量失败: %w", err)
	}
	if count == 0 {
		return errors.New("文档不存在或不属于该工作空间")
	}
	if count <= minVersionRetainCount {
		return errors.New("至少保留一个版本")
	}

	res, err := s.db.Exec(`
		DELETE FROM product_doc_versions v USING product_docs d
		WHERE d.id = v.doc_id AND v.doc_id = $1 AND v.version = $2 AND d.workspace_id = $3
	`, docID, version, workspaceID)
	if err != nil {
		return fmt.Errorf("删除版本失败: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("目标版本不存在")
	}

	s.recordVersionAudit(auditActionVersionDelete, workspaceID, docID, version, userID)
	return nil
}

// UpdateVersionSummary 更新指定版本的变更说明，长度限制 maxVersionSummaryLength 字。
func (s *DBProductDocService) UpdateVersionSummary(workspaceID, docID string, version int, summary string, userID string) error {
	if len([]rune(summary)) > maxVersionSummaryLength {
		return fmt.Errorf("版本说明不能超过 %d 字", maxVersionSummaryLength)
	}

	res, err := s.db.Exec(`
		UPDATE product_doc_versions v SET change_summary = $1
		FROM product_docs d
		WHERE d.id = v.doc_id AND v.doc_id = $2 AND v.version = $3 AND d.workspace_id = $4
	`, summary, docID, version, workspaceID)
	if err != nil {
		return fmt.Errorf("更新版本说明失败: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("目标版本不存在或文档不属于该工作空间")
	}

	s.recordVersionAudit(auditActionVersionUpdateSummary, workspaceID, docID, version, userID)
	return nil
}

// recordVersionAudit 记录版本相关写操作的审计日志（规则6：三个写操作复用）。
// 审计写入失败只记录日志、不返回错误，避免审计故障阻断已完成的业务操作。
func (s *DBProductDocService) recordVersionAudit(action, workspaceID, docID string, version int, userID string) {
	details, err := json.Marshal(map[string]any{
		"version":     version,
		"userId":      userID,
		"workspaceId": workspaceID,
	})
	if err != nil {
		log.Printf("[ProductDoc] marshal audit details failed: %v", err)
		return
	}
	_, err = s.db.Exec(`
		INSERT INTO audit_events (id, tenant_id, user_id, action, resource, details, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, uuid.New().String(), workspaceID, userID, action, docID, string(details), time.Now().UTC())
	if err != nil {
		log.Printf("[ProductDoc] record audit failed: %v", err)
	}
}

// escapeLikePattern 转义 LIKE/ILIKE 模式中的通配符，防止用户输入被解释为模式字符。
func escapeLikePattern(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
