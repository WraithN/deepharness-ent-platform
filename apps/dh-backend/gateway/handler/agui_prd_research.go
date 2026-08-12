package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

const prdResearchCommand = "/prd-research"

const maxInlineCookies = 20

// 系统提示词模板中的参数标签（兼容全角/半角冒号），与前端内置提示词模板保持一致。
var (
	researchLinkLabels = []string{"调研链接：", "调研链接:"}
	researchCookieLabels = []string{"登录Cookie：", "登录Cookie:", "登录cookie：", "登录cookie:"}
)

// tryAugmentPRDResearchMessage 检测最后一条用户消息是否为 /prd-research 指令。
// 若参数中包含有效产品链接，则调用 crawler-service 抓取目标网站，并将抓取结果追加到用户消息参数中，
// 供后续 interceptCommands 渲染 /prd-research 模板时使用；仅产品名称（无链接）时不抓取，直接渲染模板。
// 返回 (是否命中, 是否发生致命错误需终止 run)。
func (h *AGUIHandler) tryAugmentPRDResearchMessage(r *http.Request, messages []agui.Message, workspaceID, runID string) (matched bool, abort bool) {
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
		if !ok || cmd != prdResearchCommand {
			return false, false
		}

		targetURL, inlineCookies := parsePRDResearchArgs(args)
		if targetURL == "" {
			// 仅产品名称场景：无链接可抓取，按原参数渲染模板即可。
			return true, false
		}

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
		cookies = mergeCookies(cookies, inlineCookies, domain)

		scrapeResult, err := h.scrapeWebsite(r.Context(), targetURL, cookies)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s prd-research scrape failed: %v", runID, err)
			scrapeResult = scrapeResponse{URL: targetURL}
		}

		augmentedArgs := buildScrapedArgs(args, scrapeResult)
		augmented := cmd + " " + augmentedArgs
		data, err := json.Marshal(augmented)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s marshal augmented prd-research message failed: %v", runID, err)
			return true, false
		}
		messages[i].Content = json.RawMessage(data)
		log.Printf("[AGUIHandler] run=%s prd-research message augmented, url=%s title=%q markdownLen=%d cookies=%d",
			runID, scrapeResult.URL, scrapeResult.Title, len(scrapeResult.Markdown), len(cookies))
		return true, false
	}
	return false, false
}

// parsePRDResearchArgs 从指令参数中提取目标 URL 与登录 Cookie。
// 兼容两种输入格式：
//  1. 系统提示词模板格式（多行）：「调研链接：<URL>」与「登录Cookie：<name=value; ...>」；
//  2. 裸参数格式：首个 token 为 URL，后续 ck:/cookie: 前缀 token 为 Cookie。
// 仅提供产品名称（无有效链接）时返回空 targetURL，调用方跳过抓取。
func parsePRDResearchArgs(args string) (targetURL string, inlineCookies []object.Cookie) {
	if link := normalizeResearchURL(extractLabeledLine(args, researchLinkLabels)); link != "" {
		return link, parseCookieString(extractLabeledLine(args, researchCookieLabels))
	}
	// 裸参数兼容路径：首 token 需是合法 URL，否则视为仅产品名称调研。
	tokens := splitArgsTokens(args)
	if len(tokens) == 0 {
		return "", nil
	}
	link := normalizeResearchURL(tokens[0])
	if link == "" {
		return "", nil
	}
	for i := 1; i < len(tokens); i++ {
		name, value, ok := parseInlineCookie(strings.TrimSpace(tokens[i]))
		if !ok {
			continue
		}
		inlineCookies = append(inlineCookies, object.Cookie{
			Name:  name,
			Value: value,
		})
		if len(inlineCookies) >= maxInlineCookies {
			break
		}
	}
	return link, inlineCookies
}

// extractLabeledLine 返回多行文本中首个以指定标签开头的行的标签后内容（去空白）。
func extractLabeledLine(text string, labels []string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		for _, label := range labels {
			if strings.HasPrefix(line, label) {
				return strings.TrimSpace(strings.TrimPrefix(line, label))
			}
		}
	}
	return ""
}

// normalizeResearchURL 校验并归一化目标链接：无 scheme 时补 https://；
// 非 http(s) 链接或不含域名字符（如产品名称、未替换的模板参数）返回空。
func normalizeResearchURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || !strings.Contains(u.Host, ".") {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	return raw
}

// parseCookieString 解析「name=value; name2=value2」格式的 Cookie 字符串。
func parseCookieString(s string) []object.Cookie {
	var cookies []object.Cookie
	for _, part := range strings.Split(s, ";") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || name == "" || value == "" {
			continue
		}
		cookies = append(cookies, object.Cookie{Name: name, Value: value})
		if len(cookies) >= maxInlineCookies {
			break
		}
	}
	return cookies
}

func splitArgsTokens(args string) []string {
	var tokens []string
	inQuote := false
	quoteChar := byte(0)
	current := strings.Builder{}

	runes := []byte(args)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if inQuote {
			if c == quoteChar {
				inQuote = false
			} else {
				current.WriteByte(c)
			}
			continue
		}
		if c == '"' || c == '\'' {
			inQuote = true
			quoteChar = c
			continue
		}
		if c == ' ' || c == '\t' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			continue
		}
		current.WriteByte(c)
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

func parseInlineCookie(token string) (name string, value string, ok bool) {
	prefixes := []string{"ck:", "CK:", "ci:", "cookie:", "Cookie:", "COOKIE:"}
	rest := ""
	for _, p := range prefixes {
		if strings.HasPrefix(token, p) {
			rest = token[len(p):]
			break
		}
	}
	if rest == "" {
		return "", "", false
	}
	eqIdx := strings.IndexByte(rest, '=')
	if eqIdx <= 0 || eqIdx == len(rest)-1 {
		return "", "", false
	}
	name = rest[:eqIdx]
	value = rest[eqIdx+1:]
	return name, value, true
}

func mergeCookies(saved, inline []object.Cookie, domain string) []object.Cookie {
	if len(inline) == 0 {
		return saved
	}
	merged := make(map[string]object.Cookie, len(saved)+len(inline))
	for _, c := range saved {
		merged[c.Name] = c
	}
	for _, c := range inline {
		cc := c
		if cc.Domain == "" {
			cc.Domain = domain
		}
		merged[cc.Name] = cc
	}
	result := make([]object.Cookie, 0, len(merged))
	for _, c := range merged {
		result = append(result, c)
	}
	return result
}
