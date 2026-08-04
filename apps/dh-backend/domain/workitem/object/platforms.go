package object

// 需求管理平台相关常量。
const (
	PlatformMeego    = "meego"
	PlatformJira     = "jira"
	PlatformPingCode = "pingcode"
)

// PlatformInfo 描述一个需求管理平台的展示与配置元信息。
type PlatformInfo struct {
	Key                  string `json:"key"`
	Name                 string `json:"name"`
	NeedsProjectID       bool   `json:"needsProjectId"`
	ProjectIDPlaceholder string `json:"projectIDPlaceholder"`
}

// KnownPlatforms 是平台元信息注册表。
// 调研结论：Jira 与 PingCode 均存在项目级标识（Jira 项目 Key/数字 ID，PingCode 项目 ID），
// 与 Meego 一样需要在空间配置中填写项目 ID 才能拉取/回写需求。
var KnownPlatforms = map[string]PlatformInfo{
	PlatformMeego:    {Key: PlatformMeego, Name: "Meego", NeedsProjectID: true, ProjectIDPlaceholder: "输入 Meego 项目 ID..."},
	PlatformJira:     {Key: PlatformJira, Name: "Jira", NeedsProjectID: true, ProjectIDPlaceholder: "输入 Jira 项目 Key（如 PROJ）..."},
	PlatformPingCode: {Key: PlatformPingCode, Name: "PingCode", NeedsProjectID: true, ProjectIDPlaceholder: "输入 PingCode 项目 ID..."},
}
