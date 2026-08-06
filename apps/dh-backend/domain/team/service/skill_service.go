package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// ListSkills 返回团队技能列表，支持服务端分页。
// workspaceID 非空时，仅返回该工作区的技能（含全局技能），并以 workspace_skill_installs 中的安装状态覆盖全局默认值。
func (s *DBTeamService) ListSkills(workspaceID string, page, pageSize int) (common.PaginatedList[object.Skill], error) {
	page = common.NormalizePage(page)
	pageSize = common.NormalizePageSize(pageSize, 10, 100)

	var total int
	var rows *sql.Rows
	var err error

	if workspaceID == "" {
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM team_skills`).Scan(&total); err != nil {
			return common.PaginatedList[object.Skill]{}, fmt.Errorf("count skills failed: %w", err)
		}
		rows, err = s.db.Query(`
			SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, status, created_at, updated_at
			FROM team_skills
			ORDER BY created_at DESC
			LIMIT $1 OFFSET $2
		`, pageSize, common.Offset(page, pageSize))
	} else {
		if err := s.db.QueryRow(`
			SELECT COUNT(*) FROM team_skills
			WHERE workspace_id = $1 OR workspace_id IS NULL
		`, workspaceID).Scan(&total); err != nil {
			return common.PaginatedList[object.Skill]{}, fmt.Errorf("count skills failed: %w", err)
		}
		rows, err = s.db.Query(`
			SELECT s.id, s.name, s.description, s.category, s.tags, s.downloads, s.rating,
			       COALESCE(wsi.installed, s.installed) AS installed, s.icon, s.phase, s.status, s.created_at, s.updated_at
			FROM team_skills s
			LEFT JOIN workspace_skill_installs wsi ON wsi.skill_id = s.id AND wsi.workspace_id = $1
			WHERE s.workspace_id = $1 OR s.workspace_id IS NULL
			ORDER BY s.created_at DESC
			LIMIT $2 OFFSET $3
		`, workspaceID, pageSize, common.Offset(page, pageSize))
	}
	if err != nil {
		return common.PaginatedList[object.Skill]{}, fmt.Errorf("list skills failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.Skill, 0)
	skillIDs := make([]string, 0)
	for rows.Next() {
		var sk object.Skill
		var tags sql.NullString
		if err := rows.Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.Status, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return common.PaginatedList[object.Skill]{}, fmt.Errorf("scan skill failed: %w", err)
		}
		sk.Tags = parseTags(tags)
		sk.CategoryIDs = []string{}
		result = append(result, sk)
		skillIDs = append(skillIDs, sk.ID)
	}
	if err := rows.Err(); err != nil {
		return common.PaginatedList[object.Skill]{}, fmt.Errorf("iterate skills failed: %w", err)
	}

	// 批量补充多分类链接（避免逐行 N+1 查询）。
	categoryMap, err := s.listLinkedCategoryIDs(skillCategoryLinkTable, "skill_id", skillIDs)
	if err != nil {
		return common.PaginatedList[object.Skill]{}, err
	}
	for i := range result {
		if ids, ok := categoryMap[result[i].ID]; ok {
			result[i].CategoryIDs = ids
		}
	}

	return common.PaginatedList[object.Skill]{
		List:     result,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// CreateSkill 创建新技能。
// workspaceID 非空时，技能归属到该工作区；为空时创建为全局技能。
func (s *DBTeamService) CreateSkill(req object.CreateSkillRequest, workspaceID string) (object.Skill, error) {
	now := time.Now().UTC()
	skill := object.Skill{
		ID:          idutil.GenerateID(),
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Tags:        parseTagsInput(req.Tags),
		Downloads:   0,
		Rating:      req.Rating,
		Installed:   true,
		Icon:        defaultIcon(req.Icon),
		Phase:       defaultPhase(req.Phase),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if skill.Rating == 0 {
		skill.Rating = 5.0
	}

	var workspaceIDArg interface{}
	if workspaceID != "" {
		workspaceIDArg = workspaceID
	}

	_, err := s.db.Exec(`
		INSERT INTO team_skills (id, name, description, category, tags, downloads, rating, installed, icon, phase, workspace_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, skill.ID, skill.Name, skill.Description, skill.Category, strings.Join(skill.Tags, ","), skill.Downloads, skill.Rating, skill.Installed, skill.Icon, skill.Phase, workspaceIDArg, skill.CreatedAt, skill.UpdatedAt)
	if err != nil {
		return object.Skill{}, fmt.Errorf("insert skill failed: %w", err)
	}
	return skill, nil
}

// UpdateSkill 更新技能状态。
// workspaceID 非空时，安装/卸载状态写入 workspace_skill_installs，避免影响其他工作区；为空时修改全局默认状态。
func (s *DBTeamService) UpdateSkill(id string, req object.UpdateSkillRequest, workspaceID string) (object.Skill, error) {
	skill, err := s.getSkill(id, workspaceID)
	if err != nil {
		return object.Skill{}, err
	}
	if req.Installed != nil {
		skill.Installed = *req.Installed
		if workspaceID != "" {
			_, err = s.db.Exec(`
				INSERT INTO workspace_skill_installs (workspace_id, skill_id, installed, created_at, updated_at)
				VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
				ON CONFLICT (workspace_id, skill_id)
				DO UPDATE SET installed = EXCLUDED.installed, updated_at = CURRENT_TIMESTAMP
			`, workspaceID, id, *req.Installed)
			if err != nil {
				return object.Skill{}, fmt.Errorf("upsert skill install state failed: %w", err)
			}
		} else {
			_, err = s.db.Exec(`
				UPDATE team_skills SET installed = $1, updated_at = $2 WHERE id = $3
			`, skill.Installed, time.Now().UTC(), id)
			if err != nil {
				return object.Skill{}, fmt.Errorf("update skill failed: %w", err)
			}
		}
	}

	return skill, nil
}

// DeleteSkill 删除技能。
// workspaceID 非空时，仅允许删除属于该工作区或全局的技能，防止跨工作区误删。
func (s *DBTeamService) DeleteSkill(id string, workspaceID string) error {
	query := `DELETE FROM team_skills WHERE id = $1`
	args := []any{id}
	if workspaceID != "" {
		query = `DELETE FROM team_skills WHERE id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`
		args = append(args, workspaceID)
	}
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("delete skill failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return common.NotFoundErrorf("skill not found")
	}
	return nil
}

// ReviewSkill 超级管理员审核技能（状态机与 ReviewPrompt 对称）。
// workspaceID 非空时仅审核该工作区可见的技能。
func (s *DBTeamService) ReviewSkill(id string, action string, reviewerID string, workspaceID string) (object.Skill, error) {
	skill, err := s.getSkill(id, workspaceID)
	if err != nil {
		return object.Skill{}, err
	}

	now := time.Now().UTC()
	var status object.PromptStatus
	switch action {
	case "approve":
		status = object.PromptStatusOnShelf
	case "reject":
		status = object.PromptStatusRejected
	case "unshelf":
		if skill.Status != object.PromptStatusOnShelf {
			return object.Skill{}, errors.New("skill is not on shelf")
		}
		status = object.PromptStatusOffShelf
	default:
		return object.Skill{}, errors.New("invalid review action")
	}

	_, err = s.db.Exec(`
		UPDATE team_skills
		SET status = $1, reviewed_by = $2, reviewed_at = $3, updated_at = $4
		WHERE id = $5
	`, status, reviewerID, now, now, id)
	if err != nil {
		return object.Skill{}, fmt.Errorf("review skill failed: %w", err)
	}
	return s.getSkill(id, workspaceID)
}

// UpdateSkillCategories 更新技能的多分类关联（替换语义）。
// workspaceID 用于校验分类是否属于当前工作区或全局分类。
func (s *DBTeamService) UpdateSkillCategories(id string, workspaceID string, categoryIDs []string) (object.Skill, error) {
	if _, err := s.getSkill(id, workspaceID); err != nil {
		return object.Skill{}, err
	}
	if err := s.replaceCategoryLinks(skillCategoryLinkTable, skillCategoryTable, "skill_id", id, categoryIDs, workspaceID); err != nil {
		return object.Skill{}, err
	}
	return s.getSkill(id, workspaceID)
}

func (s *DBTeamService) getSkill(id string, workspaceID string) (object.Skill, error) {
	var sk object.Skill
	var tags sql.NullString
	var err error

	if workspaceID == "" {
		err = s.db.QueryRow(`
			SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, status, created_at, updated_at
			FROM team_skills WHERE id = $1
		`, id).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.Status, &sk.CreatedAt, &sk.UpdatedAt)
	} else {
		err = s.db.QueryRow(`
			SELECT s.id, s.name, s.description, s.category, s.tags, s.downloads, s.rating,
			       COALESCE(wsi.installed, s.installed) AS installed, s.icon, s.phase, s.status, s.created_at, s.updated_at
			FROM team_skills s
			LEFT JOIN workspace_skill_installs wsi ON wsi.skill_id = s.id AND wsi.workspace_id = $2
			WHERE s.id = $1 AND (s.workspace_id = $2 OR s.workspace_id IS NULL)
		`, id, workspaceID).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.Status, &sk.CreatedAt, &sk.UpdatedAt)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return object.Skill{}, common.NotFoundErrorf("skill not found")
	}
	if err != nil {
		return object.Skill{}, fmt.Errorf("get skill failed: %w", err)
	}
	sk.Tags = parseTags(tags)
	sk.CategoryIDs = []string{}
	categoryMap, err := s.listLinkedCategoryIDs(skillCategoryLinkTable, "skill_id", []string{id})
	if err != nil {
		return object.Skill{}, err
	}
	if ids, ok := categoryMap[id]; ok {
		sk.CategoryIDs = ids
	}
	return sk, nil
}
