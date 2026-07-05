package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

const (
	statsTrendDays  = 7
	statsTrailLimit = 50
)

// StatsHandler 处理数据大盘统计请求。
type StatsHandler struct {
	sessions chat.SessionStore
}

// NewStatsHandler 创建统计 handler。
func NewStatsHandler(sessions chat.SessionStore) *StatsHandler {
	return &StatsHandler{sessions: sessions}
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

// writeJSON 将响应以 JSON 格式写入 HTTP 响应。
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Stats] encode response failed: %v", err)
	}
}
