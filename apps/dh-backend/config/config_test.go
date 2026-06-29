package config

import (
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	cfg := Load()
	if cfg.Port != DEFAULT_PORT {
		t.Errorf("expected port %s, got %s", DEFAULT_PORT, cfg.Port)
	}
	if cfg.SessionStoreType != DEFAULT_SESSION_STORE {
		t.Errorf("expected session store %s, got %s", DEFAULT_SESSION_STORE, cfg.SessionStoreType)
	}
	if cfg.SessionTimeout != DEFAULT_SESSION_TIMEOUT {
		t.Errorf("expected timeout %v, got %v", DEFAULT_SESSION_TIMEOUT, cfg.SessionTimeout)
	}
	if cfg.MessageStoreType != DEFAULT_MESSAGE_STORE {
		t.Errorf("expected message store %s, got %s", DEFAULT_MESSAGE_STORE, cfg.MessageStoreType)
	}
	if cfg.BrokerType != DEFAULT_BROKER_TYPE {
		t.Errorf("expected broker type %s, got %s", DEFAULT_BROKER_TYPE, cfg.BrokerType)
	}
	if cfg.RedisURL != "" {
		t.Errorf("expected empty redis url, got %s", cfg.RedisURL)
	}
	const defaultGatewaydAdminURL = "http://127.0.0.1:2346"
	if cfg.GatewaydAdminURL != defaultGatewaydAdminURL {
		t.Errorf("expected gatewayd admin url %s, got %s", defaultGatewaydAdminURL, cfg.GatewaydAdminURL)
	}
	if cfg.GatewaydAgentID != DEFAULT_GATEWAYD_AGENT_ID {
		t.Errorf("expected gatewayd agent id %s, got %s", DEFAULT_GATEWAYD_AGENT_ID, cfg.GatewaydAgentID)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("SESSION_STORE", "redis")
	t.Setenv("MESSAGE_STORE", "redis")
	t.Setenv("BROKER_TYPE", "redis")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("GATEWAYD_ADMIN_URL", "http://gatewayd:2346")
	t.Setenv("GATEWAYD_AGENT_ID", "test-agent")
	cfg := Load()
	if cfg.Port != "9090" {
		t.Errorf("expected port 9090, got %s", cfg.Port)
	}
	if cfg.SessionStoreType != "redis" {
		t.Errorf("expected redis, got %s", cfg.SessionStoreType)
	}
	if cfg.MessageStoreType != "redis" {
		t.Errorf("expected redis, got %s", cfg.MessageStoreType)
	}
	if cfg.BrokerType != "redis" {
		t.Errorf("expected redis, got %s", cfg.BrokerType)
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("expected redis://localhost:6379, got %s", cfg.RedisURL)
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
	cfg := Load()
	if cfg.SessionTimeout != 60*time.Minute {
		t.Errorf("expected 60m, got %v", cfg.SessionTimeout)
	}
}

func TestLoad_InvalidDuration(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "not-a-number")
	cfg := Load()
	if cfg.SessionTimeout != DEFAULT_SESSION_TIMEOUT {
		t.Errorf("expected fallback timeout %v, got %v", DEFAULT_SESSION_TIMEOUT, cfg.SessionTimeout)
	}
}

func TestLoad_ZeroDuration(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "0s")
	cfg := Load()
	if cfg.SessionTimeout != DEFAULT_SESSION_TIMEOUT {
		t.Errorf("expected fallback timeout %v, got %v", DEFAULT_SESSION_TIMEOUT, cfg.SessionTimeout)
	}
}

func TestLoad_NegativeDuration(t *testing.T) {
	t.Setenv("SESSION_TIMEOUT", "-5m")
	cfg := Load()
	if cfg.SessionTimeout != DEFAULT_SESSION_TIMEOUT {
		t.Errorf("expected fallback timeout %v, got %v", DEFAULT_SESSION_TIMEOUT, cfg.SessionTimeout)
	}
}
