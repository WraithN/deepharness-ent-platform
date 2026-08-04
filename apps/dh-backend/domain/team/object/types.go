package object

import (
	"time"
)

// Skill 表示团队技能，与 team_skills 表对应。
type Skill struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Category    string       `json:"category"`
	// CategoryIDs 多分类链接（team_skill_category_links），为空时前端回退展示 Category 单分类。
	CategoryIDs []string     `json:"categoryIds"`
	Tags        []string     `json:"tags"`
	Downloads   int          `json:"downloads"`
	Rating      float64      `json:"rating"`
	Installed   bool         `json:"installed"`
	Icon        string       `json:"icon"`
	Phase       string       `json:"phase"`
	Status      PromptStatus `json:"status"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
}

// PromptStatus 表示提示词在市场中的生命周期状态。
type PromptStatus string

const (
	PromptStatusPendingReview PromptStatus = "pending_review"
	PromptStatusOnShelf       PromptStatus = "on_shelf"
	PromptStatusOffShelf      PromptStatus = "off_shelf"
	PromptStatusRejected      PromptStatus = "rejected"
)

// Prompt 表示团队提示词，与 team_prompts 表对应。
type Prompt struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Content      string       `json:"content"`
	UseCase      string       `json:"useCase"`
	// CategoryIDs 多分类链接（team_prompt_category_links），为空时前端回退展示 UseCase。
	CategoryIDs  []string     `json:"categoryIds"`
	UsageCount   int          `json:"usageCount"`
	AddedToSpace bool         `json:"addedToSpace"`
	Status       PromptStatus `json:"status"`
	CreatedBy    string       `json:"createdBy,omitempty"`
	// CreatedByName 创建人显示名（LEFT JOIN users 容错创建人已删除，为空字符串）。
	CreatedByName string     `json:"createdByName,omitempty"`
	ReviewedBy    string     `json:"reviewedBy,omitempty"`
	ReviewedAt    *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
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

// UpdatePromptRequest 更新提示词请求。
type UpdatePromptRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Content     *string `json:"content,omitempty"`
	UseCase     *string `json:"useCase,omitempty"`
}

// ReviewPromptRequest 审核提示词请求。
type ReviewPromptRequest struct {
	Action string `json:"action"` // approve | reject | unshelf
}

// UpdateCategoriesRequest 更新技能/提示词的多分类关联。
type UpdateCategoriesRequest struct {
	CategoryIDs []string `json:"categoryIds"`
}

// SkillCategory 表示技能分类。
type SkillCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Builtin   bool      `json:"builtin"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// PromptCategory 表示提示词分类。
type PromptCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Builtin   bool      `json:"builtin"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateSkillCategoryRequest 创建技能分类请求。
type CreateSkillCategoryRequest struct {
	Name string `json:"name"`
}

// CreatePromptCategoryRequest 创建提示词分类请求。
type CreatePromptCategoryRequest struct {
	Name string `json:"name"`
}

// CategoryDistribution 表示单个分类的分布数据。
type CategoryDistribution struct {
	Category string `json:"category"`
	Count    int    `json:"count"`
}

// StatusDistribution 表示状态分布数据。
type StatusDistribution struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// TopSkill 表示下载量最高的技能。
type TopSkill struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Category  string  `json:"category"`
	Downloads int     `json:"downloads"`
	Rating    float64 `json:"rating"`
}

// TopPrompt 表示使用次数最高的提示词。
type TopPrompt struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	UseCase    string `json:"useCase"`
	UsageCount int    `json:"usageCount"`
}

// SkillStats 表示技能大盘数据。
type SkillStats struct {
	Total                int                    `json:"total"`
	InstalledCount       int                    `json:"installedCount"`
	CategoryDistribution []CategoryDistribution `json:"categoryDistribution"`
	TopSkills            []TopSkill             `json:"topSkills"`
}

// PromptStats 表示提示词大盘数据。
type PromptStats struct {
	Total                int                    `json:"total"`
	OnShelfCount         int                    `json:"onShelfCount"`
	CategoryDistribution []CategoryDistribution `json:"categoryDistribution"`
	StatusDistribution   []StatusDistribution   `json:"statusDistribution"`
	TopPrompts           []TopPrompt            `json:"topPrompts"`
}
