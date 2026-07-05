package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// BranchCache 缓存仓库分支列表，避免每次页面加载都触发 git fetch。
// 缓存 key 为 repoID（同一仓库的分支信息对所有用户相同）。
type BranchCache interface {
	Get(ctx context.Context, repoID string) ([]BranchInfo, bool)
	Set(ctx context.Context, repoID string, branches []BranchInfo) error
}

const (
	branchCacheTTL      = 5 * time.Minute
	branchCacheKeyPrefix = "dh:branches"
)

func branchCacheKey(repoID string) string {
	return fmt.Sprintf("%s:%s", branchCacheKeyPrefix, repoID)
}

// ── Redis 实现（生产环境，分布式共享缓存） ──

// RedisBranchCache 基于 Redis 的分支缓存。
type RedisBranchCache struct {
	client redis.UniversalClient
	ttl    time.Duration
}

// NewRedisBranchCache 创建 Redis 分支缓存。
func NewRedisBranchCache(client redis.UniversalClient) *RedisBranchCache {
	return &RedisBranchCache{client: client, ttl: branchCacheTTL}
}

func (c *RedisBranchCache) Get(ctx context.Context, repoID string) ([]BranchInfo, bool) {
	val, err := c.client.Get(ctx, branchCacheKey(repoID)).Result()
	if err != nil {
		return nil, false
	}
	var branches []BranchInfo
	if err := json.Unmarshal([]byte(val), &branches); err != nil {
		return nil, false
	}
	return branches, true
}

func (c *RedisBranchCache) Set(ctx context.Context, repoID string, branches []BranchInfo) error {
	data, err := json.Marshal(branches)
	if err != nil {
		return err
	}
	return c.client.Set(ctx, branchCacheKey(repoID), data, c.ttl).Err()
}

// ── 内存实现（开发环境，单实例缓存） ──

type memCacheEntry struct {
	branches []BranchInfo
	expireAt time.Time
}

// MemoryBranchCache 基于内存的分支缓存（开发环境使用）。
type MemoryBranchCache struct {
	mu      sync.RWMutex
	entries map[string]*memCacheEntry
	ttl     time.Duration
}

// NewMemoryBranchCache 创建内存分支缓存。
func NewMemoryBranchCache() *MemoryBranchCache {
	return &MemoryBranchCache{
		entries: make(map[string]*memCacheEntry),
		ttl:     branchCacheTTL,
	}
}

func (c *MemoryBranchCache) Get(_ context.Context, repoID string) ([]BranchInfo, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.entries[repoID]
	if !ok || time.Now().After(entry.expireAt) {
		return nil, false
	}
	return entry.branches, true
}

func (c *MemoryBranchCache) Set(_ context.Context, repoID string, branches []BranchInfo) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[repoID] = &memCacheEntry{
		branches: branches,
		expireAt: time.Now().Add(c.ttl),
	}
	return nil
}
