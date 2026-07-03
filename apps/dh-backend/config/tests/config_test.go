package tests

import (
	"testing"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

func TestLoad_Defaults(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("expected port 8080, got %s", cfg.Port)
	}
	if cfg.SessionStoreType != "memory" {
		t.Errorf("expected session store memory, got %s", cfg.SessionStoreType)
	}
	if cfg.SessionTimeout != 30*time.Minute {
		t.Errorf("expected timeout 30m, got %v", cfg.SessionTimeout)
	}
	if cfg.MessageStoreType != "memory" {
		t.Errorf("expected message store memory, got %s", cfg.MessageStoreType)
	}
	const defaultGatewaydAdminURL = "http://127.0.0.1:2346"
	if cfg.GatewaydAdminURL != defaultGatewaydAdminURL {
		t.Errorf("expected gatewayd admin url %s, got %s", defaultGatewaydAdminURL, cfg.GatewaydAdminURL)
	}
	if cfg.GatewaydAgentID != "claude-code" {
		t.Errorf("expected gatewayd agent id claude-code, got %s", cfg.GatewaydAgentID)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("SESSION_STORE", "redis")
	t.Setenv("MESSAGE_STORE", "redis")
	t.Setenv("GATEWAYD_ADMIN_URL", "http://gatewayd:2346")
	t.Setenv("GATEWAYD_AGENT_ID", "test-agent")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Port != "9090" {
		t.Errorf("expected port 9090, got %s", cfg.Port)
	}
	if cfg.SessionStoreType != "redis" {
		t.Errorf("expected redis, got %s", cfg.SessionStoreType)
	}
	if cfg.MessageStoreType != "redis" {
		t.Errorf("expected redis, got %s", cfg.MessageStoreType)
	}
	if cfg.GatewaydAdminURL != "http://gatewayd:2346" {
		t.Errorf("expected http://gatewayd:2346, got %s", cfg.GatewaydAdminURL)
	}
	if cfg.GatewaydAgentID != "test-agent" {
		t.Errorf("expected test-agent, got %s", cfg.GatewaydAgentID)
	}
}

func TestLoad_DurationEnv(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "60m")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.SessionTimeout != 60*time.Minute {
		t.Errorf("expected 60m, got %v", cfg.SessionTimeout)
	}
}

func TestLoad_InvalidDuration(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "not-a-number")
	_, err := config.Load()
	if err == nil {
		t.Error("expected error for invalid duration, got nil")
	}
}

func TestLoad_ZeroDuration(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "0s")
	_, err := config.Load()
	if err == nil {
		t.Error("expected error for zero duration, got nil")
	}
}

func TestLoad_NegativeDuration(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "-5m")
	_, err := config.Load()
	if err == nil {
		t.Error("expected error for negative duration, got nil")
	}
}
