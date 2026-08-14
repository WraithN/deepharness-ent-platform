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
	handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "process service not initialized")
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
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing workspaceId")
		return
	}
	list, err := defaultProcessService.ListByWorkspace(r.Context(), workspaceID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
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
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing process id")
		return
	}
	p, err := defaultProcessService.GetByID(r.Context(), id)
	if err != nil {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, err.Error())
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
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid request body")
		return
	}
	p, err := defaultProcessService.Create(r.Context(), req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
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
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing process id or stage name")
		return
	}
	var req object.UpdateStageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid request body")
		return
	}
	p, err := defaultProcessService.UpdateStage(r.Context(), processID, stageName, req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	json.NewEncoder(w).Encode(p)
}

// ActiveCheckResponse 活跃流程检测返回
type ActiveCheckResponse struct {
	HasActive     bool            `json:"hasActive"`
	ActiveProcess *object.Process `json:"activeProcess"`
}

// Terminate 终止进行中的流程（将 pending/in_progress 阶段标记为 terminated）。
func Terminate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProcessService == nil {
		notInitialized(w)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing process id")
		return
	}
	p, err := defaultProcessService.TerminateProcess(r.Context(), id)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	json.NewEncoder(w).Encode(p)
}

// ActiveCheck 检查是否存在进行中的流程
func ActiveCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultProcessService == nil {
		notInitialized(w)
		return
	}
	workitemID := r.URL.Query().Get("workitemId")
	docPath := r.URL.Query().Get("docPath")
	if workitemID == "" || docPath == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing workitemId or docPath")
		return
	}
	p, err := defaultProcessService.HasInProgress(r.Context(), workitemID, docPath)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	json.NewEncoder(w).Encode(ActiveCheckResponse{
		HasActive:     p != nil,
		ActiveProcess: p,
	})
}
