package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	os.Unsetenv("PORT")
	os.Unsetenv("SESSION_STORE")
	os.Unsetenv("MESSAGE_STORE")
	os.Unsetenv("BROKER_TYPE")
	os.Unsetenv("REDIS_URL")
	os.Unsetenv("AGENT_BASE_URL")
	os.Unsetenv("SESSION_TIMEOUT")
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
	if cfg.AgentBaseURL != "" {
		t.Errorf("expected empty agent base url, got %s", cfg.AgentBaseURL)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("SESSION_STORE", "redis")
	os.Setenv("MESSAGE_STORE", "redis")
	os.Setenv("BROKER_TYPE", "redis")
	os.Setenv("REDIS_URL", "redis://localhost:6379")
	os.Setenv("AGENT_BASE_URL", "http://agent:8080")
	defer os.Unsetenv("PORT")
	defer os.Unsetenv("SESSION_STORE")
	defer os.Unsetenv("MESSAGE_STORE")
	defer os.Unsetenv("BROKER_TYPE")
	defer os.Unsetenv("REDIS_URL")
	defer os.Unsetenv("AGENT_BASE_URL")
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
	if cfg.AgentBaseURL != "http://agent:8080" {
		t.Errorf("expected http://agent:8080, got %s", cfg.AgentBaseURL)
	}
}

func TestLoad_DurationEnv(t *testing.T) {
	os.Setenv("SESSION_TIMEOUT", "60")
	defer os.Unsetenv("SESSION_TIMEOUT")
	cfg := Load()
	if cfg.SessionTimeout != 60*time.Minute {
		t.Errorf("expected 60m, got %v", cfg.SessionTimeout)
	}
}

func TestLoad_InvalidDuration(t *testing.T) {
	os.Setenv("SESSION_TIMEOUT", "not-a-number")
	defer os.Unsetenv("SESSION_TIMEOUT")
	cfg := Load()
	if cfg.SessionTimeout != DEFAULT_SESSION_TIMEOUT {
		t.Errorf("expected fallback timeout %v, got %v", DEFAULT_SESSION_TIMEOUT, cfg.SessionTimeout)
	}
}
