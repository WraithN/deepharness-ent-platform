package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "project-service"})
	})
	mux.HandleFunc("/api/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		projects := []project.Project{
			{ID: "1", Name: "Demo Project", RepoType: project.RepoTypeDev},
		}
		json.NewEncoder(w).Encode(projects)
	})

	log.Printf("Project Service starting on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
