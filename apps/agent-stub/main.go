package main

import (
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/agent-stub/config"
	"github.com/deepharness/deepharness-ent-platform/apps/agent-stub/gateway/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	srv := server.New(cfg)

	log.Printf("Agent Stub starting on port %s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
