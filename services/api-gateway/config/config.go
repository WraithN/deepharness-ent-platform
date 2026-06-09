package config

import (
	"os"
	"strconv"
	"time"
)

const (
	DEFAULT_PORT            = "8080"
	DEFAULT_SESSION_STORE   = "memory"
	DEFAULT_MESSAGE_STORE   = "memory"
	DEFAULT_BROKER_TYPE     = "memory"
	DEFAULT_SESSION_TIMEOUT = 30 * time.Minute
)

type Config struct {
	Port             string
	SessionStoreType string
	MessageStoreType string
	BrokerType       string
	RedisURL         string
	AgentBaseURL     string
	SessionTimeout   time.Duration
}

func Load() Config {
	return Config{
		Port:             getEnv("PORT", DEFAULT_PORT),
		SessionStoreType: getEnv("SESSION_STORE", DEFAULT_SESSION_STORE),
		MessageStoreType: getEnv("MESSAGE_STORE", DEFAULT_MESSAGE_STORE),
		BrokerType:       getEnv("BROKER_TYPE", DEFAULT_BROKER_TYPE),
		RedisURL:         os.Getenv("REDIS_URL"),
		AgentBaseURL:     os.Getenv("AGENT_BASE_URL"),
		SessionTimeout:   getDurationEnv("SESSION_TIMEOUT", DEFAULT_SESSION_TIMEOUT),
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
	d, err := strconv.Atoi(v)
	if err != nil {
		return defaultValue
	}
	return time.Duration(d) * time.Minute
}
