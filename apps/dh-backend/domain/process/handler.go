package process

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

var defaultProcessService service.ProcessService

// Init 初始化流程服务
func Init(svc service.ProcessService) {
	defaultProcessService = svc
}

// GetService 获取流程服务实例（供编排层调用）
func GetService() service.ProcessService {
	return defaultProcessService
}

func notInitialized(w http.ResponseWriter) {
	handler.WriteJSONError(w, http.StatusInternalServerError, 1, "process service not initialized")
}

// List 列出当前工作空间下的流程
func List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProcessService == nil {
		notInitialized(w)
		return
	}
	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "missing workspaceId")
		return
	}
	list, err := defaultProcessService.ListByWorkspace(r.Context(), workspaceID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(list)
}

// GetByID 获取单个流程详情
func GetByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProcessService == nil {
		notInitialized(w)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "missing process id")
		return
	}
	p, err := defaultProcessService.GetByID(r.Context(), id)
	if err != nil {
		handler.WriteJSONError(w, http.StatusNotFound, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(p)
}

// Create 创建新流程
func Create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProcessService == nil {
		notInitialized(w)
		return
	}
	var req object.CreateProcessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	p, err := defaultProcessService.Create(r.Context(), req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(p)
}

// UpdateStage 更新流程阶段状态
func UpdateStage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProcessService == nil {
		notInitialized(w)
		return
	}
	processID := r.PathValue("id")
	stageName := r.PathValue("stageName")
	if processID == "" || stageName == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "missing process id or stage name")
		return
	}
	var req object.UpdateStageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	p, err := defaultProcessService.UpdateStage(r.Context(), processID, stageName, req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	json.NewEncoder(w).Encode(p)
}
