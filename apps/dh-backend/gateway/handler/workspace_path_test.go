package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
)

// TestEnsureWorkspaceDir_UsesContextClient 验证 ensureWorkspaceDir 使用 ctx 中注入的
// per-user stubclient，而非全局 default。这是 slot 0 stub 未启动时 500 的回归测试。
//
// 修复前：ensureWorkspaceDir 用 context.Background()，FromContext 拿不到 per-user client，
// 降级到 default（slot 0），slot 0 未启动时 connection refused -> 500。
// 修复后：ensureWorkspaceDir 用请求 ctx，路由到 per-user stub。
func TestEnsureWorkspaceDir_UsesContextClient(t *testing.T) {
	var perUserHits, defaultHits int32

	perUserStub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&perUserHits, 1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer perUserStub.Close()

	defaultStub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&defaultHits, 1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer defaultStub.Close()

	// 设置全局 default，模拟 slot 0 stub
	stubclient.SetDefault(stubclient.New(defaultStub.URL))
	defer stubclient.SetDefault(nil)

	// 构造请求 ctx，注入 per-user stubclient（模拟 containerMW 的行为）
	ctx := stubclient.WithClient(context.Background(), stubclient.New(perUserStub.URL))

	if err := ensureWorkspaceDir(ctx, "/tmp/test-user/test-ws"); err != nil {
		t.Fatalf("ensureWorkspaceDir failed: %v", err)
	}

	if got := atomic.LoadInt32(&perUserHits); got != 1 {
		t.Errorf("per-user stub should receive 1 request, got %d", got)
	}
	if got := atomic.LoadInt32(&defaultHits); got != 0 {
		t.Errorf("default stub should receive 0 requests, got %d", got)
	}
}

// TestEnsureWorkspaceDir_EmptyPathSkipsStub 验证空路径直接返回 nil，不调用 stub。
func TestEnsureWorkspaceDir_EmptyPathSkipsStub(t *testing.T) {
	var hits int32
	stubSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer stubSrv.Close()

	ctx := stubclient.WithClient(context.Background(), stubclient.New(stubSrv.URL))

	if err := ensureWorkspaceDir(ctx, ""); err != nil {
		t.Fatalf("empty path should return nil, got error: %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Errorf("stub should not be called for empty path, got %d hits", got)
	}
}

// TestEnsureWorkspaceDir_NoClientReturnsError 验证 ctx 中无 stubclient 且 default 未初始化时
// 返回明确错误而非 panic。
func TestEnsureWorkspaceDir_NoClientReturnsError(t *testing.T) {
	stubclient.SetDefault(nil)
	defer stubclient.SetDefault(nil)

	err := ensureWorkspaceDir(context.Background(), "/tmp/test")
	if err == nil {
		t.Fatal("expected error when no stubclient available, got nil")
	}
}

// TestEnsureWorkspaceDir_StubErrorPropagates 验证 stub 返回错误时 ensureWorkspaceDir 传播错误。
func TestEnsureWorkspaceDir_StubErrorPropagates(t *testing.T) {
	stubSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
	}))
	defer stubSrv.Close()

	ctx := stubclient.WithClient(context.Background(), stubclient.New(stubSrv.URL))

	err := ensureWorkspaceDir(ctx, "/tmp/test")
	if err == nil {
		t.Fatal("expected error when stub returns 500, got nil")
	}
}
