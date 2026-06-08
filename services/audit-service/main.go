package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/audit"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "audit-service"})
	})
	mux.HandleFunc("/api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		events := []audit.Event{
			{ID: "1", Action: "login", Resource: "user"},
		}
		json.NewEncoder(w).Encode(events)
	})

	log.Printf("Audit Service starting on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
