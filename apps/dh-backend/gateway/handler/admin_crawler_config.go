package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// crawlerConfigResponse 是 GET /admin/services/crawler 的响应，供 gatewayd 拉取 crawler MCP 配置。
type crawlerConfigResponse struct {
	URL       string `json:"url"`
	MaxDepth  int    `json:"maxDepth"`
	TimeoutMs int64  `json:"timeoutMs"`
}

// CrawlerConfigHandler 暴露 crawler-service 的 MCP endpoint 地址与默认参数。
// crawler 地址由 dh-backend 集中管理，gatewayd 启动时拉取（见设计文档第 5.3 节）。
type CrawlerConfigHandler struct {
	cfg *config.Config
}

func NewCrawlerConfigHandler(cfg *config.Config) *CrawlerConfigHandler {
	return &CrawlerConfigHandler{cfg: cfg}
}

func (h *CrawlerConfigHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	base := strings.TrimRight(h.cfg.CrawlerServiceURL, "/")
	mcpURL := base + "/mcp"
	timeoutMs := int64(h.cfg.CrawlerServiceTimeout.Seconds() * 1000)
	if timeoutMs <= 0 {
		timeoutMs = 60000
	}
	maxDepth := h.cfg.CrawlerMaxDepth
	if maxDepth <= 0 {
		maxDepth = 2
	}
	resp := crawlerConfigResponse{URL: mcpURL, MaxDepth: maxDepth, TimeoutMs: timeoutMs}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
