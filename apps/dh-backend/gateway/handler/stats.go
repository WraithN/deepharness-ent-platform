package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

const (
	statsTrendDays       = 7
	statsTrailLimit      = 50
	statsTrailMsgLimit   = 100
)

// WorkItemStatsSvc 定义工作项统计所需的服务接口。
type WorkItemStatsSvc interface {
	CountWorkItems(projectID string, status workitem.Status, days int) (int, error)
	CountWorkItemsPrevPeriod(projectID string, status workitem.Status, days int) (int, error)
}

// StatsHandler 处理数据大盘统计请求。
type StatsHandler struct {
	sessions      chat.SessionStore
	messages      chat.MessageStore
	workspaceRoot string
	workspaceSvc  workspaceservice.WorkspaceService
	workItemSvc   WorkItemStatsSvc
}

// NewStatsHandler 创建统计 handler。
// messages 用于成员会话轨迹详情拉取历史消息（跨用户但按 workspace 隔离）。
func NewStatsHandler(sessions chat.SessionStore, messages chat.MessageStore, workspaceRoot string, workspaceSvc workspaceservice.WorkspaceService, workItemSvc WorkItemStatsSvc) *StatsHandler {
	return &StatsHandler{sessions: sessions, messages: messages, workspaceRoot: workspaceRoot, workspaceSvc: workspaceSvc, workItemSvc: workItemSvc}
}

// SummaryResponse 统计卡片响应。
type SummaryResponse struct {
	ThisWeek int `json:"thisWeek"`
	LastWeek int `json:"lastWeek"`
	// DeltaPercent 较上周变化百分比（上周为 0 时返回 0）。
	DeltaPercent int `json:"deltaPercent"`
}

// TrendResponse 会话趋势响应。
type TrendResponse struct {
	Data []chat.DateCount `json:"data"`
}

// TrailsResponse 会话轨迹响应。
type TrailsResponse struct {
	Data []chat.SessionTrailInfo `json:"data"`
}

func workspaceIDFromQuery(r *http.Request) (string, error) {
	id := r.URL.Query().Get("workspaceId")
	if id == "" {
		return "", errors.New("workspaceId is required")
	}
	return id, nil
}

// Summary 处理 GET /api/v1/stats/summary 请求。
// 返回本周会话数、上周会话数、较上周变化百分比。
func (h *StatsHandler) Summary(w http.ResponseWriter, r *http.Request) {
	// 取 14 天趋势数据，前 7 天为上周，后 7 天为本周。
	workspaceID, err := workspaceIDFromQuery(r)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, err.Error())
		return
	}
	trend, err := h.sessions.GetSessionTrend(r.Context(), workspaceID, statsTrendDays*2)
	if err != nil {
		log.Printf("[Stats] GetSessionTrend for summary failed: %v", err)
	}

	thisWeek, lastWeek := splitWeekCounts(trend)
	delta := computeDeltaPercent(thisWeek, lastWeek)

	resp := SummaryResponse{
		ThisWeek:     thisWeek,
		LastWeek:     lastWeek,
		DeltaPercent: delta,
	}

	writeJSON(w, resp)
}

// Trend 处理 GET /api/v1/stats/trend 请求。
// 返回最近 7 天每天的会话创建数量。
func (h *StatsHandler) Trend(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := workspaceIDFromQuery(r)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, err.Error())
		return
	}
	data, err := h.sessions.GetSessionTrend(r.Context(), workspaceID, statsTrendDays)
	if err != nil {
		log.Printf("[Stats] GetSessionTrend failed: %v", err)
		data = []chat.DateCount{}
	}

	writeJSON(w, TrendResponse{Data: data})
}

// CodeCommits 处理 GET /api/v1/stats/commits 请求。
// 扫描指定工作空间根目录下的所有 git 仓库，统计最近 7 天每天的代码提交数量。
func (h *StatsHandler) CodeCommits(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := workspaceIDFromQuery(r)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, err.Error())
		return
	}
	data, err := h.getCodeCommitTrend(r.Context(), workspaceID, statsTrendDays)
	if err != nil {
		log.Printf("[Stats] getCodeCommitTrend failed: %v", err)
		data = emptyDateTrend(statsTrendDays)
	}

	writeJSON(w, TrendResponse{Data: data})
}

// Trails 处理 GET /api/v1/stats/trails 请求。
// 返回指定工作空间最近的会话轨迹（含消息数量），按更新时间倒序。
func (h *StatsHandler) Trails(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := workspaceIDFromQuery(r)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, err.Error())
		return
	}
	data, err := h.sessions.GetSessionTrails(r.Context(), workspaceID, statsTrailLimit)
	if err != nil {
		log.Printf("[Stats] GetSessionTrails failed: %v", err)
		data = []chat.SessionTrailInfo{}
	}

	writeJSON(w, TrailsResponse{Data: data})
}

