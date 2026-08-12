package handler

import (
	"context"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner"
	agentconfigservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig/service"
	crawlerservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/service"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
)

const (
	// finishWait 是 run 开始响应后、无新事件时的优雅结束等待时间。
	// 需要覆盖模型长时间思考（无事件输出）的场景，避免误判超时提前结束 run。
	finishWait = 10 * time.Minute
	// maxRunDuration 是单次 run 的总时长上限。PRD/原型生成等长任务可能超过 10 分钟，
	// 过短会在 agent 仍在正常工作时强制终止，导致回复丢失。
	maxRunDuration = 30 * time.Minute
	// sseHeartbeatInterval 是 SSE 心跳发送间隔。
	// agent 执行 bash/write 等工具时可能数分钟不产生事件，中间层 LB（如 APISIX 默认 60s）
	// 会因空闲超时切断连接。定期发送 SSE 注释（: heartbeat）保持连接活跃。
	sseHeartbeatInterval = 15 * time.Second
)

// USER_PROMPT_MARKER 与前端 useAgUiChat 保持一致，用于从包装后的提示词中提取原始用户输入。
const USER_PROMPT_MARKER = "__USER_PROMPT__"

// protoProjectsDirName 与 /proto-make 指令模板约定的产物目录一致（{WORKSPACE_PATH}/pm-jobs/prototypes）。
// 统一引用 workspacepath.SubDirPrototypes，保持单一事实来源。
const protoProjectsDirName = workspacepath.SubDirPrototypes

// AGUIHandler 处理 AG-UI 协议的 agent run 请求。
type AGUIHandler struct {
	aguiClient           *client.AGUIClient
	gatewaydAdminURL     string
	pluginKey            string
	sessions             chat.SessionStore
	messages             chat.MessageStore
	buffer               buffer.SSEBuffer
	workItemSvc          workitemservice.WorkItemService
	crawlerCookieSvc     *crawlerservice.CrawlerCookieService
	crawlerServiceURL     string
	crawlerServiceTimeout time.Duration
	crawlerMCPName        string
	workspaceRoot         string
	// agentConfigSvc 用于在 agent attach 后同步空间级模型/看门狗配置到 gatewayd。
	// 仅创建 session 时同步会在 gatewayd 重启后失效，因此每次 run attach 后都需重新同步。
	agentConfigSvc       agentconfigservice.AgentConfigService
}

// NewAGUIHandler 创建 AG-UI handler。
func NewAGUIHandler(adminURL, pluginKey, workspaceRoot string, sessions chat.SessionStore, messages chat.MessageStore, buf buffer.SSEBuffer, workItemSvc workitemservice.WorkItemService, crawlerCookieSvc *crawlerservice.CrawlerCookieService, crawlerServiceURL string, crawlerServiceTimeout time.Duration, crawlerMCPName string) *AGUIHandler {
	return &AGUIHandler{
		aguiClient:            client.NewAGUIClient(adminURL, pluginKey),
		gatewaydAdminURL:     adminURL,
		pluginKey:            pluginKey,
		sessions:             sessions,
		messages:             messages,
		buffer:               buf,
		workItemSvc:          workItemSvc,
		crawlerCookieSvc:     crawlerCookieSvc,
		crawlerServiceURL:     crawlerServiceURL,
		crawlerServiceTimeout: crawlerServiceTimeout,
		crawlerMCPName:        crawlerMCPName,
		workspaceRoot:         workspaceRoot,
	}
}

// SetAgentConfigService 注入空间级智能体配置服务，用于 run 时同步 gatewayd 配置。
func (h *AGUIHandler) SetAgentConfigService(svc agentconfigservice.AgentConfigService) {
	h.agentConfigSvc = svc
}

// resolveAGUIClient 根据请求 context 中的 ContainerInfo 解析 AGUIClient。
// 若 context 中有用户容器，创建指向该容器 gatewayd 的临时 AGUIClient；
// 否则降级到默认 aguiClient（全局固定地址）。
func (h *AGUIHandler) resolveAGUIClient(ctx context.Context) *client.AGUIClient {
	container := provisioner.ContainerFromContext(ctx)
	if container != nil {
		return client.NewAGUIClient(container.GatewaydAdminURL(), h.pluginKey)
	}
	return h.aguiClient
}

// LONG_TASK_COMMANDS 需要在前端显示中间进度反馈的斜杠指令集合。
// 这些指令通常涉及文件写入、工程生成等长耗时操作，模型可能长时间无 text token 输出。
var LONG_TASK_COMMANDS = map[string]bool{
	"/proto-make":    true,
	"/code":          true,
	"/user-story":    true,
	"/prd-write":     true,
	"/prd-research":  true,
	"/ui-kit":        true,
	"/test-case":     true,
	"/auto-test":     true,
	"/unit-test":     true,
}
