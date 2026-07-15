// Package object 定义 platformtemplate 模块对外暴露的数据结构。
package object

import "time"

// TemplateCategory 定义平台模板分类常量。
const (
	TemplateCategoryProduct     = "product"
	TemplateCategoryDesign      = "design"
	TemplateCategoryDevelopment = "development"
)

// MaxTemplatesPerCategory 限制每个分类下的模板数量上限。
const MaxTemplatesPerCategory = 20

// PlatformTemplate 表示平台级可复用模板，与 platform_templates 表对应。
type PlatformTemplate struct {
	ID         int64     `json:"id"`
	Category   string    `json:"category"`
	Key        string    `json:"key"`
	Label      string    `json:"label"`
	Content    string    `json:"content"`
	SortOrder  int       `json:"sortOrder"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}
