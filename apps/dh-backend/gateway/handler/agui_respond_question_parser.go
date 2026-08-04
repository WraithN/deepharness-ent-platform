package handler

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
)

// fallbackQuestionOption 是 fallback 解析出的问题选项。
type fallbackQuestionOption struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Value       string `json:"value,omitempty"`
}

// fallbackQuestion 是 fallback 解析出的单条问题。
type fallbackQuestion struct {
	Question string                   `json:"question"`
	Options  []fallbackQuestionOption `json:"options,omitempty"`
}

// fallbackQuestionPayload 是 synthetic agent.question 自定义事件的 value 负载。
// 与前端 use-ag-ui-chat.ts 中 parseQuestionValue 的期望保持一致：
// instanceId / threadId / questions（含 question 与 options）。
type fallbackQuestionPayload struct {
	InstanceID string             `json:"instanceId"`
	ThreadID   string             `json:"threadId"`
	Questions  []fallbackQuestion `json:"questions"`
}

// 解析失败时限制展示长度，避免把整段分析文本当成问题正文。
const maxFallbackQuestionLength = 400

// 常见的英文分析/行动开头，若问题文本以这些开头说明不是真正的问题。
var invalidQuestionPrefixes = []string{
	"the user wants",
	"let me",
	"i need to",
	"i will",
	"i should",
	"i think",
	"i'll",
	"now i",
	"first,",
	"next,",
	"so i",
	"to answer",
	"based on",
	"according to",
	"the user is asking",
	"the user is clarifying",
}

// 代码/文件内容常见标记，若问题文本包含这些则大概率是分析或工具结果，不是澄清问题。
var codeLikeMarkers = []string{
	"```",
	"fun ",
	"func ",
	"function ",
	"const ",
	"let ",
	"var ",
	"import ",
	"export ",
	"class ",
	"interface ",
	"<",
	">",
	"| ",
	"|`,",
	"FunnelChart",
	"ChevronDown",
	"BarChart",
	"LineChart",
	"YoYComparison",
	"formatNumber",
	"formatSeconds",
	"formatPercent",
	"useMemo",
	"useState",
	"useEffect",
	"=>",
	"-> ",
}

// toEvent 将解析结果转换为 AG-UI CUSTOM 事件，name 为 agent.question。
func (q *fallbackQuestion) toEvent(threadID, runID, instanceID string) agui.Event {
	payload := fallbackQuestionPayload{
		InstanceID: instanceID,
		ThreadID:   threadID,
		Questions: []fallbackQuestion{{
			Question: q.Question,
			Options:  q.Options,
		}},
	}
	value, _ := json.Marshal(payload)
	ev := agui.NewEvent(agui.EventCustom)
	ev.Name = "agent.question"
	ev.Value = value
	ev.ThreadID = threadID
	ev.RunID = runID
	return ev
}

// formatQuestionText 把解析结果格式化为只展示问题与选项的文本。
func formatQuestionText(q *fallbackQuestion) string {
	var sb strings.Builder
	sb.WriteString(q.Question)
	sb.WriteString("\n")
	for _, opt := range q.Options {
		sb.WriteString("\n")
		if opt.Value != "" {
			sb.WriteString(opt.Value)
			sb.WriteString(". ")
		}
		sb.WriteString(opt.Label)
	}
	return sb.String()
}

// parseQuestionFromText 从 assistant 文本中尝试提取“问题 + 选项”结构。
// 策略：先找到最后一个问号，再在其后寻找 A/B/C 选项；避免在长篇分析/代码内容的开头误匹配。
// 支持选项单独成行或挤在同一行，支持 A./A、/A)/A）/A:/A：等常见标记。
// 未检测到有效问题时返回 nil。
func parseQuestionFromText(text string) *fallbackQuestion {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}

	// 找到最后一个问号或全角问号。
	lastQIdx := lastQuestionIndex(trimmed)
	if lastQIdx < 0 {
		return nil
	}

	prefix := trimmed[:lastQIdx+1]
	suffix := trimmed[lastQIdx+1:]

	// 在问号之后寻找选项。
	options := parseQuestionOptions(suffix)
	if len(options) < 2 {
		return nil
	}

	question := extractQuestionText(prefix)
	if !isValidQuestion(question) {
		return nil
	}

	return &fallbackQuestion{
		Question: question,
		Options:  options,
	}
}

