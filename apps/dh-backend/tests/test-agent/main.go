package main

import (
	"context"
	"fmt"
	"time"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

func main() {
	client := client.NewHTTPClient("http://localhost:19090", 0)
	session := chat.Session{ID: "test-session"}
	msg := chat.Message{Content: "hello"}
	
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
