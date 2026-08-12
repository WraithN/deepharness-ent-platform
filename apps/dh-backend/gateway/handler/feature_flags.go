package handler

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// 平台功能开关相关常量。
const (
	// FlagKeyCometFlow 是 Comet Classic 工作流开关的标识。
	FlagKeyCometFlow = "comet_flow"
	// cometFlowCacheTTL 是开关缓存有效期，避免指令渲染热路径每次查库。
	cometFlowCacheTTL = 30 * time.Second
)

// cometFlowDefaultEnabled 返回 comet_flow 开关在数据库不可用时的默认值。
// 开发环境未启动 PostgreSQL 时，默认启用 comet 流程以便实际走 comet 验证；
// 生产环境应初始化 DB 并通过 /api/v1/platform/feature-flags 管理开关。
// 也可通过环境变量 COMET_FLOW_DEFAULT_ENABLED 显式覆盖。
func cometFlowDefaultEnabled() bool {
	v := os.Getenv("COMET_FLOW_DEFAULT_ENABLED")
	if v == "false" || v == "0" {
		return false
	}
	if v == "true" || v == "1" {
		return true
	}
	// 未显式设置时，默认启用，确保 dev 环境无 DB 也能走 comet。
	return true
}

// defaultEnabledForFlag 返回指定开关在数据库不可用时的安全回退值。
func defaultEnabledForFlag(flagKey string) bool {
	if flagKey == FlagKeyCometFlow {
		return cometFlowDefaultEnabled()
	}
	return false
}

