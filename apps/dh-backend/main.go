package main

import (
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/server"
)

func main() {
	cfg := config.Load()

	port := cfg.Port
	if port == "" {
		port = "8080"
	}

	srv := server.New(cfg)

	log.Printf("DH Backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
