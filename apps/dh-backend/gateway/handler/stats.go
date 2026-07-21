package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

const (
	statsTrendDays  = 7
	statsTrailLimit = 50
)

// WorkItemStatsSvc 定义工作项统计所需的服务接口。
type WorkItemStatsSvc interface {
	CountWorkItems(projectID string, status workitem.Status, days int) (int, error)
	CountWorkItemsPrevPeriod(projectID string, status workitem.Status, days int) (int, error)
}

// StatsHandler 处理数据大盘统计请求。
type StatsHandler struct {
	sessions      chat.SessionStore
	workspaceRoot string
	workspaceSvc  workspaceservice.WorkspaceService
	workItemSvc   WorkItemStatsSvc
}

// NewStatsHandler 创建统计 handler。
func NewStatsHandler(sessions chat.SessionStore, workspaceRoot string, workspaceSvc workspaceservice.WorkspaceService, workItemSvc WorkItemStatsSvc) *StatsHandler {
	return &StatsHandler{sessions: sessions, workspaceRoot: workspaceRoot, workspaceSvc: workspaceSvc, workItemSvc: workItemSvc}
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
		WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
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
		WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
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
		WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
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
		WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
		return
	}
	data, err := h.sessions.GetSessionTrails(r.Context(), workspaceID, statsTrailLimit)
	if err != nil {
		log.Printf("[Stats] GetSessionTrails failed: %v", err)
		data = []chat.SessionTrailInfo{}
	}

	writeJSON(w, TrailsResponse{Data: data})
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
func (h *StatsHandler) getCodeCommitTrend(ctx context.Context, workspaceID string, days int) ([]chat.DateCount, error) {
	counts := make(map[string]int)

	workspaceDir := ""
	if h.workspaceRoot != "" {
		workspaceDir = filepath.Join(h.workspaceRoot, workspaceID)
	}
	if workspaceDir != "" {
		since := fmt.Sprintf("%d days ago", days)
		err := filepath.WalkDir(workspaceDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || !d.IsDir() {
				return nil
			}
			gitDir := filepath.Join(path, ".git")
			if _, statErr := os.Stat(gitDir); statErr != nil {
				return nil
			}

			out, execErr := execGitLogDates(ctx, path, since)
			if execErr != nil {
				log.Printf("[Stats] git log failed for %s: %v", path, execErr)
				return filepath.SkipDir
			}
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				counts[line]++
			}
			return filepath.SkipDir
		})
		if err != nil {
			return nil, err
		}
	}

	return buildDateTrend(days, counts), nil
}

// execGitLogDates 在指定 git 仓库中执行 log 命令，返回最近 since 天内每条提交的短日期（YYYY-MM-DD）。
func execGitLogDates(ctx context.Context, dir, since string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", dir, "log", "--all", "--no-merges", "--since="+since, "--format=%as")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git log failed: %w (output: %s)", err, string(out))
	}
	return string(out), nil
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
var requirementsSummaryCache struct {
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
		WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
		return
	}

	if h.workspaceSvc == nil || h.workItemSvc == nil {
		writeJSON(w, SummaryResponse{ThisWeek: 0, LastWeek: 0, DeltaPercent: 0})
		return
	}

	if requirementsSummaryCache.workspaceID == workspaceID && time.Now().Before(requirementsSummaryCache.expiresAt) {
		writeJSON(w, requirementsSummaryCache.result)
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

	requirementsSummaryCache.workspaceID = workspaceID
	requirementsSummaryCache.result = resp
	requirementsSummaryCache.expiresAt = time.Now().Add(requirementsCacheTTL)

	writeJSON(w, resp)
}

// writeJSON 将响应以 JSON 格式写入 HTTP 响应。
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Stats] encode response failed: %v", err)
	}
}
