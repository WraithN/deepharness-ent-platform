package object

import "time"

// DocStatus 产品文档状态。
type DocStatus string

const (
	DocStatusDraft     DocStatus = "draft"
	DocStatusPublished DocStatus = "published"
	DocStatusArchived  DocStatus = "archived"
)

// ProductDoc 产品文档领域对象。
type ProductDoc struct {
	ID        string    `json:"id"`
	WorkspaceID string  `json:"workspaceId"`
	Title     string    `json:"title"`
	Slug      string    `json:"slug"`
	Content   string    `json:"content"`
	Status    DocStatus `json:"status"`
	Category  string    `json:"category"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ProductDocVersion 产品文档版本历史对象。
type ProductDocVersion struct {
	ID            string    `json:"id"`
	DocID         string    `json:"docId"`
	Version       int       `json:"version"`
	Title         string    `json:"title"`
	Content       string    `json:"content"`
	ChangeSummary string    `json:"changeSummary"`
	CreatedBy     string    `json:"createdBy"`
	CreatedAt     time.Time `json:"createdAt"`
}

// CreateProductDocRequest 创建产品文档请求。
type CreateProductDocRequest struct {
	WorkspaceID string    `json:"workspaceId"`
	Title       string    `json:"title"`
	Slug        string    `json:"slug"`
	Content     string    `json:"content"`
	Category    string    `json:"category"`
	CreatedBy   string    `json:"createdBy"`
	Status      DocStatus `json:"status"`
}

// UpdateProductDocRequest 更新产品文档请求。
type UpdateProductDocRequest struct {
	Title    *string    `json:"title,omitempty"`
	Content  *string    `json:"content,omitempty"`
	Status   *DocStatus `json:"status,omitempty"`
	Category *string    `json:"category,omitempty"`
}

// PublishProductDocRequest 发布文档版本请求。
type PublishProductDocRequest struct {
	ChangeSummary string `json:"changeSummary"`
	CreatedBy     string `json:"createdBy"`
}
