package handler

import (
	"context"
	"encoding/json"
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
)

const (
	statsTrendDays  = 7
	statsTrailLimit = 50
)

// StatsHandler 处理数据大盘统计请求。
type StatsHandler struct {
	sessions      chat.SessionStore
	workspaceRoot string
}

// NewStatsHandler 创建统计 handler。
func NewStatsHandler(sessions chat.SessionStore, workspaceRoot string) *StatsHandler {
	return &StatsHandler{sessions: sessions, workspaceRoot: workspaceRoot}
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

// Summary 处理 GET /api/v1/stats/summary 请求。
// 返回本周会话数、上周会话数、较上周变化百分比。
func (h *StatsHandler) Summary(w http.ResponseWriter, r *http.Request) {
	// 取 14 天趋势数据，前 7 天为上周，后 7 天为本周。
	trend, err := h.sessions.GetSessionTrend(r.Context(), statsTrendDays*2)
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
	data, err := h.sessions.GetSessionTrend(r.Context(), statsTrendDays)
	if err != nil {
		log.Printf("[Stats] GetSessionTrend failed: %v", err)
		data = []chat.DateCount{}
	}

	writeJSON(w, TrendResponse{Data: data})
}

// CodeCommits 处理 GET /api/v1/stats/commits 请求。
// 扫描工作空间根目录下的所有 git 仓库，统计最近 7 天每天的代码提交数量。
func (h *StatsHandler) CodeCommits(w http.ResponseWriter, r *http.Request) {
	data, err := h.getCodeCommitTrend(r.Context(), statsTrendDays)
	if err != nil {
		log.Printf("[Stats] getCodeCommitTrend failed: %v", err)
		data = emptyDateTrend(statsTrendDays)
	}

	writeJSON(w, TrendResponse{Data: data})
}

// Trails 处理 GET /api/v1/stats/trails 请求。
// 返回最近的会话轨迹（含消息数量），按更新时间倒序。
func (h *StatsHandler) Trails(w http.ResponseWriter, r *http.Request) {
	data, err := h.sessions.GetSessionTrails(r.Context(), statsTrailLimit)
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

// getCodeCommitTrend 扫描 workspaceRoot 下的 git 仓库，返回最近 days 天每天的提交数量。
// 通过 git log --all --no-merges --since 统计每个仓库的提交日期，汇总后按天聚合。
func (h *StatsHandler) getCodeCommitTrend(ctx context.Context, days int) ([]chat.DateCount, error) {
	counts := make(map[string]int)

	if h.workspaceRoot != "" {
		since := fmt.Sprintf("%d days ago", days)
		err := filepath.WalkDir(h.workspaceRoot, func(path string, d fs.DirEntry, err error) error {
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

// writeJSON 将响应以 JSON 格式写入 HTTP 响应。
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Stats] encode response failed: %v", err)
	}
}
