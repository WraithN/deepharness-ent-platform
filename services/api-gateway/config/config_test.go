package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	os.Unsetenv("PORT")
	os.Unsetenv("SESSION_STORE")
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
}

func TestLoad_EnvOverride(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("SESSION_STORE", "redis")
	defer os.Unsetenv("PORT")
	defer os.Unsetenv("SESSION_STORE")
	cfg := Load()
	if cfg.Port != "9090" {
		t.Errorf("expected port 9090, got %s", cfg.Port)
	}
	if cfg.SessionStoreType != "redis" {
		t.Errorf("expected redis, got %s", cfg.SessionStoreType)
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