// TrailMessages 处理 GET /api/v1/stats/trails/{sessionId}/messages 请求。
// 返回指定会话的历史消息，用于数据大盘成员会话轨迹详情的信息流展示。
// 与 /sessions/{id}/messages 不同：此处允许跨用户读取（大盘场景需查看他人会话），
// 但严格按 workspaceId 隔离，确保只能读取当前工作空间内的会话。
func (h *StatsHandler) TrailMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, ErrCodeGeneral, "method not allowed")
		return
	}

	workspaceID, err := workspaceIDFromQuery(r)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, err.Error())
		return
	}

	sessionID := r.PathValue("sessionId")
	if sessionID == "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, "missing sessionId")
		return
	}

	if h.messages == nil {
		writeJSON(w, []chat.Message{})
		return
	}

	// 校验会话存在且属于当前工作空间，防止跨空间读取。
	sess, err := h.sessions.Get(r.Context(), sessionID)
	if err != nil {
		WriteJSONError(w, http.StatusNotFound, ErrCodeGeneral, "session not found")
		return
	}
	if sess.WorkspaceID != "" && sess.WorkspaceID != workspaceID {
		WriteJSONError(w, http.StatusForbidden, ErrCodeGeneral, "session not in this workspace")
		return
	}

	messages, err := h.messages.GetHistory(r.Context(), sessionID, statsTrailMsgLimit)
	if err != nil {
		log.Printf("[Stats] GetHistory for trail %s failed: %v", sessionID, err)
		writeJSON(w, []chat.Message{})
		return
	}
	if messages == nil {
		messages = []chat.Message{}
	}

	// 兼容历史数据：提取用户消息的原始输入，与 /sessions/{id}/messages 行为一致。
	for i := range messages {
		if messages[i].Role != "user" {
			continue
		}
		original := extractOriginalUserPrompt(messages[i].Content)
		if original == "" {
			continue
		}
		if messages[i].Metadata == nil {
			messages[i].Metadata = map[string]any{}
		}
		messages[i].Metadata["originalText"] = original
	}

	writeJSON(w, messages)
}

// splitWeekCounts 将 14 天趋势数据拆分为本周（后 7 天）和上周（前 7 天）的总会话数。
func splitWeekCounts(trend []chat.DateCount) (thisWeek, lastWeek int) {
	n := len(trend)
	mid := n - statsTrendDays
	if mid < 0 {
		mid = 0
	}
	for i := 0; i < n; i++ {
		if i < mid {
			lastWeek += trend[i].Count
		} else {
			thisWeek += trend[i].Count
		}
	}
	return
}

// computeDeltaPercent 计算较上周的变化百分比。上周为 0 时返回 0。
func computeDeltaPercent(thisWeek, lastWeek int) int {
	if lastWeek == 0 {
		return 0
	}
	return (thisWeek - lastWeek) * 100 / lastWeek
}

// getCodeCommitTrend 扫描指定工作空间目录下的 git 仓库，返回最近 days 天每天的提交数量。
// 通过 git log --all --no-merges --since 统计每个仓库的提交日期，汇总后按天聚合。
// 目录结构：WORKSPACE_ROOT/{userID}/{workspaceID}/...，需遍历所有用户目录下的 workspaceID 子目录。
// 架构合规：通过 stubclient 委托 personal-stub 遍历目录和检查文件，不直接访问文件系统。
func (h *StatsHandler) getCodeCommitTrend(ctx context.Context, workspaceID string, days int) ([]chat.DateCount, error) {
	counts := make(map[string]int)

	if h.workspaceRoot != "" {
		since := fmt.Sprintf("%d days ago", days)
		sc := stubclient.FromContext(ctx)
		if sc == nil {
			return buildDateTrend(days, counts), nil
		}
		// 新目录结构下 workspaceID 在各用户目录下，通过 glob 匹配所有 {workspaceRoot}/{userID}/{workspaceID}
		wsPattern := filepath.Join(h.workspaceRoot, "*", workspaceID)
		wsDirs, _ := sc.Glob(ctx, wsPattern)
		for _, workspaceDir := range wsDirs {
			walkEntries, walkErr := sc.WalkDir(ctx, workspaceDir)
			if walkErr != nil {
				continue
			}
			// skipPrefixes 记录已处理的 git 仓库前缀，模拟 filepath.SkipDir 行为。
			skipPrefixes := []string{}
			for _, we := range walkEntries {
				if !we.IsDir {
					continue
				}
				skipped := false
				for _, prefix := range skipPrefixes {
					if strings.HasPrefix(we.Path, prefix) {
						skipped = true
						break
					}
				}
				if skipped {
					continue
				}
				gitDir := filepath.Join(we.Path, ".git")
				ok, _ := sc.FileExists(ctx, gitDir)
				if !ok {
					continue
				}

				out, execErr := execGitLogDates(ctx, we.Path, since)
				if execErr != nil {
					log.Printf("[Stats] git log failed for %s: %v", we.Path, execErr)
					skipPrefixes = append(skipPrefixes, we.Path+string(filepath.Separator))
					continue
				}
				for _, line := range strings.Split(out, "\n") {
					line = strings.TrimSpace(line)
					if line == "" {
						continue
					}
					counts[line]++
				}
				// 找到 git 仓库后跳过其子目录
				skipPrefixes = append(skipPrefixes, we.Path+string(filepath.Separator))
			}
		}
	}

	return buildDateTrend(days, counts), nil
}

