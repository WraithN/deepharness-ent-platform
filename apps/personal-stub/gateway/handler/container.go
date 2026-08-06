package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// container 管理面相关常量。
const (
	containerHTTPTimeout    = 10 * time.Second
	gatewaydHealthSubPath   = "/admin/health"
	gatewaydBindSubPath     = "/admin/bind"
	gatewaydUnbindSubPath   = "/admin/unbind"
	gatewaydSleepSubPath    = "/admin/sleep"
	gatewaydWakeSubPath     = "/admin/wake"
	dhBackendReportPathFmt  = "/api/v1/agent-runtimes/%s/status"
)

// containerCfg 容器管理面配置，通过 SetContainerConfig 注入。
var containerCfg containerConfig

type containerConfig struct {
	gatewaydAdminURL      string // 外部启动模式下的 gatewayd admin URL（向后兼容）
	dhBackendURL          string
	dhBackendRuntimeToken string
	dhBackendRuntimeID    string
}

// gatewaydMgr 是全局 gatewayd 进程管理器。
// 非空且 Enabled 时，优先使用管理器解析 gatewayd admin URL；
// 否则回退到 containerCfg.gatewaydAdminURL（外部启动模式）。
var gatewaydMgr *GatewaydManager

// SetGatewaydManager 注入 gatewayd 进程管理器（在 main.go 初始化阶段调用）。
func SetGatewaydManager(m *GatewaydManager) {
	gatewaydMgr = m
}

// SetContainerConfig 注入容器管理面配置（gatewayd admin URL + dh-backend 上报信息）。
// 在 server.go 初始化阶段调用。
func SetContainerConfig(gatewaydAdminURL, dhBackendURL, runtimeToken, runtimeID string) {
	containerCfg = containerConfig{
		gatewaydAdminURL:      gatewaydAdminURL,
		dhBackendURL:          dhBackendURL,
		dhBackendRuntimeToken: runtimeToken,
		dhBackendRuntimeID:    runtimeID,
	}
}

var containerHTTPClient = &http.Client{Timeout: containerHTTPTimeout}

// ContainerHealth GET /api/v1/container/health
// 检查 gatewayd 健康 + 返回组合状态。
// 若启用了 GatewaydManager 且指定了 user_id 查询参数，会触发懒启动（1:N 模式）并返回端口信息。
func ContainerHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	// 若启用了 GatewaydManager，使用管理器获取健康状态和端口信息。
	if gatewaydMgr != nil && gatewaydMgr.Enabled() {
		userID := r.URL.Query().Get("user_id")

		// 1:N 模式下，若指定了 user_id，触发懒启动并返回端口。
		if gatewaydMgr.IsMultiMode() && userID != "" {
			agentPort, adminPort, err := gatewaydMgr.EnsureRunning(userID)
			if err != nil {
				WriteJSONError(w, http.StatusServiceUnavailable, 1, "failed to ensure gatewayd: "+err.Error())
				return
			}
			SetJSONHeader(w)
			json.NewEncoder(w).Encode(map[string]any{
				"personalStub": "ok",
				"gatewayd":     "ok",
				"agentPort":    agentPort,
				"adminPort":    adminPort,
				"userId":       userID,
			})
			return
		}

		// 1:1 模式或未指定 user_id：返回所有实例健康状态。
		instances := gatewaydMgr.Health()
		gatewaydStatus := "down"
		for _, h := range instances {
			if h.Status == "ok" {
				gatewaydStatus = "ok"
				break
			}
		}
		if len(instances) == 0 {
			gatewaydStatus = "skipped"
		}
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(map[string]any{
			"personalStub": "ok",
			"gatewayd":     gatewaydStatus,
			"instances":    instances,
		})
		return
	}

	// 回退：外部启动模式，使用配置的 gatewaydAdminURL 探活。
	gatewaydStatus := "down"
	if containerCfg.gatewaydAdminURL != "" {
		if resp, err := containerHTTPClient.Get(containerCfg.gatewaydAdminURL + gatewaydHealthSubPath); err == nil {
			resp.Body.Close()
			gatewaydStatus = "ok"
		}
	} else {
		gatewaydStatus = "skipped"
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{
		"personalStub": "ok",
		"gatewayd":     gatewaydStatus,
	})
}

// ContainerBind POST /api/v1/container/bind
// 代理到 gatewayd /admin/bind。
func ContainerBind(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	proxyToGatewayd(w, r, gatewaydBindSubPath)
}

// ContainerUnbind POST /api/v1/container/unbind
// 代理到 gatewayd /admin/unbind。
func ContainerUnbind(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	proxyToGatewayd(w, r, gatewaydUnbindSubPath)
}

// ContainerSleep POST /api/v1/container/sleep
// 代理到 gatewayd /admin/sleep。
func ContainerSleep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	proxyToGatewayd(w, r, gatewaydSleepSubPath)
}

// ContainerWake POST /api/v1/container/wake
// 代理到 gatewayd /admin/wake。
func ContainerWake(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	proxyToGatewayd(w, r, gatewaydWakeSubPath)
}

