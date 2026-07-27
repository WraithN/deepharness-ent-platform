package productdoc

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
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
		if req.CreatedBy == "" {
			if userID, ok := middleware.UserIDFromContext(r.Context()); ok {
				req.CreatedBy = userID
			}
		}
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

// ProductDocFolders 处理目录集合请求：GET 列表、POST 创建。
func ProductDocFolders(w http.ResponseWriter, r *http.Request) {
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
		folders, err := defaultProductDocService.ListFolders(workspaceID)
		if err != nil {
			log.Printf("[ProductDoc] ListFolders failed: %v", err)
			http.Error(w, `{"code":1,"message":"failed to list folders"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(folders)
	case http.MethodPost:
		var req object.CreateFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		req.WorkspaceID = workspaceID
		folder, err := defaultProductDocService.CreateFolder(req)
		if err != nil {
			log.Printf("[ProductDoc] CreateFolder failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(folder)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProductDocFolderByID 处理单个目录请求：PATCH 更新（重命名/置顶）、DELETE 删除。
func ProductDocFolderByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	folderID := r.PathValue("folderId")
	if folderID == "" {
		http.Error(w, `{"code":1,"message":"missing folder id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var req object.UpdateFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		folder, err := defaultProductDocService.UpdateFolder(folderID, req)
		if err != nil {
			log.Printf("[ProductDoc] UpdateFolder failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(folder)
	case http.MethodDelete:
		if err := defaultProductDocService.DeleteFolder(folderID); err != nil {
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
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
	if req.CreatedBy == "" {
		if userID, ok := middleware.UserIDFromContext(r.Context()); ok {
			req.CreatedBy = userID
		}
	}

	version, err := defaultProductDocService.PublishVersion(docID, req)
	if err != nil {
		log.Printf("[ProductDoc] PublishVersion failed: %v", err)
		http.Error(w, `{"code":1,"message":"发布版本失败"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(version)
}

// ShareProductDoc 处理 POST /api/v1/workspaces/{id}/product-docs/{docId}/share：
// 为已发布文档生成（或返回已有）分享短链 token。
func ShareProductDoc(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	share, err := defaultProductDocService.CreateShare(r.PathValue("id"), r.PathValue("docId"))
	if err != nil {
		log.Printf("[ProductDoc] CreateShare failed: %v", err)
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(share)
}

// MaterializeProductDoc 处理 POST /api/v1/workspaces/{id}/product-docs/{docId}/materialize：
// 将文档内容按需写入 agent 工作目录 products/ 下，返回相对路径供 agent 读取。需登录。
func MaterializeProductDoc(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"code":2,"message":"未登录或登录已过期"}`, http.StatusUnauthorized)
		return
	}

	path, err := defaultProductDocService.MaterializeDoc(r.PathValue("id"), userID, r.PathValue("docId"))
	if err != nil {
		log.Printf("[ProductDoc] MaterializeDoc failed: %v", err)
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"path": path})
}

// queryTimeLayoutDate 查询参数中仅含日期的时间格式。
const queryTimeLayoutDate = "2006-01-02"

// handlerHoursPerDay 用于将日期参数扩展为当天结束时刻。
const handlerHoursPerDay = 24

// SharedDoc 处理 GET /api/v1/shares/{token}：免登录查看分享文档（最新已发布版本）。
func SharedDoc(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	view, err := defaultProductDocService.GetSharedDoc(r.PathValue("token"))
	if err != nil {
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(view)
}

// ShareDocComments 处理分享页批注集合请求：GET 列表、POST 新增。
// 免登录接口：访客填写昵称即可批注，token 有效性由 service 层校验。
func ShareDocComments(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	token := r.PathValue("token")
	if token == "" {
		http.Error(w, `{"code":1,"message":"missing share token"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		comments, err := defaultProductDocService.ListShareCommentsByToken(token)
		if err != nil {
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(comments)
	case http.MethodPost:
		var req object.AddShareCommentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		comment, err := defaultProductDocService.AddShareComment(token, req)
		if err != nil {
			log.Printf("[ProductDoc] AddShareComment failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(comment)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProductDocShareComments 处理 /api/v1/workspaces/{id}/product-docs/{docId}/share-comments：
// GET 登录用户查看全部分享批注；POST 登录用户新增批注。
func ProductDocShareComments(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodGet:
		comments, err := defaultProductDocService.ListDocShareComments(r.PathValue("id"), r.PathValue("docId"))
		if err != nil {
			log.Printf("[ProductDoc] ListDocShareComments failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(comments)
	case http.MethodPost:
		userID, ok := middleware.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"code":2,"message":"未登录或登录已过期"}`, http.StatusUnauthorized)
			return
		}
		var req object.AddShareCommentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		comment, err := defaultProductDocService.AddDocShareComment(
			r.PathValue("id"), r.PathValue("docId"), userID, req,
		)
		if err != nil {
			log.Printf("[ProductDoc] AddDocShareComment failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(comment)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProductDocShareCommentResolve 处理 POST /api/v1/workspaces/{id}/product-docs/{docId}/share-comments/{commentId}/resolve：
// 将批注标记为已解决，操作人 userID 由 auth 中间件注入。
func ProductDocShareCommentResolve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"code":2,"message":"未登录或登录已过期"}`, http.StatusUnauthorized)
		return
	}

	comment, err := defaultProductDocService.ResolveShareComment(
		r.PathValue("id"), r.PathValue("docId"), r.PathValue("commentId"), userID,
	)
	if err != nil {
		log.Printf("[ProductDoc] ResolveShareComment failed: %v", err)
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(comment)
}

// ProductDocWorkspaceVersions 处理 GET /api/v1/workspaces/{id}/product-doc-versions：
// 按工作空间维度分页查询文档版本历史，支持时间区间、文档、状态、创建人、关键字过滤。
func ProductDocWorkspaceVersions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"code":1,"message":"missing workspace id"}`, http.StatusBadRequest)
		return
	}

	filter, err := parseWorkspaceVersionFilter(r.URL.Query())
	if err != nil {
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	list, err := defaultProductDocService.ListWorkspaceVersions(workspaceID, filter)
	if err != nil {
		log.Printf("[ProductDoc] ListWorkspaceVersions failed: %v", err)
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(list)
}

// ProductDocVersionByVersion 处理单个版本请求：
// PATCH 更新版本说明、DELETE 删除版本，均需登录。
func ProductDocVersionByVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}

	workspaceID, docID, version, ok := parseVersionPathValues(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPatch:
		userID, ok := middleware.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"code":2,"message":"未登录或登录已过期"}`, http.StatusUnauthorized)
			return
		}
		var req object.UpdateVersionSummaryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		if err := defaultProductDocService.UpdateVersionSummary(workspaceID, docID, version, req.ChangeSummary, userID); err != nil {
			log.Printf("[ProductDoc] UpdateVersionSummary failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"message": "ok"})
	case http.MethodDelete:
		userID, ok := middleware.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"code":2,"message":"未登录或登录已过期"}`, http.StatusUnauthorized)
			return
		}
		if err := defaultProductDocService.DeleteVersion(workspaceID, docID, version, userID); err != nil {
			log.Printf("[ProductDoc] DeleteVersion failed: %v", err)
			http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProductDocVersionRestore 处理 POST /api/v1/workspaces/{id}/product-docs/{docId}/versions/{version}/restore：
// 将文档回滚到指定历史版本（生成新版本，不覆盖历史），需登录。
func ProductDocVersionRestore(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProductDocService == nil {
		http.Error(w, `{"code":1,"message":"product doc service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	workspaceID, docID, version, ok := parseVersionPathValues(w, r)
	if !ok {
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"code":2,"message":"未登录或登录已过期"}`, http.StatusUnauthorized)
		return
	}

	newVersion, err := defaultProductDocService.RestoreVersion(workspaceID, docID, version, userID)
	if err != nil {
		log.Printf("[ProductDoc] RestoreVersion failed: %v", err)
		http.Error(w, `{"code":1,"message":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(newVersion)
}

// parseVersionPathValues 解析版本相关路由的公共路径参数（workspace/doc/version），
// 解析失败时直接写出错误响应并返回 ok=false（guard clause，减少 handler 嵌套）。
func parseVersionPathValues(w http.ResponseWriter, r *http.Request) (workspaceID, docID string, version int, ok bool) {
	workspaceID = r.PathValue("id")
	docID = r.PathValue("docId")
	if workspaceID == "" || docID == "" {
		http.Error(w, `{"code":1,"message":"missing workspace id or doc id"}`, http.StatusBadRequest)
		return "", "", 0, false
	}
	version, err := strconv.Atoi(r.PathValue("version"))
	if err != nil || version <= 0 {
		http.Error(w, `{"code":1,"message":"版本号必须为正整数"}`, http.StatusBadRequest)
		return "", "", 0, false
	}
	return workspaceID, docID, version, true
}

// parseWorkspaceVersionFilter 从 query 参数解析版本列表过滤条件。
func parseWorkspaceVersionFilter(q url.Values) (object.WorkspaceVersionFilter, error) {
	var filter object.WorkspaceVersionFilter

	startTime, err := parseVersionQueryTime(q.Get("start"), false)
	if err != nil {
		return filter, err
	}
	filter.StartTime = startTime

	endTime, err := parseVersionQueryTime(q.Get("end"), true)
	if err != nil {
		return filter, err
	}
	filter.EndTime = endTime

	filter.DocIDs = splitAndTrimCSV(q.Get("docIds"))
	filter.Status = q.Get("status")
	filter.CreatedBy = q.Get("createdBy")
	filter.Keyword = q.Get("keyword")

	page, err := parsePositiveIntParam(q.Get("page"))
	if err != nil {
		return filter, err
	}
	filter.Page = page

	pageSize, err := parsePositiveIntParam(q.Get("pageSize"))
	if err != nil {
		return filter, err
	}
	filter.PageSize = pageSize

	return filter, nil
}

// parseVersionQueryTime 解析时间查询参数，支持 RFC3339 与 YYYY-MM-DD 两种格式。
// endOfDay 为 true 时，纯日期参数取当天 23:59:59（用于 end 参数包含整日）。
func parseVersionQueryTime(raw string, endOfDay bool) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t, nil
	}
	t, err := time.Parse(queryTimeLayoutDate, raw)
	if err != nil {
		return nil, fmt.Errorf("时间格式无效，支持 RFC3339 或 YYYY-MM-DD: %s", raw)
	}
	if endOfDay {
		t = t.Add(handlerHoursPerDay*time.Hour - time.Nanosecond)
	}
	return &t, nil
}

// parsePositiveIntParam 解析可选的正整数 query 参数，空值返回 0（由 service 层填充默认值）。
func parsePositiveIntParam(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return 0, fmt.Errorf("分页参数必须为正整数: %s", raw)
	}
	return v, nil
}

// splitAndTrimCSV 按逗号拆分并去除空白，忽略空段。
func splitAndTrimCSV(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if v := strings.TrimSpace(part); v != "" {
			result = append(result, v)
		}
	}
	return result
}
