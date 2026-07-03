package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/server"
)

// TestHealthCheck 验证服务基础健康检查可用。
func TestHealthCheck(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load config failed: %v", err)
	}
	srv := httptest.NewServer(server.New(cfg))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("health check failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}
