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

type ProductSpaceTreeNode struct {
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

type DeleteFolderRequest struct {
	Category string `json:"category" validate:"required,oneof=docs prototypes"`
	Name     string `json:"name" validate:"required"` // 文件夹相对路径，支持多级，如 "a/b"
}
