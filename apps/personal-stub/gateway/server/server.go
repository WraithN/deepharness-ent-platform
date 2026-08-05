package server

import (
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/config"
	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/gateway/middleware"
)

// New 创建 personal-stub HTTP 服务器。
// 负责文件读写、工程管理（git diff/tree/check/sync）、项目预览（dev server），
// 以及容器管理面（gatewayd 生命周期代理 + 运行时上报中继）。
func New(cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	// 初始化文件访问安全根目录。
	handler.SetFilesRoot(cfg.WorkspaceRoot)
	handler.SetAllowedRoots([]string{cfg.WorkspaceRoot})

	// 注入容器管理面配置（gatewayd 代理 + 上报中继）。
	handler.SetContainerConfig(cfg.GatewaydAdminURL, cfg.DHBackendURL, cfg.DHBackendRuntimeToken, cfg.DHBackendRuntimeID)

	// 健康检查
	mux.HandleFunc("/health", handler.HealthCheck)

	// 容器管理面（gatewayd 生命周期代理 + 上报中继）
	mux.HandleFunc("/api/v1/container/health", handler.ContainerHealth)
	mux.HandleFunc("/api/v1/container/bind", handler.ContainerBind)
	mux.HandleFunc("/api/v1/container/unbind", handler.ContainerUnbind)
	mux.HandleFunc("/api/v1/container/sleep", handler.ContainerSleep)
	mux.HandleFunc("/api/v1/container/wake", handler.ContainerWake)
	mux.HandleFunc("/api/v1/container/report", handler.ContainerReport)

	// 规范文件管理（AGENTS.md / DESIGN.md / CLAUDE.md 下发与清理）
	mux.HandleFunc("/api/v1/standards/sync", handler.StandardsSync)
	mux.HandleFunc("/api/v1/standards/clear", handler.StandardsClear)

	// 文件读取/写入/删除/下载/版本查询/保存
	mux.HandleFunc("/api/v1/files/content", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handler.FileContent(w, r)
		case http.MethodPut, http.MethodPost:
			handler.FileWrite(w, r)
		case http.MethodDelete:
			handler.FileDelete(w, r)
		default:
			handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		}
	})
	mux.HandleFunc("/api/v1/files/download", handler.FileDownload)
	mux.HandleFunc("/api/v1/files/versions", handler.FileVersions)
	mux.HandleFunc("/api/v1/files/save-to-feishu", handler.SaveToFeishu)
	mux.HandleFunc("/api/v1/files/mkdir", handler.FileMkdir)
	mux.HandleFunc("/api/v1/files/dir", handler.FileRemoveDir)
	mux.HandleFunc("/api/v1/files/list", handler.FileListDir)
	mux.HandleFunc("/api/v1/files/walk", handler.FileWalkDir)
	mux.HandleFunc("/api/v1/files/glob", handler.FileGlob)
	mux.HandleFunc("/api/v1/files/info", handler.FileInfo)
	mux.HandleFunc("/api/v1/files/exists", handler.FileExists)

	// 工程项目管理（AI 创建/修改的工程预览与同步）
	mux.HandleFunc("/api/v1/projects/tree", handler.ProjectTree)
	mux.HandleFunc("/api/v1/projects/diff", handler.ProjectDiff)
	mux.HandleFunc("/api/v1/projects/check", handler.ProjectCheck)
	mux.HandleFunc("/api/v1/projects/sync", handler.ProjectSync)
	mux.HandleFunc("/api/v1/projects/git-exec", handler.ProjectGitExec)
	mux.HandleFunc("/api/v1/projects/clone", handler.ProjectClone)
	mux.HandleFunc("/api/v1/projects/npm-install", handler.NpmInstall)

	// 项目预览（dev server 管理 + 反向代理）
	mux.HandleFunc("/api/v1/preview/start", handler.PreviewStart)
	mux.HandleFunc("/api/v1/preview/stop", handler.PreviewStop)
	mux.HandleFunc("/api/v1/preview/status", handler.PreviewStatus)
	mux.HandleFunc("/api/v1/preview/proxy/", handler.PreviewProxy)

	// 技能模板
	mux.HandleFunc("/api/v1/skills", handler.SkillsList)
	mux.HandleFunc("/api/v1/skills/{name}/content", handler.SkillsContent)

	log.Printf("[PersonalStub] workspaceRoot=%s gatewaydAdminURL=%s", cfg.WorkspaceRoot, cfg.GatewaydAdminURL)

	return middleware.Logger(middleware.CORS(mux))
}
