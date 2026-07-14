package workitem

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

// 需求管理平台相关常量。
const (
	platformMeego    = "meego"
	platformJira     = "jira"
	platformPingCode = "pingcode"
)

// PlatformInfo 描述一个需求管理平台的展示与配置元信息。
type PlatformInfo struct {
	Key                  string `json:"key"`
	Name                 string `json:"name"`
	NeedsProjectID       bool   `json:"needsProjectId"`
	ProjectIDPlaceholder string `json:"projectIdPlaceholder"`
}

// knownPlatforms 是平台元信息注册表。
// 调研结论：Jira 与 PingCode 均存在项目级标识（Jira 项目 Key/数字 ID，PingCode 项目 ID），
// 与 Meego 一样需要在空间配置中填写项目 ID 才能拉取/回写需求。
var knownPlatforms = map[string]PlatformInfo{
	platformMeego:    {Key: platformMeego, Name: "Meego", NeedsProjectID: true, ProjectIDPlaceholder: "输入 Meego 项目 ID..."},
	platformJira:     {Key: platformJira, Name: "Jira", NeedsProjectID: true, ProjectIDPlaceholder: "输入 Jira 项目 Key（如 PROJ）..."},
	platformPingCode: {Key: platformPingCode, Name: "PingCode", NeedsProjectID: true, ProjectIDPlaceholder: "输入 PingCode 项目 ID..."},
}

// configuredPlatforms 保存 config.yaml 中 workitem.platforms 配置的平台白名单。
var configuredPlatforms []string

// InitPlatforms 注入配置文件中启用的需求管理平台列表。
func InitPlatforms(platforms []string) {
	configuredPlatforms = platforms
}

// Platforms 处理 GET /api/v1/workitem-platforms，返回配置启用的平台及元信息。
func Platforms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	result := make([]PlatformInfo, 0, len(configuredPlatforms))
	for _, key := range configuredPlatforms {
		// 未注册的平台按 key 兜底展示，默认需要项目 ID（多数需求平台均按项目隔离）。
		info, ok := knownPlatforms[key]
		if !ok {
			info = PlatformInfo{Key: key, Name: key, NeedsProjectID: true, ProjectIDPlaceholder: "输入项目 ID..."}
		}
		result = append(result, info)
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(result)
}
