package main

import (
	"context"
	"fmt"
	"time"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/agent"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func main() {
	client := agent.NewHTTPClient("http://localhost:19090")
	session := domain.Session{ID: "test-session"}
	msg := domain.Message{Content: "hello"}
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	events, err := client.SendMessage(ctx, session, msg)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	
	count := 0
	for ev := range events {
		fmt.Printf("Event: %s\n", ev.Type)
		count++
	}
	fmt.Printf("Total events: %d\n", count)
}
