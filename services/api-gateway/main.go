package main

import (
	"log"
	"net/http"
	"os"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := server.New()

	log.Printf("API Gateway starting on port %s", port)
	if err := http.ListenAndServe(":"+port, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