// FeatureFlag 表示一个平台级功能开关。
type FeatureFlag struct {
	FlagKey   string    `json:"flagKey"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var (
	featureFlagDB *sql.DB
	// cometFlow 开关缓存：applyCommandConfig 渲染热路径调用，用读写锁 + TTL 减少查库。
	cometFlowValue    bool
	cometFlowCachedAt time.Time
	cometFlowMu       sync.RWMutex
)

// SetFeatureFlagDB 注入数据库连接，供功能开关查询使用。在 server 初始化阶段调用。
func SetFeatureFlagDB(db *sql.DB) {
	featureFlagDB = db
}

// IsCometFlowEnabled 返回 Comet 流程开关是否启用。
// 带 TTL 缓存，查库失败时 comet_flow 默认启用，其他开关回退 false；
// 可通过 COMET_FLOW_DEFAULT_ENABLED 环境变量覆盖默认行为。
// 供 applyCommandConfig 在指令渲染时调用，决定是否使用 cometTemplate。
func IsCometFlowEnabled() bool {
	if v, ok := readCometFlowCache(); ok {
		return v
	}
	return refreshCometFlowCache()
}

// readCometFlowCache 尝试读取有效缓存，命中返回 (值, true)。
func readCometFlowCache() (bool, bool) {
	cometFlowMu.RLock()
	defer cometFlowMu.RUnlock()
	if time.Since(cometFlowCachedAt) < cometFlowCacheTTL {
		return cometFlowValue, true
	}
	return false, false
}

// refreshCometFlowCache 重新查库并更新缓存，返回当前开关值。
func refreshCometFlowCache() bool {
	cometFlowMu.Lock()
	defer cometFlowMu.Unlock()
	// 双检：持锁后再校验一次，避免并发重复查库。
	if time.Since(cometFlowCachedAt) < cometFlowCacheTTL {
		return cometFlowValue
	}
	enabled := queryFlagEnabled(FlagKeyCometFlow)
	cometFlowValue = enabled
	cometFlowCachedAt = time.Now()
	return enabled
}

// invalidateCometFlowCache 清除缓存，在 PUT 更新后调用使新值即时生效。
func invalidateCometFlowCache() {
	cometFlowMu.Lock()
	defer cometFlowMu.Unlock()
	cometFlowCachedAt = time.Time{}
}

// queryFlagEnabled 查询指定开关的启用状态。
// 数据库未初始化或查询失败时，comet_flow 默认启用（便于 dev 环境测试），
// 其他开关安全回退为 false；调用方可通过 COMET_FLOW_DEFAULT_ENABLED 环境变量覆盖。
func queryFlagEnabled(flagKey string) bool {
	if featureFlagDB == nil {
		log.Printf("[FeatureFlags] DB not initialized, using default for %s", flagKey)
		return defaultEnabledForFlag(flagKey)
	}
	var enabled bool
	err := featureFlagDB.QueryRow(
		`SELECT enabled FROM platform_feature_flags WHERE flag_key = $1`, flagKey,
	).Scan(&enabled)
	if err != nil {
		log.Printf("[FeatureFlags] query %s failed: %v, using default", flagKey, err)
		return defaultEnabledForFlag(flagKey)
	}
	return enabled
}

// FeatureFlagsHandler 处理 GET /api/v1/platform/feature-flags，返回全部开关。
func FeatureFlagsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, ErrCodeGeneral, "method not allowed")
		return
	}
	flags := listFeatureFlags()
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(flags)
}

// listFeatureFlags 查询全部开关。
// 数据库未初始化时，至少返回 comet_flow 的默认值，保证前端管理页能看到开关状态。
func listFeatureFlags() []FeatureFlag {
	if featureFlagDB == nil {
		return []FeatureFlag{{
			FlagKey:   FlagKeyCometFlow,
			Enabled:   cometFlowDefaultEnabled(),
			UpdatedAt: time.Now(),
		}}
	}
	rows, err := featureFlagDB.Query(
		`SELECT flag_key, enabled, updated_at FROM platform_feature_flags ORDER BY flag_key`,
	)
	if err != nil {
		log.Printf("[FeatureFlags] query failed: %v", err)
		return []FeatureFlag{{
			FlagKey:   FlagKeyCometFlow,
			Enabled:   cometFlowDefaultEnabled(),
			UpdatedAt: time.Now(),
		}}
	}
	defer rows.Close()
	flags := make([]FeatureFlag, 0)
	for rows.Next() {
		f, err := scanFeatureFlag(rows)
		if err != nil {
			log.Printf("[FeatureFlags] scan failed: %v", err)
			continue
		}
		flags = append(flags, f)
	}
	return flags
}

// scanFeatureFlag 从单行读取开关数据。
func scanFeatureFlag(rows *sql.Rows) (FeatureFlag, error) {
	var f FeatureFlag
	if err := rows.Scan(&f.FlagKey, &f.Enabled, &f.UpdatedAt); err != nil {
		return f, err
	}
	return f, nil
}

// FeatureFlagByKeyHandler 处理 PUT /api/v1/platform/feature-flags/{key}，更新单个开关。
func FeatureFlagByKeyHandler(w http.ResponseWriter, r *http.Request) {
	key, ok := PathValueOr404(w, r, "key")
	if !ok {
		return
	}
	if r.Method != http.MethodPut {
		WriteJSONError(w, http.StatusMethodNotAllowed, ErrCodeGeneral, "method not allowed")
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if !DecodeJSONBody(w, r, &req) {
		return
	}
	if featureFlagDB == nil {
		WriteJSONError(w, http.StatusServiceUnavailable, ErrCodeGeneral, "feature flag DB not initialized")
		return
	}
	if err := updateFeatureFlag(key, req.Enabled); err != nil {
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "failed to update flag")
		return
	}
	// 更新后失效缓存，使后续指令渲染读到新值。
	if key == FlagKeyCometFlow {
		invalidateCometFlowCache()
	}
	f := getFeatureFlag(key)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(f)
}

// updateFeatureFlag 更新指定开关的启用状态。
func updateFeatureFlag(key string, enabled bool) error {
	_, err := featureFlagDB.Exec(
		`UPDATE platform_feature_flags SET enabled = $1 WHERE flag_key = $2`,
		enabled, key,
	)
	if err != nil {
		log.Printf("[FeatureFlags] update %s failed: %v", key, err)
	}
	return err
}

// getFeatureFlag 查询单个开关；数据库不可用时返回默认值。
func getFeatureFlag(key string) FeatureFlag {
	var f FeatureFlag
	if featureFlagDB == nil {
		f.FlagKey = key
		f.Enabled = defaultEnabledForFlag(key)
		return f
	}
	_ = featureFlagDB.QueryRow(
		`SELECT flag_key, enabled, updated_at FROM platform_feature_flags WHERE flag_key = $1`, key,
	).Scan(&f.FlagKey, &f.Enabled, &f.UpdatedAt)
	return f
}
