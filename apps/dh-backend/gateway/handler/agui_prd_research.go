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
			return true, false
		}
		if _, err := url.Parse(targetURL); err != nil {
			log.Printf("[AGUIHandler] run=%s invalid prd-research url: %v", runID, err)
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
			scrapeResult = prdAnalysisScrapeResponse{URL: targetURL}
		}

		augmentedArgs := buildPRDAnalysisArgs(args, scrapeResult)
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

// parsePRDResearchArgs 从指令参数中提取目标 URL 和用户内联的 cookie。
// 支持的 cookie 格式：ck:name=value 或 Cookie:name=value。
func parsePRDResearchArgs(args string) (targetURL string, inlineCookies []object.Cookie) {
	tokens := splitArgsTokens(args)
	if len(tokens) == 0 {
		return "", nil
	}
	targetURL = strings.TrimSpace(tokens[0])
	for i := 1; i < len(tokens); i++ {
		token := strings.TrimSpace(tokens[i])
		name, value, ok := parseInlineCookie(token)
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
	return targetURL, inlineCookies
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
