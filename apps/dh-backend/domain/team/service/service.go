package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Skill 表示团队技能，与 team_skills 表对应。
type Skill struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Downloads   int      `json:"downloads"`
	Rating      float64  `json:"rating"`
	Installed   bool     `json:"installed"`
	Icon        string   `json:"icon"`
	Phase       string   `json:"phase"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Prompt 表示团队提示词，与 team_prompts 表对应。
type Prompt struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Content      string    `json:"content"`
	UseCase      string    `json:"useCase"`
	UsageCount   int       `json:"usageCount"`
	AddedToSpace bool      `json:"addedToSpace"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// CreateSkillRequest 创建技能请求。
type CreateSkillRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Category    string  `json:"category"`
	Tags        string  `json:"tags"`
	Icon        string  `json:"icon"`
	Phase       string  `json:"phase"`
	Rating      float64 `json:"rating"`
}

// CreatePromptRequest 创建提示词请求。
type CreatePromptRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	UseCase     string `json:"useCase"`
}

// UpdateSkillRequest 更新技能请求（仅支持切换 installed 状态）。
type UpdateSkillRequest struct {
	Installed *bool `json:"installed"`
}

// UpdatePromptRequest 更新提示词请求（仅支持切换 addedToSpace 状态）。
type UpdatePromptRequest struct {
	AddedToSpace *bool `json:"addedToSpace"`
}

// TeamService 定义团队技能/提示词服务接口。
type TeamService interface {
	ListSkills() ([]Skill, error)
	CreateSkill(req CreateSkillRequest) (Skill, error)
	UpdateSkill(id string, req UpdateSkillRequest) (Skill, error)
	DeleteSkill(id string) error

	ListPrompts() ([]Prompt, error)
	CreatePrompt(req CreatePromptRequest) (Prompt, error)
	UpdatePrompt(id string, req UpdatePromptRequest) (Prompt, error)
	DeletePrompt(id string) error
}

// DBTeamService 是基于 MySQL 的 TeamService 实现。
type DBTeamService struct {
	db *sql.DB
}

// NewDBTeamService 创建 MySQL 实现的团队服务。
func NewDBTeamService(db *sql.DB) *DBTeamService {
	return &DBTeamService{db: db}
}

// ListSkills 返回全部团队技能。
func (s *DBTeamService) ListSkills() ([]Skill, error) {
	rows, err := s.db.Query(`
		SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, created_at, updated_at
		FROM team_skills
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list skills failed: %w", err)
	}
	defer rows.Close()

	result := make([]Skill, 0)
	for rows.Next() {
		var sk Skill
		var tags sql.NullString
		err := rows.Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.CreatedAt, &sk.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan skill failed: %w", err)
		}
		sk.Tags = parseTags(tags)
		result = append(result, sk)
	}
	return result, rows.Err()
}

// CreateSkill 创建新技能。
func (s *DBTeamService) CreateSkill(req CreateSkillRequest) (Skill, error) {
	now := time.Now().UTC()
	skill := Skill{
		ID:          uuid.New().String(),
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

	_, err := s.db.Exec(`
		INSERT INTO team_skills (id, name, description, category, tags, downloads, rating, installed, icon, phase, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, skill.ID, skill.Name, skill.Description, skill.Category, strings.Join(skill.Tags, ","), skill.Downloads, skill.Rating, skill.Installed, skill.Icon, skill.Phase, skill.CreatedAt, skill.UpdatedAt)
	if err != nil {
		return Skill{}, fmt.Errorf("insert skill failed: %w", err)
	}
	return skill, nil
}

// UpdateSkill 更新技能状态。
func (s *DBTeamService) UpdateSkill(id string, req UpdateSkillRequest) (Skill, error) {
	skill, err := s.getSkill(id)
	if err != nil {
		return Skill{}, err
	}
	if req.Installed != nil {
		skill.Installed = *req.Installed
	}

	_, err = s.db.Exec(`
		UPDATE team_skills SET installed = $1, updated_at = $2 WHERE id = $3
	`, skill.Installed, time.Now().UTC(), id)
	if err != nil {
		return Skill{}, fmt.Errorf("update skill failed: %w", err)
	}
	return skill, nil
}

// DeleteSkill 删除技能。
func (s *DBTeamService) DeleteSkill(id string) error {
	res, err := s.db.Exec(`DELETE FROM team_skills WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete skill failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("skill not found")
	}
	return nil
}

func (s *DBTeamService) getSkill(id string) (Skill, error) {
	var sk Skill
	var tags sql.NullString
	err := s.db.QueryRow(`
		SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, created_at, updated_at
		FROM team_skills WHERE id = $1
	`, id).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.CreatedAt, &sk.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Skill{}, errors.New("skill not found")
	}
	if err != nil {
		return Skill{}, fmt.Errorf("get skill failed: %w", err)
	}
	sk.Tags = parseTags(tags)
	return sk, nil
}

// ListPrompts 返回全部团队提示词。
func (s *DBTeamService) ListPrompts() ([]Prompt, error) {
	rows, err := s.db.Query(`
		SELECT id, name, description, content, use_case, usage_count, added_to_space, created_at, updated_at
		FROM team_prompts
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list prompts failed: %w", err)
	}
	defer rows.Close()

	result := make([]Prompt, 0)
	for rows.Next() {
		var p Prompt
		err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan prompt failed: %w", err)
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

// CreatePrompt 创建新提示词。
func (s *DBTeamService) CreatePrompt(req CreatePromptRequest) (Prompt, error) {
	now := time.Now().UTC()
	prompt := Prompt{
		ID:           uuid.New().String(),
		Name:         req.Name,
		Description:  req.Description,
		Content:      req.Content,
		UseCase:      req.UseCase,
		UsageCount:   0,
		AddedToSpace: true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	_, err := s.db.Exec(`
		INSERT INTO team_prompts (id, name, description, content, use_case, usage_count, added_to_space, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, prompt.ID, prompt.Name, prompt.Description, prompt.Content, prompt.UseCase, prompt.UsageCount, prompt.AddedToSpace, prompt.CreatedAt, prompt.UpdatedAt)
	if err != nil {
		return Prompt{}, fmt.Errorf("insert prompt failed: %w", err)
	}
	return prompt, nil
}

// UpdatePrompt 更新提示词状态。
func (s *DBTeamService) UpdatePrompt(id string, req UpdatePromptRequest) (Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return Prompt{}, err
	}
	if req.AddedToSpace != nil {
		prompt.AddedToSpace = *req.AddedToSpace
	}

	_, err = s.db.Exec(`
		UPDATE team_prompts SET added_to_space = $1, updated_at = $2 WHERE id = $3
	`, prompt.AddedToSpace, time.Now().UTC(), id)
	if err != nil {
		return Prompt{}, fmt.Errorf("update prompt failed: %w", err)
	}
	return prompt, nil
}

// DeletePrompt 删除提示词。
func (s *DBTeamService) DeletePrompt(id string) error {
	res, err := s.db.Exec(`DELETE FROM team_prompts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete prompt failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("prompt not found")
	}
	return nil
}

func (s *DBTeamService) getPrompt(id string) (Prompt, error) {
	var p Prompt
	err := s.db.QueryRow(`
		SELECT id, name, description, content, use_case, usage_count, added_to_space, created_at, updated_at
		FROM team_prompts WHERE id = $1
	`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Prompt{}, errors.New("prompt not found")
	}
	if err != nil {
		return Prompt{}, fmt.Errorf("get prompt failed: %w", err)
	}
	return p, nil
}

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
