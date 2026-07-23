// Package object 定义原型工程模版模块的数据结构。
package object

import "time"

// 模版状态：描述模版从上传到可用之间的生命周期。
const (
	// StatusPending 表示模版已解压但尚未安装依赖，还不能被 /proto-make 使用。
	StatusPending = "pending"
	// StatusInstalling 表示正在执行 pnpm install。
	StatusInstalling = "installing"
	// StatusReady 表示依赖已安装（或无需安装），模版可被 /proto-make 选用。
	StatusReady = "ready"
	// StatusError 表示安装依赖失败，模版暂不可用。
	StatusError = "error"
)

// PrototypeTemplate 表示一个原型工程模版，与 prototype_templates 表对应。
// 模版源码存放在 dir_path 指向的磁盘目录，元数据存数据库。
type PrototypeTemplate struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Tags           string    `json:"tags"`
	DirPath        string    `json:"dirPath"`
	Status         string    `json:"status"`
	HasNodeModules bool      `json:"hasNodeModules"`
	InstallLog     string    `json:"installLog"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// UpdateMetaRequest 是更新模版元信息（名称/场景描述/标签）的请求体。
type UpdateMetaRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Tags        string `json:"tags"`
}