// ContainerReport POST /api/v1/container/report
// 接收 gatewayd 状态上报，由 personal-stub 附加自身采集的 CPU/内存/IP 后转发到 dh-backend。
// 使用配置的 dhBackendRuntimeID 作为运行时 ID。
func ContainerReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "read body failed: "+err.Error())
		return
	}
	defer r.Body.Close()

	// 转发到 dh-backend 上报端点
	if containerCfg.dhBackendURL == "" || containerCfg.dhBackendRuntimeID == "" {
		// 未配置 dh-backend，仅记录日志，返回成功
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(map[string]string{"status": "skipped"})
		return
	}

	// 解析 gatewayd 上报的 body，注入 personal-stub 采集的 CPU/内存/IP。
	enrichedBody := enrichReportBody(body)

	reportURL := fmt.Sprintf("%s"+dhBackendReportPathFmt, containerCfg.dhBackendURL, containerCfg.dhBackendRuntimeID)
	forwardReportToBackend(w, r.Context(), reportURL, enrichedBody)
}

// AgentRuntimeStatusReport POST /api/v1/agent-runtimes/{id}/status
// 是 gatewayd 通过 DH_PLATFORM_URL 指向 personal-stub 时的实际入口。
// 从 URL 路径提取 runtime ID，注入 personal-stub 采集的 CPU/内存/IP 后转发到 dh-backend。
func AgentRuntimeStatusReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	runtimeID := r.PathValue("id")
	if runtimeID == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "runtime id is required")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "read body failed: "+err.Error())
		return
	}
	defer r.Body.Close()

	if containerCfg.dhBackendURL == "" {
		SetJSONHeader(w)
		json.NewEncoder(w).Encode(map[string]string{"status": "skipped"})
		return
	}

	// 注入 personal-stub 采集的 CPU/内存/IP。
	enrichedBody := enrichReportBody(body)

	reportURL := fmt.Sprintf("%s"+dhBackendReportPathFmt, containerCfg.dhBackendURL, runtimeID)
	forwardReportToBackend(w, r.Context(), reportURL, enrichedBody)
}

// forwardReportToBackend 将已处理的上报 body 转发到 dh-backend，并透传响应。
func forwardReportToBackend(w http.ResponseWriter, ctx context.Context, reportURL string, body []byte) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reportURL, bytes.NewReader(body))
	if err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "create report request failed: "+err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if containerCfg.dhBackendRuntimeToken != "" {
		req.Header.Set("Authorization", "Bearer "+containerCfg.dhBackendRuntimeToken)
	}

	resp, err := containerHTTPClient.Do(req)
	if err != nil {
		WriteJSONError(w, http.StatusBadGateway, 1, "forward report to dh-backend failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// enrichReportBody 解析 gatewayd 上报的 JSON body，注入 personal-stub 采集的 CPU/内存/IP。
// 若解析失败则原样返回 body（保证不阻断上报流程）。
func enrichReportBody(body []byte) []byte {
	var report map[string]any
	if err := json.Unmarshal(body, &report); err != nil {
		// 解析失败，原样返回
		return body
	}

	// 注入 personal-stub 采集的系统指标，覆盖 gatewayd 上报的值。
	// personal-stub 在容器/主机层面采集的指标更准确。
	report["cpu_percent"] = GetCPUPercent()
	report["mem_percent"] = GetMemPercent()

	// 注入容器/主机 IP 地址
	if ip := GetOutboundIP(); ip != "" {
		report["ip"] = ip
	}

	enriched, err := json.Marshal(report)
	if err != nil {
		return body
	}
	return enriched
}

// resolveGatewaydAdminURL 解析当前请求应使用的 gatewayd admin URL。
// 优先使用 GatewaydManager（若已启用），1:N 模式下按 userID 路由；
// 否则回退到 containerCfg.gatewaydAdminURL（外部启动模式）。
func resolveGatewaydAdminURL(r *http.Request) string {
	if gatewaydMgr != nil && gatewaydMgr.Enabled() {
		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			userID = r.Header.Get("X-User-ID")
		}
		url := gatewaydMgr.GetAdminURL(userID)
		if url != "" {
			return url
		}
	}
	return containerCfg.gatewaydAdminURL
}

// proxyToGatewayd 将请求代理到 gatewayd admin API 指定子路径。
func proxyToGatewayd(w http.ResponseWriter, r *http.Request, subPath string) {
	adminURL := resolveGatewaydAdminURL(r)
	if adminURL == "" {
		WriteJSONError(w, http.StatusServiceUnavailable, 1, "gatewayd admin URL not configured")
		return
	}

	targetURL := adminURL + subPath
	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "create proxy request failed: "+err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := containerHTTPClient.Do(req)
	if err != nil {
		WriteJSONError(w, http.StatusBadGateway, 1, FormatGatewaydError(err))
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// 确保 context 包被使用（未来可能需要 context.WithTimeout）。
var _ = context.Background