// lastQuestionIndex 返回文本中最后一个 ?/？ 的下标，优先全角问号，-1 表示没有。
func lastQuestionIndex(text string) int {
	idx1 := strings.LastIndex(text, "？")
	idx2 := strings.LastIndex(text, "?")
	if idx1 < 0 {
		return idx2
	}
	if idx2 < 0 {
		return idx1
	}
	if idx1 > idx2 {
		return idx1
	}
	return idx2
}

// extractQuestionText 从问号之前的文本中提取最可能的问题正文。
// 只取最后一个非空段落，并过滤掉前面可能存在的英文推理文本。
func extractQuestionText(text string) string {
	lines := strings.Split(text, "\n")

	// 去掉尾部空行。
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return ""
	}

	// 最后一个问号已经在文本末尾，所以最后一行就是包含问号的行。
	lastIdx := len(lines) - 1

	// 向前追溯，最多再包含 2 行短的上下文，遇到空行、超长行或代码样文本时停止。
	start := lastIdx
	for i := lastIdx - 1; i >= 0 && lastIdx-i <= 2; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			start = i + 1
			break
		}
		if len(line) > 200 || looksLikeCodeOrPath(line) {
			start = i + 1
			break
		}
		start = i
	}

	question := strings.Join(lines[start:], "\n")
	return strings.TrimSpace(question)
}

// isValidQuestion 检查提取的问题文本是否像真正的澄清问题，而非分析/代码片段。
func isValidQuestion(q string) bool {
	q = strings.TrimSpace(q)
	if q == "" {
		return false
	}
	if len(q) > maxFallbackQuestionLength {
		return false
	}

	lower := strings.ToLower(q)
	for _, prefix := range invalidQuestionPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return false
		}
	}

	for _, marker := range codeLikeMarkers {
		if strings.Contains(q, marker) {
			return false
		}
	}

	// 至少包含一个 CJK 字符或至少一个半角问号，否则大概率是英文分析。
	hasCJK := false
	hasHalfQuestion := strings.Contains(q, "?")
	for _, r := range q {
		if unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) {
			hasCJK = true
			break
		}
	}
	if !hasCJK && !hasHalfQuestion {
		return false
	}

	return true
}

// looksLikeCodeOrPath 粗略判断一行是否像代码或文件路径。
func looksLikeCodeOrPath(line string) bool {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "```") {
		return true
	}
	if strings.HasPrefix(trimmed, "|") || strings.HasPrefix(trimmed, "`") {
		return true
	}
	if strings.Contains(trimmed, "{") && strings.Contains(trimmed, "}") {
		return true
	}
	if strings.Contains(trimmed, "->") || strings.Contains(trimmed, "=>") {
		return true
	}
	return false
}

// optionMarkerRegex 匹配 A./A:/A：/A、/A)/A） 等常见选项标记，捕获字母。
var optionMarkerRegex = regexp.MustCompile(`([A-Z])[:：.、）)]\s*`)

// parseQuestionOptions 从选项文本中解析选项列表。
// 支持同一行内多个 A. B. C. 选项，也支持每行一个选项。
func parseQuestionOptions(text string) []fallbackQuestionOption {
	matches := optionMarkerRegex.FindAllStringIndex(text, -1)
	if len(matches) > 0 {
		return parseLetterOptions(text, matches)
	}

	lines := strings.Split(text, "\n")
	var options []fallbackQuestionOption
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "•") || strings.HasPrefix(trimmed, "-") {
			opt := strings.TrimSpace(trimmed[1:])
			if opt != "" {
				options = append(options, fallbackQuestionOption{Label: opt})
			}
			continue
		}
		// 数字选项：1. / 1、 / 1) / 1）
		if idx := strings.IndexAny(trimmed, ".、）)"); idx > 0 {
			opt := strings.TrimSpace(trimmed[idx+1:])
			if opt != "" {
				options = append(options, fallbackQuestionOption{Label: opt})
			}
		}
	}
	return options
}

func parseLetterOptions(text string, matches [][]int) []fallbackQuestionOption {
	var options []fallbackQuestionOption
	for i, match := range matches {
		marker := strings.TrimSpace(text[match[0]:match[1]])
		letter := strings.TrimRight(marker, ` .、）).） :：`)
		start := match[1]
		end := len(text)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		content := strings.TrimSpace(text[start:end])
		if content == "" {
			continue
		}
		options = append(options, fallbackQuestionOption{
			Label: content,
			Value: letter,
		})
	}
	return options
}
