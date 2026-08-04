package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

// prdAnalysisCommand 是网站分析与 PRD 生成指令名。
const prdAnalysisCommand = "/prd-analysis"

// prdAnalysisScrapeRequest 是调用 crawler-service /scrape 的请求体。
type prdAnalysisScrapeRequest struct {
	URL      string          `json:"url"`
	Cookies  []object.Cookie `json:"cookies,omitempty"`
	MaxPages int             `json:"maxPages,omitempty"`
}

// prdAnalysisScrapeResponse 是 crawler-service /scrape 的响应体。
type prdAnalysisScrapeResponse struct {
	URL      string `json:"url"`
	Title    string `json:"title,omitempty"`
	Markdown string `json:"markdown,omitempty"`
	Text     string `json:"text,omitempty"`
	HTML     string `json:"html,omitempty"`
}

// tryAugmentPRDAnalysisMessage 检测最后一条用户消息是否为 /prd-analysis 指令。
// 若匹配则调用 crawler-service 抓取目标网站，并将抓取结果追加到用户消息参数中，
// 供后续 interceptCommands 渲染 /prd-analysis 模板时使用。
// 返回 (是否命中, 是否发生致命错误需终止 run)。
func (h *AGUIHandler) tryAugmentPRDAnalysisMessage(r *http.Request, messages []agui.Message, workspaceID, runID string) (matched bool, abort bool) {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original == "" {
			original = rawText
		}
		cmd, args, ok := parseSlashCommand(original)
		if !ok || cmd != prdAnalysisCommand {
			return false, false
		}

		// 从参数中提取目标 URL。
		targetURL := strings.TrimSpace(args)
		if targetURL == "" {
			return true, false
		}
		if _, err := url.Parse(targetURL); err != nil {
			log.Printf("[AGUIHandler] run=%s invalid prd-analysis url: %v", runID, err)
			return true, false
		}

		// 读取用户预存的 cookie（如未预登录则为空）。
		userID, _ := middleware.UserIDFromContext(r.Context())
		domain := extractDomain(targetURL)
		var cookies []object.Cookie
		if h.crawlerCookieSvc != nil && userID != "" && workspaceID != "" && domain != "" {
			loaded, err := h.crawlerCookieSvc.Load(userID, workspaceID, domain)
			if err != nil {
				log.Printf("[AGUIHandler] run=%s load crawler cookies failed: %v", runID, err)
			} else {
				cookies = loaded
				log.Printf("[AGUIHandler] run=%s loaded %d cookies for domain %s", runID, len(cookies), domain)
			}
		}

		// 调用 crawler-service 抓取网页。
		scrapeResult, err := h.scrapeWebsite(r.Context(), targetURL, cookies)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s scrape website failed: %v", runID, err)
			// 抓取失败不终止 run：模板中可提示 agent 仅基于 URL 分析。
			scrapeResult = prdAnalysisScrapeResponse{URL: targetURL}
		}

		// 将抓取结果追加到用户消息参数中。
		augmentedArgs := buildPRDAnalysisArgs(args, scrapeResult)
		augmented := cmd + " " + augmentedArgs
		data, err := json.Marshal(augmented)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s marshal augmented prd-analysis message failed: %v", runID, err)
			return true, false
		}
		messages[i].Content = json.RawMessage(data)
		log.Printf("[AGUIHandler] run=%s prd-analysis message augmented, url=%s title=%q markdownLen=%d",
			runID, scrapeResult.URL, scrapeResult.Title, len(scrapeResult.Markdown))
		return true, false
	}
	return false, false
}

// extractDomain 从 URL 字符串中提取 host，用于匹配本地保存的 cookie。
func extractDomain(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	return u.Host
}

// buildPRDAnalysisArgs 将原始参数与抓取结果合并为新的指令参数。
func buildPRDAnalysisArgs(originalArgs string, result prdAnalysisScrapeResponse) string {
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
// 若配置了 crawler MCP server，优先通过 gatewayd MCP 聚合层调用；失败则回退到直连 crawler-service。
func (h *AGUIHandler) scrapeWebsite(ctx context.Context, targetURL string, cookies []object.Cookie) (prdAnalysisScrapeResponse, error) {
	if h.crawlerMCPName != "" && h.gatewaydAdminURL != "" {
		result, err := h.scrapeWebsiteViaMCP(ctx, targetURL, cookies)
		if err == nil {
			log.Printf("[AGUIHandler] scraped via MCP crawler=%s url=%s", h.crawlerMCPName, targetURL)
			return result, nil
		}
		log.Printf("[AGUIHandler] MCP scrape failed, fallback to direct crawler-service: %v", err)
	}
	return h.scrapeWebsiteDirect(ctx, targetURL, cookies)
}

// scrapeWebsiteViaMCP 通过 gatewayd MCP 聚合层调用 crawler:scrape。
func (h *AGUIHandler) scrapeWebsiteViaMCP(ctx context.Context, targetURL string, cookies []object.Cookie) (prdAnalysisScrapeResponse, error) {
	timeout := h.crawlerServiceTimeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := map[string]any{
		"url":      targetURL,
		"cookies":  cookies,
		"maxPages": 1,
	}
	bodyData, err := json.Marshal(map[string]any{"arguments": args})
	if err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("marshal mcp scrape request: %w", err)
	}

	url := fmt.Sprintf("%s/mcp/tools/%s:scrape", h.gatewaydAdminURL, h.crawlerMCPName)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(bodyData))
	if err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("create mcp scrape request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("call mcp tool: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return prdAnalysisScrapeResponse{}, fmt.Errorf("mcp tool returned %d: %s", resp.StatusCode, string(body))
	}

	// gatewayd 返回 { result: { content: [{type:"text", text:"..."}], isError?: bool } }
	var wrapper struct {
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapper); err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("decode mcp scrape response: %w", err)
	}
	if wrapper.Result.IsError || len(wrapper.Result.Content) == 0 {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("mcp scrape returned error or empty content")
	}

	var result prdAnalysisScrapeResponse
	text := wrapper.Result.Content[0].Text
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("parse mcp scrape tool result: %w", err)
	}
	return result, nil
}

// scrapeWebsiteDirect 直接调用 crawler-service /scrape 接口抓取指定 URL。
func (h *AGUIHandler) scrapeWebsiteDirect(ctx context.Context, targetURL string, cookies []object.Cookie) (prdAnalysisScrapeResponse, error) {
	if h.crawlerServiceURL == "" {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("crawler service URL not configured")
	}

	timeout := h.crawlerServiceTimeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	reqBody := prdAnalysisScrapeRequest{
		URL:      targetURL,
		Cookies:  cookies,
		MaxPages: 1,
	}
	bodyData, err := json.Marshal(reqBody)
	if err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("marshal scrape request: %w", err)
	}

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, h.crawlerServiceURL+"/scrape", bytes.NewReader(bodyData))
	if err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("create scrape request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("call crawler-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return prdAnalysisScrapeResponse{}, fmt.Errorf("crawler-service returned %d: %s", resp.StatusCode, string(body))
	}

	var result prdAnalysisScrapeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return prdAnalysisScrapeResponse{}, fmt.Errorf("decode scrape response: %w", err)
	}
	return result, nil
}
