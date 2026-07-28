// Package service - group_history.go 实现飞书群历史消息拉取（场景2）。
//
// 调用飞书 Open API GET /im/v1/chats/{chat_id}/messages 拉取群消息，
// 清洗后组装为 LLM prompt 供群聊总结/需求提取使用。
// 需要飞书应用开通 im:message.history 权限。
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
)

// GroupHistoryDefaultLimit 是拉取群历史消息的默认条数上限。
const GroupHistoryDefaultLimit = 20

// GroupHistoryDefaultDuration 是拉取群历史消息的默认时间范围。
const GroupHistoryDefaultDuration = 30 * time.Minute

// groupHistoryHTTPTimeout 是调用飞书 API 的单次请求超时。
const groupHistoryHTTPTimeout = 15 * time.Second

// GroupMessage 是清洗后的飞书群消息。
type GroupMessage struct {
	SenderName string
	Content    string
	Timestamp  time.Time
}

// GroupHistoryFetcher 拉取飞书群历史消息。
type GroupHistoryFetcher struct {
	appID      string
	appSecret  string
	apiBaseURL string
	httpClient *http.Client
	token      string
	tokenExp   time.Time
}

// NewGroupHistoryFetcher 创建群历史拉取器。mock 模式下传空字符串即可（不会被调用）。
func NewGroupHistoryFetcher(appID, appSecret, apiBaseURL string) *GroupHistoryFetcher {
	return &GroupHistoryFetcher{
		appID:      appID,
		appSecret:  appSecret,
		apiBaseURL: apiBaseURL,
		httpClient: &http.Client{Timeout: groupHistoryHTTPTimeout},
	}
}

// FetchMessages 拉取指定群最近的消息列表。
// limit 为条数上限（飞书单页最多 50），duration 为时间范围上限。
func (f *GroupHistoryFetcher) FetchMessages(ctx context.Context, chatID string, limit int, duration time.Duration) ([]GroupMessage, error) {
	if limit <= 0 {
		limit = GroupHistoryDefaultLimit
	}
	if duration <= 0 {
		duration = GroupHistoryDefaultDuration
	}

	if err := f.ensureToken(); err != nil {
		return nil, fmt.Errorf("ensure token: %w", err)
	}

	// 飞书 API 使用毫秒时间戳过滤
	startTime := strconv.FormatInt(time.Now().Add(-duration).UnixMilli(), 10)
	url := fmt.Sprintf("%s/im/v1/chats/%s/messages?page_size=%d&start_time=%s&sort_type=ByCreateTime",
		f.apiBaseURL, chatID, min50(limit), startTime)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+f.token)

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch messages: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("feishu api status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Items []struct {
				MsgType   string `json:"msg_type"`
				Body      struct {
					Content string `json:"content"`
				} `json:"body"`
				Sender struct {
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"sender"`
				CreateTime string `json:"create_time"`
			} `json:"items"`
			HasMore bool `json:"has_more"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if result.Code != 0 {
		return nil, fmt.Errorf("feishu api error code=%d msg=%s", result.Code, result.Msg)
	}

	// 过滤文本消息并清洗
	msgs := make([]GroupMessage, 0, len(result.Data.Items))
	for _, item := range result.Data.Items {
		if item.MsgType != "text" {
			continue
		}
		// 解析 content JSON 获取文本
		var content struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(item.Body.Content), &content); err != nil {
			continue
		}
		if strings.TrimSpace(content.Text) == "" {
			continue
		}
		ts := parseFeishuTimestamp(item.CreateTime)
		msgs = append(msgs, GroupMessage{
			SenderName: item.Sender.Name,
			Content:    content.Text,
			Timestamp:  ts,
		})
		if len(msgs) >= limit {
			break
		}
	}

	log.Printf("[Feishu] group history fetched chatId=%s total=%d filtered=%d", chatID, len(result.Data.Items), len(msgs))
	return msgs, nil
}

// BuildSummaryPrompt 将群消息列表组装为 LLM prompt。
// 根据意图选择不同的 prompt 模板。
func BuildSummaryPrompt(messages []GroupMessage, intent object.Intent, userRequest string) string {
	var sb strings.Builder

	// 组装群聊上下文
	sb.WriteString("以下是群聊消息记录：\n\n")
	for _, m := range messages {
		sb.WriteString(fmt.Sprintf("[%s] %s: %s\n", m.Timestamp.Format("15:04:05"), m.SenderName, m.Content))
	}
	sb.WriteString("\n\n")

	// 根据意图选择指令
	switch intent {
	case object.IntentGroupSummary:
		sb.WriteString("请总结以上群聊内容，输出会议纪要格式：\n")
		sb.WriteString("1. 主要讨论话题\n2. 关键决策\n3. 待办事项\n")
	case object.IntentRequirement:
		sb.WriteString("请根据以上群聊讨论，提取需求卡片：\n")
		sb.WriteString("1. 需求背景\n2. 目标\n3. 验收标准\n4. 优先级建议\n")
	case object.IntentPrototype:
		sb.WriteString("请根据以上讨论，设计原型描述：\n")
		sb.WriteString("1. 页面结构\n2. 核心字段\n3. 交互流程\n4. 关键状态\n")
	default:
		sb.WriteString("请总结以上群聊内容。\n")
	}

	if userRequest != "" {
		sb.WriteString(fmt.Sprintf("\n用户补充要求：%s\n", userRequest))
	}

	return sb.String()
}

// ensureToken 获取或刷新 tenant_access_token。
func (f *GroupHistoryFetcher) ensureToken() error {
	if f.token != "" && time.Now().Before(f.tokenExp) {
		return nil
	}

	body, _ := json.Marshal(map[string]string{
		"app_id":     f.appID,
		"app_secret": f.appSecret,
	})
	url := f.apiBaseURL + "/auth/v3/tenant_access_token/internal"
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request token: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code              int    `json:"code"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int    `json:"expire"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode token response: %w", err)
	}
	if result.Code != 0 {
		return fmt.Errorf("feishu token error code=%d", result.Code)
	}

	f.token = result.TenantAccessToken
	f.tokenExp = time.Now().Add(time.Duration(result.Expire)*time.Second - cardTokenRefreshLeadTime)
	return nil
}

// parseFeishuTimestamp 将飞书时间戳（秒或毫秒字符串）解析为 time.Time。
func parseFeishuTimestamp(s string) time.Time {
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1e12 {
			return time.UnixMilli(n)
		}
		return time.Unix(n, 0)
	}
	return time.Now()
}

// min50 返回 limit 和 50 中的较小值（飞书单页最多 50 条）。
func min50(limit int) int {
	if limit > 50 {
		return 50
	}
	return limit
}
