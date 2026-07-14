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
	FolderID  string    `json:"folderId,omitempty"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ProductDocFolder 产品文档目录（一级目录 ParentID 为空，最多 6 层；IsDefault 为默认“未分类”目录，不可删除）。
type ProductDocFolder struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	ParentID    string    `json:"parentId,omitempty"`
	Name        string    `json:"name"`
	Pinned      bool      `json:"pinned"`
	IsDefault   bool      `json:"isDefault"`
	SortOrder   int       `json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// CreateFolderRequest 创建目录请求。
type CreateFolderRequest struct {
	WorkspaceID string `json:"workspaceId"`
	ParentID    string `json:"parentId"`
	Name        string `json:"name"`
}

// UpdateFolderRequest 更新目录请求（重命名 / 置顶）。
type UpdateFolderRequest struct {
	Name   *string `json:"name,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
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

// WorkspaceVersionFilter 工作空间维度版本历史的查询条件。
// StartTime/EndTime 针对版本的 created_at；Status 针对文档状态；Keyword 模糊匹配文档标题或版本说明。
type WorkspaceVersionFilter struct {
	StartTime *time.Time
	EndTime   *time.Time
	DocIDs    []string
	Status    string
	CreatedBy string
	Keyword   string
	Page      int
	PageSize  int
}

// WorkspaceVersionItem 工作空间版本列表条目：版本全量字段 + 所属文档的标题与状态 + 操作人姓名。
type WorkspaceVersionItem struct {
	ProductDocVersion
	DocTitle      string `json:"docTitle"`
	DocStatus     string `json:"docStatus"`
	CreatedByName string `json:"createdByName"`
}

// WorkspaceVersionList 工作空间版本列表的分页结果。
type WorkspaceVersionList struct {
	Items    []WorkspaceVersionItem `json:"items"`
	Total    int                    `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
}

// UpdateVersionSummaryRequest 更新版本说明请求。
type UpdateVersionSummaryRequest struct {
	ChangeSummary string `json:"changeSummary"`
}

// CreateProductDocRequest 创建产品文档请求。
type CreateProductDocRequest struct {
	WorkspaceID string    `json:"workspaceId"`
	Title       string    `json:"title"`
	Slug        string    `json:"slug"`
	Content     string    `json:"content"`
	Category    string    `json:"category"`
	FolderID    string    `json:"folderId"`
	CreatedBy   string    `json:"createdBy"`
	Status      DocStatus `json:"status"`
}

// UpdateProductDocRequest 更新产品文档请求。
// FolderID 非 nil 时表示移动文档：空字符串移动到根目录，否则移动到指定目录。
type UpdateProductDocRequest struct {
	Title    *string    `json:"title,omitempty"`
	Content  *string    `json:"content,omitempty"`
	Status   *DocStatus `json:"status,omitempty"`
	Category *string    `json:"category,omitempty"`
	FolderID *string    `json:"folderId,omitempty"`
}

// PublishProductDocRequest 发布文档版本请求。
type PublishProductDocRequest struct {
	ChangeSummary string `json:"changeSummary"`
	CreatedBy     string `json:"createdBy"`
}

// ProductDocShare 文档分享短链对象。
type ProductDocShare struct {
	Token     string    `json:"token"`
	DocID     string    `json:"docId"`
	CreatedAt time.Time `json:"createdAt"`
}

// SharedDocView 免登录分享落地页的文档视图（解析最新已发布版本）。
type SharedDocView struct {
	Title         string    `json:"title"`
	Content       string    `json:"content"`
	Version       int       `json:"version"`
	PublishedAt   time.Time `json:"publishedAt"`
	CreatedByName string    `json:"createdByName"`
}

// ShareComment 分享文档批注：访客在分享页选中文本后提交的批注。
// ResolvedAt/ResolvedBy 在批注被标记解决后填充。
type ShareComment struct {
	ID          string     `json:"id"`
	ShareToken  string     `json:"shareToken"`
	DocID       string     `json:"docId"`
	WorkspaceID string     `json:"workspaceId"`
	AuthorName  string     `json:"authorName"`
	QuoteText   string     `json:"quoteText"`
	Content     string     `json:"content"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy  string     `json:"resolvedBy,omitempty"`
}

// AddShareCommentRequest 访客新增分享批注的请求体（免登录，昵称由访客填写）。
type AddShareCommentRequest struct {
	AuthorName string `json:"authorName"`
	QuoteText  string `json:"quoteText"`
	Content    string `json:"content"`
}
