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
	gatewaydAdminURL      string
	dhBackendURL          string
	dhBackendRuntimeToken string
	dhBackendRuntimeID    string
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
func ContainerHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

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
// 接收 gatewayd 状态上报，转发到 dh-backend。
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

	reportURL := fmt.Sprintf("%s"+dhBackendReportPathFmt, containerCfg.dhBackendURL, containerCfg.dhBackendRuntimeID)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, reportURL, bytes.NewReader(body))
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

	// 透传 dh-backend 响应
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// proxyToGatewayd 将请求代理到 gatewayd admin API 指定子路径。
func proxyToGatewayd(w http.ResponseWriter, r *http.Request, subPath string) {
	if containerCfg.gatewaydAdminURL == "" {
		WriteJSONError(w, http.StatusServiceUnavailable, 1, "gatewayd admin URL not configured")
		return
	}

	targetURL := containerCfg.gatewaydAdminURL + subPath
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
