package productdoc

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/service"
)

var defaultProductDocService service.ProductDocService

// Init 设置 ProductDoc 服务实现。
func Init(svc service.ProductDocService) {
	defaultProductDocService = svc
}

// ProductDocs 处理产品文档集合请求：GET 列表、POST 创建。
func ProductDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"code":1,"message":"missing workspace id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		filter := service.ProductDocFilter{
			WorkspaceID: workspaceID,
			Status:      object.DocStatus(r.URL.Query().Get("status")),
			Category:    r.URL.Query().Get("category"),
		}
		docs, err := defaultProductDocService.ListDocs(filter)
		if err != nil {
			log.Printf("[ProductDoc] ListDocs failed: %v", err)
			http.Error(w, `{"code":1,"message":"failed to list product docs"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(docs)
	case http.MethodPost:
		var req object.CreateProductDocRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Printf("[ProductDoc] invalid create request: %v", err)
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		req.WorkspaceID = workspaceID
		doc, err := defaultProductDocService.CreateDoc(req)
		if err != nil {
			log.Printf("[ProductDoc] CreateDoc failed: %v", err)
			http.Error(w, `{"code":1,"message":"创建文档失败"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(doc)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProductDocByID 处理单个产品文档请求：GET 详情、PATCH 更新、DELETE 删除。
func ProductDocByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	docID := r.PathValue("docId")
	if docID == "" {
		http.Error(w, `{"code":1,"message":"missing doc id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		doc, err := defaultProductDocService.GetDoc(docID)
		if err != nil {
			http.Error(w, `{"code":1,"message":"product doc not found"}`, http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(doc)
	case http.MethodPatch:
		var req object.UpdateProductDocRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		doc, err := defaultProductDocService.UpdateDoc(docID, req)
		if err != nil {
			http.Error(w, `{"code":1,"message":"更新文档失败"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(doc)
	case http.MethodDelete:
		if err := defaultProductDocService.DeleteDoc(docID); err != nil {
			http.Error(w, `{"code":1,"message":"删除文档失败"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProductDocVersions 处理 GET /api/v1/workspaces/{id}/product-docs/{docId}/versions。
func ProductDocVersions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	docID := r.PathValue("docId")
	if docID == "" {
		http.Error(w, `{"code":1,"message":"missing doc id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	versions, err := defaultProductDocService.ListVersions(docID)
	if err != nil {
		log.Printf("[ProductDoc] ListVersions failed: %v", err)
		http.Error(w, `{"code":1,"message":"failed to list versions"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(versions)
}

// PublishProductDoc 处理 POST /api/v1/workspaces/{id}/product-docs/{docId}/publish。
func PublishProductDoc(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	docID := r.PathValue("docId")
	if docID == "" {
		http.Error(w, `{"code":1,"message":"missing doc id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req object.PublishProductDocRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	version, err := defaultProductDocService.PublishVersion(docID, req)
	if err != nil {
		log.Printf("[ProductDoc] PublishVersion failed: %v", err)
		http.Error(w, `{"code":1,"message":"发布版本失败"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(version)
}
