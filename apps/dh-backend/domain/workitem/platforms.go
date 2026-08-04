package workitem

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

// configuredPlatforms 保存 config.yaml 中 workitem.platforms 配置的平台白名单。
var configuredPlatforms []string

// InitPlatforms 注入配置文件中启用的需求管理平台列表。
func InitPlatforms(platforms []string) {
	configuredPlatforms = platforms
}

// Platforms 处理 GET /api/v1/workitem-platforms，返回配置启用的平台及元信息。
func Platforms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	result := make([]object.PlatformInfo, 0, len(configuredPlatforms))
	for _, key := range configuredPlatforms {
		// 未注册的平台按 key 兜底展示，默认需要项目 ID（多数需求平台均按项目隔离）。
		info, ok := object.KnownPlatforms[key]
		if !ok {
			info = object.PlatformInfo{Key: key, Name: key, NeedsProjectID: true, ProjectIDPlaceholder: "输入项目 ID..."}
		}
		result = append(result, info)
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(result)
}
