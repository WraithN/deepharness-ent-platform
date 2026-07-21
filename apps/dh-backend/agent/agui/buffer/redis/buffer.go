// Package redis 提供 SSEBuffer 的 Redis 实现，支持单节点和 Cluster 模式。
//
// 生产环境通过 Redis 持久化 SSE 事件和 run 级 checkpoint，
// 使服务器崩溃后仍可恢复未持久化的 assistant 消息。
//
// 数据结构：
//   - SSE 事件队列：Redis List，key = {prefix}:sse:{sessionID}
//   - Run 级 checkpoint：Redis Hash，key = {prefix}:runstates:{sessionID}，field = runID
//
// TTL 策略：每次写入自动刷新 24h 过期时间，防止无限增长。
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/redis/go-redis/v9"
)

const (
	defaultKeyPrefix = "dh"
	defaultTTL       = 24 * time.Hour
)

// popPendingScript 原子地读取并删除 List，避免竞态条件。
const popPendingScript = `
local vals = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1])
return vals
`

// RedisBuffer 是 SSEBuffer 的 Redis 实现。
// client 可以是 *redis.Client（单节点）或 *redis.ClusterClient（集群）。
type RedisBuffer struct {
	client    redis.UniversalClient
	keyPrefix string
	ttl       time.Duration
}

// Option 配置 RedisBuffer 的可选参数。
type Option func(*RedisBuffer)

// WithKeyPrefix 设置 Redis key 前缀，默认 "dh"。
func WithKeyPrefix(prefix string) Option {
	return func(b *RedisBuffer) {
		if prefix != "" {
			b.keyPrefix = prefix
		}
	}
}

// WithTTL 设置 key 过期时间，默认 24 小时。
func WithTTL(ttl time.Duration) Option {
	return func(b *RedisBuffer) {
		if ttl > 0 {
			b.ttl = ttl
		}
	}
}

// New 创建 Redis buffer。
// client 参数接受 *redis.Client（单节点）或 *redis.ClusterClient（集群），
// 两者均实现了 redis.UniversalClient 接口。
func New(client redis.UniversalClient, opts ...Option) *RedisBuffer {
	b := &RedisBuffer{
		client:    client,
		keyPrefix: defaultKeyPrefix,
		ttl:       defaultTTL,
	}
	for _, opt := range opts {
		opt(b)
	}
	return b
}

// NewFromOptions 根据 Redis 选项自动创建单节点或集群客户端。
// addrs 长度为 1 时创建单节点客户端，>1 时创建集群客户端。
func NewFromOptions(addrs []string, password string, db int, opts ...Option) *RedisBuffer {
	var client redis.UniversalClient
	if len(addrs) == 1 {
		client = redis.NewClient(&redis.Options{
			Addr:     addrs[0],
			Password: password,
			DB:       db,
		})
	} else {
		client = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:    addrs,
			Password: password,
		})
	}
	return New(client, opts...)
}

func (b *RedisBuffer) sseKey(sessionID string) string {
	return fmt.Sprintf("%s:sse:%s", b.keyPrefix, sessionID)
}

func (b *RedisBuffer) runStateKey(sessionID string) string {
	return fmt.Sprintf("%s:runstates:%s", b.keyPrefix, sessionID)
}

// refreshTTL 刷新 key 的过期时间，防止无限增长。
func (b *RedisBuffer) refreshTTL(ctx context.Context, key string) {
	_ = b.client.Expire(ctx, key, b.ttl).Err()
}

func (b *RedisBuffer) Append(ctx context.Context, sessionID string, ev agui.Event) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	key := b.sseKey(sessionID)
	_, err = b.client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.RPush(ctx, key, data)
		pipe.Expire(ctx, key, b.ttl)
		return nil
	})
	if err != nil {
		return fmt.Errorf("rpush sse event: %w", err)
	}
	return nil
}

func (b *RedisBuffer) Pending(ctx context.Context, sessionID string) ([]agui.Event, error) {
	key := b.sseKey(sessionID)
	vals, err := b.client.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("lrange sse events: %w", err)
	}
	events := make([]agui.Event, 0, len(vals))
	for _, v := range vals {
		var ev agui.Event
		if err := json.Unmarshal([]byte(v), &ev); err != nil {
			continue
		}
		events = append(events, ev)
	}
	return events, nil
}

func (b *RedisBuffer) PopPending(ctx context.Context, sessionID string) ([]agui.Event, error) {
	key := b.sseKey(sessionID)
	vals, err := b.client.Eval(ctx, popPendingScript, []string{key}).Result()
	if err != nil {
		return nil, fmt.Errorf("eval popPending script: %w", err)
	}
	rawList, ok := vals.([]interface{})
	if !ok {
		return []agui.Event{}, nil
	}
	events := make([]agui.Event, 0, len(rawList))
	for _, raw := range rawList {
		str, ok := raw.(string)
		if !ok {
			continue
		}
		var ev agui.Event
		if err := json.Unmarshal([]byte(str), &ev); err != nil {
			continue
		}
		events = append(events, ev)
	}
	return events, nil
}

func (b *RedisBuffer) Clear(ctx context.Context, sessionID string) error {
	if err := b.client.Del(ctx, b.sseKey(sessionID)).Err(); err != nil {
		return fmt.Errorf("del sse key: %w", err)
	}
	return nil
}

func (b *RedisBuffer) SaveRunState(ctx context.Context, sessionID, runID string, state []byte) error {
	key := b.runStateKey(sessionID)
	if err := b.client.HSet(ctx, key, runID, state).Err(); err != nil {
		return fmt.Errorf("hset run state: %w", err)
	}
	b.refreshTTL(ctx, key)
	return nil
}

func (b *RedisBuffer) LoadRunState(ctx context.Context, sessionID, runID string) ([]byte, error) {
	key := b.runStateKey(sessionID)
	val, err := b.client.HGet(ctx, key, runID).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("hget run state: %w", err)
	}
	return []byte(val), nil
}

func (b *RedisBuffer) ClearRunState(ctx context.Context, sessionID, runID string) error {
	if err := b.client.HDel(ctx, b.runStateKey(sessionID), runID).Err(); err != nil {
		return fmt.Errorf("hdel run state: %w", err)
	}
	return nil
}

func (b *RedisBuffer) LoadPendingRunStates(ctx context.Context, sessionID string) (map[string][]byte, error) {
	key := b.runStateKey(sessionID)
	vals, err := b.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("hgetall run states: %w", err)
	}
	result := make(map[string][]byte, len(vals))
	for k, v := range vals {
		result[k] = []byte(v)
	}
	return result, nil
}

// Close 关闭 Redis 连接。
func (b *RedisBuffer) Close() error {
	return b.client.Close()
}
