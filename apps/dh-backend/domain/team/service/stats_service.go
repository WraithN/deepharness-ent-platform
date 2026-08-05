package service

import (
	"database/sql"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/object"
)

// defaultTopStatsLimit 是技能/提示词大盘 Top N 列表的默认条数。
const defaultTopStatsLimit = 10

// GetSkillStats 返回技能大盘统计数据。
// workspaceID 非空时，统计数据按工作区隔离（安装状态以 workspace_skill_installs 为准）。
func (s *DBTeamService) GetSkillStats(workspaceID string) (object.SkillStats, error) {
	stats := object.SkillStats{
		CategoryDistribution: make([]object.CategoryDistribution, 0),
		TopSkills:            make([]object.TopSkill, 0),
	}

	if workspaceID == "" {
		if err := s.db.QueryRow(`SELECT COUNT(*), COUNT(*) FILTER (WHERE installed = TRUE) FROM team_skills`).Scan(&stats.Total, &stats.InstalledCount); err != nil {
			return object.SkillStats{}, fmt.Errorf("count skill stats failed: %w", err)
		}
	} else {
		if err := s.db.QueryRow(`
			SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(wsi.installed, s.installed) = TRUE)
			FROM team_skills s
			LEFT JOIN workspace_skill_installs wsi ON wsi.skill_id = s.id AND wsi.workspace_id = $1
			WHERE s.workspace_id = $1 OR s.workspace_id IS NULL
		`, workspaceID).Scan(&stats.Total, &stats.InstalledCount); err != nil {
			return object.SkillStats{}, fmt.Errorf("count skill stats failed: %w", err)
		}
	}

	var rows *sql.Rows
	var err error
	if workspaceID == "" {
		rows, err = s.db.Query(`
			SELECT category, COUNT(*) AS count
			FROM team_skills
			GROUP BY category
			ORDER BY count DESC
		`)
	} else {
		rows, err = s.db.Query(`
			SELECT category, COUNT(*) AS count
			FROM team_skills
			WHERE workspace_id = $1 OR workspace_id IS NULL
			GROUP BY category
			ORDER BY count DESC
		`, workspaceID)
	}
	if err != nil {
		return object.SkillStats{}, fmt.Errorf("list skill category distribution failed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d object.CategoryDistribution
		if err := rows.Scan(&d.Category, &d.Count); err != nil {
			return object.SkillStats{}, fmt.Errorf("scan skill category distribution failed: %w", err)
		}
		stats.CategoryDistribution = append(stats.CategoryDistribution, d)
	}
	if err := rows.Err(); err != nil {
		return object.SkillStats{}, fmt.Errorf("iterate skill category distribution failed: %w", err)
	}

	var topRows *sql.Rows
	if workspaceID == "" {
		topRows, err = s.db.Query(fmt.Sprintf(`
			SELECT id, name, category, downloads, rating
			FROM team_skills
			ORDER BY downloads DESC
			LIMIT %d
		`, defaultTopStatsLimit))
	} else {
		topRows, err = s.db.Query(fmt.Sprintf(`
			SELECT id, name, category, downloads, rating
			FROM team_skills
			WHERE workspace_id = $1 OR workspace_id IS NULL
			ORDER BY downloads DESC
			LIMIT %d
		`, defaultTopStatsLimit), workspaceID)
	}
	if err != nil {
		return object.SkillStats{}, fmt.Errorf("list top skills failed: %w", err)
	}
	defer topRows.Close()
	for topRows.Next() {
		var t object.TopSkill
		if err := topRows.Scan(&t.ID, &t.Name, &t.Category, &t.Downloads, &t.Rating); err != nil {
			return object.SkillStats{}, fmt.Errorf("scan top skill failed: %w", err)
		}
		stats.TopSkills = append(stats.TopSkills, t)
	}
	if err := topRows.Err(); err != nil {
		return object.SkillStats{}, fmt.Errorf("iterate top skills failed: %w", err)
	}

	return stats, nil
}

// GetPromptStats 返回提示词大盘统计数据。
func (s *DBTeamService) GetPromptStats() (object.PromptStats, error) {
	stats := object.PromptStats{
		CategoryDistribution: make([]object.CategoryDistribution, 0),
		StatusDistribution:   make([]object.StatusDistribution, 0),
		TopPrompts:           make([]object.TopPrompt, 0),
	}

	if err := s.db.QueryRow(`
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status = $1)
		FROM team_prompts
	`, object.PromptStatusOnShelf).Scan(&stats.Total, &stats.OnShelfCount); err != nil {
		return object.PromptStats{}, fmt.Errorf("count prompt stats failed: %w", err)
	}

	catRows, err := s.db.Query(`
		SELECT use_case, COUNT(*) AS count
		FROM team_prompts
		GROUP BY use_case
		ORDER BY count DESC
	`)
	if err != nil {
		return object.PromptStats{}, fmt.Errorf("list prompt category distribution failed: %w", err)
	}
	defer catRows.Close()
	for catRows.Next() {
		var d object.CategoryDistribution
		if err := catRows.Scan(&d.Category, &d.Count); err != nil {
			return object.PromptStats{}, fmt.Errorf("scan prompt category distribution failed: %w", err)
		}
		stats.CategoryDistribution = append(stats.CategoryDistribution, d)
	}
	if err := catRows.Err(); err != nil {
		return object.PromptStats{}, fmt.Errorf("iterate prompt category distribution failed: %w", err)
	}

	statusRows, err := s.db.Query(`
		SELECT status, COUNT(*) AS count
		FROM team_prompts
		GROUP BY status
		ORDER BY count DESC
	`)
	if err != nil {
		return object.PromptStats{}, fmt.Errorf("list prompt status distribution failed: %w", err)
	}
	defer statusRows.Close()
	for statusRows.Next() {
		var d object.StatusDistribution
		if err := statusRows.Scan(&d.Status, &d.Count); err != nil {
			return object.PromptStats{}, fmt.Errorf("scan prompt status distribution failed: %w", err)
		}
		stats.StatusDistribution = append(stats.StatusDistribution, d)
	}
	if err := statusRows.Err(); err != nil {
		return object.PromptStats{}, fmt.Errorf("iterate prompt status distribution failed: %w", err)
	}

	topRows, err := s.db.Query(fmt.Sprintf(`
		SELECT id, name, use_case, usage_count
		FROM team_prompts
		ORDER BY usage_count DESC
		LIMIT %d
	`, defaultTopStatsLimit))
	if err != nil {
		return object.PromptStats{}, fmt.Errorf("list top prompts failed: %w", err)
	}
	defer topRows.Close()
	for topRows.Next() {
		var t object.TopPrompt
		if err := topRows.Scan(&t.ID, &t.Name, &t.UseCase, &t.UsageCount); err != nil {
			return object.PromptStats{}, fmt.Errorf("scan top prompt failed: %w", err)
		}
		stats.TopPrompts = append(stats.TopPrompts, t)
	}
	if err := topRows.Err(); err != nil {
		return object.PromptStats{}, fmt.Errorf("iterate top prompts failed: %w", err)
	}

	return stats, nil
}
