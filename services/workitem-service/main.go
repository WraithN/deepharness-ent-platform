package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "workitem-service"})
	})
	mux.HandleFunc("/api/v1/workitems", func(w http.ResponseWriter, r *http.Request) {
		items := []workitem.WorkItem{
			{ID: "1", Title: "示例需求", Status: workitem.StatusTodo, Priority: workitem.PriorityHigh},
		}
		json.NewEncoder(w).Encode(items)
	})

	log.Printf("WorkItem Service starting on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
