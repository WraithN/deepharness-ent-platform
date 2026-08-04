package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
)

// ProductDocFilter 定义产品文档列表的查询条件。
type ProductDocFilter struct {
	WorkspaceID string
	Status      object.DocStatus
	Category    string
}

type ProductDocCRUDService interface {
	ListDocs(filter ProductDocFilter) ([]object.ProductDoc, error)
	GetDoc(id string) (object.ProductDoc, error)
	CreateDoc(req object.CreateProductDocRequest) (object.ProductDoc, error)
	UpdateDoc(id string, req object.UpdateProductDocRequest) (object.ProductDoc, error)
	DeleteDoc(id string) error
}

type ProductDocVersionService interface {
	ListVersions(docID string) ([]object.ProductDocVersion, error)
	PublishVersion(docID string, req object.PublishProductDocRequest) (object.ProductDocVersion, error)
	ListWorkspaceVersions(workspaceID string, filter object.WorkspaceVersionFilter) (*object.WorkspaceVersionList, error)
	RestoreVersion(workspaceID, docID string, version int, userID string) (*object.ProductDocVersion, error)
	DeleteVersion(workspaceID, docID string, version int, userID string) error
	UpdateVersionSummary(workspaceID, docID string, version int, summary string, userID string) error
}

type ProductDocFolderService interface {
	ListFolders(workspaceID string) ([]object.ProductDocFolder, error)
	CreateFolder(req object.CreateFolderRequest) (object.ProductDocFolder, error)
	UpdateFolder(id string, req object.UpdateFolderRequest) (object.ProductDocFolder, error)
	DeleteFolder(id string) error
}

type ProductDocMaterializeService interface {
	MaterializeDoc(workspaceID, userID, docID string) (string, error)
}

type ProductDocShareService interface {
	CreateShare(workspaceID, docID string) (object.ProductDocShare, error)
	GetSharedDoc(token string) (object.SharedDocView, error)
	ListShareCommentsByToken(token string) ([]object.ShareComment, error)
	AddShareComment(token string, req object.AddShareCommentRequest) (*object.ShareComment, error)
	ListDocShareComments(workspaceID, docID string) ([]object.ShareComment, error)
	AddDocShareComment(workspaceID, docID, userID string, req object.AddShareCommentRequest) (*object.ShareComment, error)
	ResolveShareComment(workspaceID, docID, commentID, userID string) (*object.ShareComment, error)
}

// ProductDocService 定义产品文档模块的服务接口。
type ProductDocService interface {
	ProductDocCRUDService
	ProductDocVersionService
	ProductDocFolderService
	ProductDocMaterializeService
	ProductDocShareService
}
