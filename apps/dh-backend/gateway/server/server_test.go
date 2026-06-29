package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// TestHealthCheck 验证服务基础健康检查可用。
func TestHealthCheck(t *testing.T) {
	srv := httptest.NewServer(New(config.Config{GatewaydAdminURL: "", GatewaydAgentID: ""}))
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
