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

// ProductDocService 定义产品文档模块的服务接口。
type ProductDocService interface {
	ListDocs(filter ProductDocFilter) ([]object.ProductDoc, error)
	GetDoc(id string) (object.ProductDoc, error)
	CreateDoc(req object.CreateProductDocRequest) (object.ProductDoc, error)
	UpdateDoc(id string, req object.UpdateProductDocRequest) (object.ProductDoc, error)
	DeleteDoc(id string) error
	ListVersions(docID string) ([]object.ProductDocVersion, error)
	PublishVersion(docID string, req object.PublishProductDocRequest) (object.ProductDocVersion, error)
}
