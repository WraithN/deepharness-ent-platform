package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "identity-service"})
	})
	mux.HandleFunc("/api/v1/users", func(w http.ResponseWriter, r *http.Request) {
		users := []identity.User{
			{ID: "1", Name: "Admin", Role: identity.RoleAdmin},
		}
		json.NewEncoder(w).Encode(users)
	})

	log.Printf("Identity Service starting on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
