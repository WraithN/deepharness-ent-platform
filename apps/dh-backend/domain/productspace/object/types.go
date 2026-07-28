// Package object defines domain types and constants for the product-space module.
package object

import "time"

type ProductSpaceItem struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspace_id"`
	UserID         string    `json:"user_id"`
	Type           string    `json:"type"` // doc | prototype
	Title          string    `json:"title"`
	RelativePath   string    `json:"relative_path"`
	CurrentVersion int       `json:"current_version"`
	FileExt        string    `json:"file_ext"`
	MimeType       string    `json:"mime_type"`
	SizeBytes      int64     `json:"size_bytes"`
	Status         string    `json:"status"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type ProductSpaceVersion struct {
	ID            string    `json:"id"`
	DocID         string    `json:"doc_id"`
	Version       int       `json:"version"`
	Title         string    `json:"title"`
	FilePath      string    `json:"file_path"`
	FileExt       string    `json:"file_ext"`
	MimeType      string    `json:"mime_type"`
	SizeBytes     int64     `json:"size_bytes"`
	ChangeSummary string    `json:"change_summary"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
}

// PrototypeComment 是原型页面的批注评论。
// UserName 通过 LEFT JOIN users 解析，用户记录缺失时为空字符串。
// Selector / TargetText / X / Y 记录被标注的元素与页面坐标，用于在画布上回显标记。
type PrototypeComment struct {
	ID          string    `json:"id"`
	ItemID      string    `json:"itemId"`
	WorkspaceID string    `json:"workspaceId"`
	UserID      string    `json:"userId"`
	UserName    string    `json:"userName"`
	Selector    string    `json:"selector"`
	TargetText  string    `json:"targetText"`
	X           float64   `json:"x"`
	Y           float64   `json:"y"`
	Content     string    `json:"content"`
	CreatedAt   time.Time `json:"createdAt"`
}

type ProductSpaceTreeNode struct {
	// ID 仅文件节点有值，为条目 ID（product_docs.id），文件夹节点为空。
	ID       string                 `json:"id,omitempty"`
	Name     string                 `json:"name"`
	Path     string                 `json:"path"`
	Type     string                 `json:"type"` // folder | doc | prototype
	Children []ProductSpaceTreeNode `json:"children,omitempty"`
}

// Requests

type CreateItemRequest struct {
	Type     string `json:"type" validate:"required,oneof=doc prototype"`
	Title    string `json:"title" validate:"required,max=500"`
	Folder   string `json:"folder"`              // 子目录路径，支持多级，如 "a/b"，可为空
	Content  string `json:"content"`             // doc 初始内容
	FileData []byte `json:"file_data,omitempty"` // prototype base64 或 raw bytes
}

type UpdateContentRequest struct {
	Content       string `json:"content"`
	ChangeSummary string `json:"change_summary"`
}

type CreateFolderRequest struct {
	Category string `json:"category" validate:"required,oneof=docs prototypes"`
	Name     string `json:"name" validate:"required,max=500"` // 文件夹相对路径，支持多级，如 "a/b"
}

type AddCommentRequest struct {
	Content    string  `json:"content"`
	Selector   string  `json:"selector"`
	TargetText string  `json:"targetText"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
}

type DeleteFolderRequest struct {
	Category string `json:"category" validate:"required,oneof=docs prototypes"`
	Name     string `json:"name" validate:"required"` // 文件夹相对路径，支持多级，如 "a/b"
}

// ImportPrototypeRequest 将 /proto-make 生成的原型工程目录正式采纳到产品空间。
// Folder 为 prototypes 下的一级产品目录名（如 "campaign-manager"）。
// WorkitemID 可选：若提供，则将导入的原型页面关联到该需求，并生成一次产品设计版本。
type ImportPrototypeRequest struct {
	Folder     string `json:"folder" validate:"required"`
	WorkitemID string `json:"workitemId"`
}

// ImportDocRequest 将用户个人工作目录中的文档文件采纳到产品空间 docs 目录。
// Path 为源文件相对路径（如 "projects/prds/xxx-prd.md"）。
// Folder 可选：指定 docs 下的子目录（如需求标题），为空时直接放到 docs 根目录。
// WorkitemID 可选：若提供，则将文档关联到该需求并生成一次产品设计版本。
type ImportDocRequest struct {
	Path       string `json:"path" validate:"required"`
	Folder     string `json:"folder"`
	WorkitemID string `json:"workitemId"`
}

// CreatePrototypeShareRequest 创建原型产品分享链接的请求体。
// ProductFolder 为 prototypes 下的一级目录名（产品名），分享该产品下全部原型页面。
type CreatePrototypeShareRequest struct {
	ProductFolder string `json:"product_folder"`
}

// PrototypeShare 原型产品分享记录。
type PrototypeShare struct {
	Token         string    `json:"token"`
	WorkspaceID   string    `json:"workspaceId"`
	UserID        string    `json:"userId"`
	ProductFolder string    `json:"productFolder"`
	CreatedAt     time.Time `json:"createdAt"`
}

// SharedPrototypePage 分享页面对外暴露的单个原型页面信息。
type SharedPrototypePage struct {
	ItemID       string `json:"itemId"`
	Title        string `json:"title"`
	RelativePath string `json:"relativePath"`
}

// SharedPrototypeView 免登录分享落地页视图：产品名 + 该产品下全部原型页面列表。
type SharedPrototypeView struct {
	ProductFolder string                  `json:"productFolder"`
	Pages         []SharedPrototypePage   `json:"pages"`
}

// RequirementShare 需求级统一分享记录：一个 token 同时绑定文档与原型产品。
type RequirementShare struct {
	Token         string    `json:"token"`
	WorkspaceID   string    `json:"workspaceId"`
	UserID        string    `json:"userId"`
	Title         string    `json:"title"`
	DocID         string    `json:"docId"`
	ProductFolder string    `json:"productFolder"`
	AllowComments bool      `json:"allowComments"`
	CreatedAt     time.Time `json:"createdAt"`
}

// CreateRequirementShareRequest 创建需求级统一分享链接的请求体。
type CreateRequirementShareRequest struct {
	Title         string `json:"title"`
	DocID         string `json:"docId"`
	ProductFolder string `json:"productFolder"`
	AllowComments bool   `json:"allowComments"`
}

// AddRequirementShareDocCommentRequest 需求分享文档页中访客新增的文本批注。
type AddRequirementShareDocCommentRequest struct {
	AuthorName string `json:"authorName"`
	QuoteText  string `json:"quoteText"`
	Content    string `json:"content"`
}

// SharedDocInfo 需求分享落地页中的文档信息。
type SharedDocInfo struct {
	Title       string `json:"title"`
	Content     string `json:"content"`
	Version     int    `json:"version"`
	PublishedAt string `json:"publishedAt"`
	CreatedByName string `json:"createdByName"`
}

// SharedRequirementView 需求级统一分享落地页视图。
type SharedRequirementView struct {
	Title         string               `json:"title"`
	AllowComments bool                 `json:"allowComments"`
	Doc           *SharedDocInfo       `json:"doc,omitempty"`
	Prototype     *SharedPrototypeView `json:"prototype,omitempty"`
}
