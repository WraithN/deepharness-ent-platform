package main

import (
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/config"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/server"
)

func main() {
	cfg := config.Load()

	port := cfg.Port
	if port == "" {
		port = "8080"
	}

	srv := server.New(cfg.AgentBaseURL)

	log.Printf("API Gateway starting on port %s", port)
	if err := http.ListenAndServe(":"+port, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
