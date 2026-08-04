package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func parseTags(ns sql.NullString) []string {
	if !ns.Valid || strings.TrimSpace(ns.String) == "" {
		return []string{}
	}
	parts := strings.Split(ns.String, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func parseTagsInput(s string) []string {
	if strings.TrimSpace(s) == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func defaultIcon(icon string) string {
	if strings.TrimSpace(icon) == "" {
		return "Puzzle"
	}
	return icon
}

func defaultPhase(phase string) string {
	if strings.TrimSpace(phase) == "" {
		return "代码开发"
	}
	return phase
}

// listLinkedCategoryIDs 按链接表批量查询实体的分类 ID 并按实体 ID 分组。
// 技能链接表（skill_id）与提示词链接表（prompt_id）结构一致，通过表名/列名参数化复用（规则6）。
func (s *DBTeamService) listLinkedCategoryIDs(linkTable, idColumn string, ids []string) (map[string][]string, error) {
	result := make(map[string][]string)
	if len(ids) == 0 {
		return result, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT %s, category_id FROM %s WHERE %s IN (%s)
	`, idColumn, linkTable, idColumn, strings.Join(placeholders, ", "))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list category links failed: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var entityID, categoryID string
		if err := rows.Scan(&entityID, &categoryID); err != nil {
			return nil, fmt.Errorf("scan category link failed: %w", err)
		}
		result[entityID] = append(result[entityID], categoryID)
	}
	return result, rows.Err()
}

// replaceCategoryLinks 以事务替换实体的分类链接：先校验分类 ID 均存在于分类表，再 delete + insert。
// workspaceID 非空时，仅允许使用属于该工作区或全局的分类（用于技能分类隔离）。
func (s *DBTeamService) replaceCategoryLinks(linkTable, categoryTable, idColumn, id string, categoryIDs []string, workspaceID string) error {
	// 去重并过滤空 ID，避免主键冲突与脏数据。
	deduped := make([]string, 0, len(categoryIDs))
	seen := make(map[string]bool, len(categoryIDs))
	for _, cid := range categoryIDs {
		if cid == "" || seen[cid] {
			continue
		}
		seen[cid] = true
		deduped = append(deduped, cid)
	}

	if len(deduped) > 0 {
		placeholders := make([]string, len(deduped))
		args := make([]any, len(deduped))
		for i, cid := range deduped {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
			args[i] = cid
		}
		var query string
		if workspaceID != "" {
			workspacePlaceholder := fmt.Sprintf("$%d", len(deduped)+1)
			query = fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id IN (%s) AND (workspace_id = %s OR workspace_id IS NULL)`, categoryTable, strings.Join(placeholders, ", "), workspacePlaceholder)
			args = append(args, workspaceID)
		} else {
			query = fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id IN (%s)`, categoryTable, strings.Join(placeholders, ", "))
		}
		var validCount int
		if err := s.db.QueryRow(query, args...).Scan(&validCount); err != nil {
			return fmt.Errorf("validate categories failed: %w", err)
		}
		if validCount != len(deduped) {
			return errors.New("some categories do not exist")
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	deleteQuery := fmt.Sprintf(`DELETE FROM %s WHERE %s = $1`, linkTable, idColumn)
	if _, err := tx.Exec(deleteQuery, id); err != nil {
		return fmt.Errorf("delete old category links failed: %w", err)
	}

	insertQuery := fmt.Sprintf(`INSERT INTO %s (%s, category_id) VALUES ($1, $2)`, linkTable, idColumn)
	for _, cid := range deduped {
		if _, err := tx.Exec(insertQuery, id, cid); err != nil {
			return fmt.Errorf("insert category link failed: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit failed: %w", err)
	}
	return nil
}