// execGitLogDates 在指定 git 仓库中执行 log 命令，返回最近 since 天内每条提交的短日期（YYYY-MM-DD）。
// 架构合规：通过 stubclient 委托 personal-stub 执行 git 命令，不直接 exec git。
func execGitLogDates(ctx context.Context, dir, since string) (string, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return "", errors.New("personal-stub client not initialized")
	}
	out, err := sc.GitExec(ctx, dir, "log", "--all", "--no-merges", "--since="+since, "--format=%as")
	if err != nil {
		return "", fmt.Errorf("git log failed: %w (output: %s)", err, out)
	}
	return out, nil
}

// buildDateTrend 根据日期计数构造最近 days 天的趋势数组（升序，含零填充）。
func buildDateTrend(days int, counts map[string]int) []chat.DateCount {
	result := make([]chat.DateCount, days)
	now := time.Now()
	for i := 0; i < days; i++ {
		d := now.AddDate(0, 0, -(days - 1 - i)).Format("2006-01-02")
		result[i] = chat.DateCount{Date: d, Count: counts[d]}
	}
	return result
}

// emptyDateTrend 构造最近 days 天的零值趋势数组。
func emptyDateTrend(days int) []chat.DateCount {
	return buildDateTrend(days, nil)
}

// requirementsSummaryCache 缓存最近一次工作项统计结果以避免重复查询。
// 使用 sync.RWMutex 保护，防止并发 HTTP 请求导致数据竞争。
var requirementsSummaryCache struct {
	mu         sync.RWMutex
	workspaceID string
	result      SummaryResponse
	expiresAt   time.Time
}

var requirementsCacheTTL = 30 * time.Second

// WorkItemSummary 处理 GET /api/v1/stats/requirements 请求。
// 返回近7天"需求完成"数量（状态为 done 的需求）及较上周变化百分比。
func (h *StatsHandler) WorkItemSummary(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := workspaceIDFromQuery(r)
	if err != nil {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, err.Error())
		return
	}

	if h.workspaceSvc == nil || h.workItemSvc == nil {
		writeJSON(w, SummaryResponse{ThisWeek: 0, LastWeek: 0, DeltaPercent: 0})
		return
	}

	// 读缓存（读锁）
	requirementsSummaryCache.mu.RLock()
	cached := requirementsSummaryCache.workspaceID == workspaceID && time.Now().Before(requirementsSummaryCache.expiresAt)
	cachedResult := requirementsSummaryCache.result
	requirementsSummaryCache.mu.RUnlock()
	if cached {
		writeJSON(w, cachedResult)
		return
	}

	wp, err := h.workspaceSvc.GetWorkitemProject(workspaceID)
	if err != nil {
		writeJSON(w, SummaryResponse{ThisWeek: 0, LastWeek: 0, DeltaPercent: 0})
		return
	}

	thisWeek, err := h.workItemSvc.CountWorkItems(wp.ExternalKey, workitem.StatusDone, statsTrendDays)
	if err != nil {
		log.Printf("[Stats] CountWorkItems failed: %v", err)
		thisWeek = 0
	}

	lastWeek, err := h.workItemSvc.CountWorkItemsPrevPeriod(wp.ExternalKey, workitem.StatusDone, statsTrendDays)
	if err != nil {
		log.Printf("[Stats] CountWorkItemsPrevPeriod failed: %v", err)
		lastWeek = 0
	}

	delta := computeDeltaPercent(thisWeek, lastWeek)
	resp := SummaryResponse{ThisWeek: thisWeek, LastWeek: lastWeek, DeltaPercent: delta}

	// 写缓存（写锁）
	requirementsSummaryCache.mu.Lock()
	requirementsSummaryCache.workspaceID = workspaceID
	requirementsSummaryCache.result = resp
	requirementsSummaryCache.expiresAt = time.Now().Add(requirementsCacheTTL)
	requirementsSummaryCache.mu.Unlock()

	writeJSON(w, resp)
}

// writeJSON 将响应以 JSON 格式写入 HTTP 响应。
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Stats] encode response failed: %v", err)
	}
}
