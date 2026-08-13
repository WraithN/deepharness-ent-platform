package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/object"
)

// scrapeRequest 是调用 crawler-service /scrape 的请求体。
type scrapeRequest struct {
	URL      string          `json:"url"`
	Cookies  []object.Cookie `json:"cookies,omitempty"`
	MaxDepth int             `json:"maxDepth,omitempty"`
}

// scrapeResponse 是 crawler-service /scrape 的响应体。
type scrapeResponse struct {
	URL      string `json:"url"`
	Title    string `json:"title,omitempty"`
	Markdown string `json:"markdown,omitempty"`
	Text     string `json:"text,omitempty"`
	HTML     string `json:"html,omitempty"`
}

// extractDomain 从 URL 字符串中提取 host，用于匹配本地保存的 cookie。
func extractDomain(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	return u.Host
}

// buildScrapedArgs 将原始参数与抓取结果合并为新的指令参数。
func buildScrapedArgs(originalArgs string, result scrapeResponse) string {
	var sb strings.Builder
	sb.WriteString(strings.TrimSpace(originalArgs))
	sb.WriteString("\n\n【已抓取网页内容】\n")
	if result.Title != "" {
		sb.WriteString(fmt.Sprintf("- 标题：%s\n", result.Title))
	}
	if result.URL != "" {
		sb.WriteString(fmt.Sprintf("- 最终 URL：%s\n", result.URL))
	}
	sb.WriteString("\n--- 正文开始 ---\n")
	content := result.Markdown
	if content == "" {
		content = result.Text
	}
	if content == "" {
		content = result.HTML
	}
	if content == "" {
		content = "（未能成功抓取网页内容，请仅基于 URL 进行分析。）"
	}
	sb.WriteString(content)
	sb.WriteString("\n--- 正文结束 ---\n")
	return sb.String()
}

// scrapeWebsite 抓取指定 URL。
// 架构上 crawler-service 独立部署于单独服务器，dh-backend 直接通过 HTTP 调用其 /scrape 接口，
// 不再经过 gatewayd 的 MCP 聚合层（原 MCP 通道要求 crawler 与 gatewayd 同机 stdio 通信，与三服务器架构不符）。
func (h *AGUIHandler) scrapeWebsite(ctx context.Context, targetURL string, cookies []object.Cookie) (scrapeResponse, error) {
	return h.scrapeWebsiteDirect(ctx, targetURL, cookies)
}

// scrapeWebsiteDirect 直接调用 crawler-service /scrape 接口抓取指定 URL。
func (h *AGUIHandler) scrapeWebsiteDirect(ctx context.Context, targetURL string, cookies []object.Cookie) (scrapeResponse, error) {
	if h.crawlerServiceURL == "" {
		return scrapeResponse{}, fmt.Errorf("crawler service URL not configured")
	}

	timeout := h.crawlerServiceTimeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	reqBody := scrapeRequest{
		URL:      targetURL,
		Cookies:  cookies,
		MaxDepth: h.crawlerMaxDepth,
	}
	bodyData, err := json.Marshal(reqBody)
	if err != nil {
		return scrapeResponse{}, fmt.Errorf("marshal scrape request: %w", err)
	}

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, h.crawlerServiceURL+"/scrape", bytes.NewReader(bodyData))
	if err != nil {
		return scrapeResponse{}, fmt.Errorf("create scrape request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return scrapeResponse{}, fmt.Errorf("call crawler-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return scrapeResponse{}, fmt.Errorf("crawler-service returned %d: %s", resp.StatusCode, string(body))
	}

	var result scrapeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return scrapeResponse{}, fmt.Errorf("decode scrape response: %w", err)
	}
	return result, nil
}
