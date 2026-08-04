package tests

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/server"
)

func TestMain(m *testing.M) {
	// 测试运行在 apps/dh-backend/gateway/server/tests，需指向仓库根目录下的 config.yaml
	os.Setenv("CONFIG_FILE", "../../../config.yaml")
	os.Exit(m.Run())
}

// TestHealthCheck 验证服务基础健康检查可用。
func TestHealthCheck(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load config failed: %v", err)
	}
	handler, cleanup := server.New(cfg)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	defer cleanup()

	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("health check failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}
