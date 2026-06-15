package config

import (
	"os"
	"time"
)

const (
	DEFAULT_PORT            = "8080"
	DEFAULT_SESSION_STORE   = "memory"
	DEFAULT_MESSAGE_STORE   = "memory"
	DEFAULT_BROKER_TYPE     = "memory"
	DEFAULT_SESSION_TIMEOUT = 30 * time.Minute
	DEFAULT_DB_HOST         = "127.0.0.1"
	DEFAULT_DB_PORT         = "5433"
	DEFAULT_DB_USER         = "deepharness"
	DEFAULT_DB_PASSWORD     = "deepharness"
	DEFAULT_DB_NAME         = "deepharness"
)

type Config struct {
	Port             string
	SessionStoreType string
	MessageStoreType string
	BrokerType       string
	RedisURL         string
	AgentBaseURL     string
	SessionTimeout   time.Duration
	OrchestratorURL  string
	DBHost           string
	DBPort           string
	DBUser           string
	DBPassword       string
	DBName           string
}

func Load() Config {
	return Config{
		Port:             getEnv("PORT", DEFAULT_PORT),
		SessionStoreType: getEnv("SESSION_STORE", DEFAULT_SESSION_STORE),
		MessageStoreType: getEnv("MESSAGE_STORE", DEFAULT_MESSAGE_STORE),
		BrokerType:       getEnv("BROKER_TYPE", DEFAULT_BROKER_TYPE),
		RedisURL:         os.Getenv("REDIS_URL"),
		AgentBaseURL:     getEnv("AGENT_BASE_URL", "http://localhost:19090"),
		SessionTimeout:   getDurationEnv("SESSION_TIMEOUT", DEFAULT_SESSION_TIMEOUT),
		OrchestratorURL:  getEnv("ORCHESTRATOR_SERVICE_URL", "http://localhost:8084"),
		DBHost:           getEnv("DB_HOST", DEFAULT_DB_HOST),
		DBPort:           getEnv("DB_PORT", DEFAULT_DB_PORT),
		DBUser:           getEnv("DB_USER", DEFAULT_DB_USER),
		DBPassword:       getEnv("DB_PASSWORD", DEFAULT_DB_PASSWORD),
		DBName:           getEnv("DB_NAME", DEFAULT_DB_NAME),
	}
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return defaultValue
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return defaultValue
	}
	return d
}
