package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestEndToEnd_CreateSessionAndConnect(t *testing.T) {
	srv := httptest.NewServer(New(""))
	defer srv.Close()

	// Step 1: Create session via HTTP
	reqBody, _ := json.Marshal(map[string]any{
		"agentType": "opencode",
		"model":     "claude-3-7",
	})
	resp, err := http.Post(srv.URL+"/api/v1/sessions", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	data := body["data"].(map[string]any)
	wsPath := data["wsUrl"].(string)

	// Convert http:// to ws://
	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1) + wsPath

	// Step 2: Connect via WebSocket
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer wsConn.Close()

	// Step 3: Send a chat message
	msg := map[string]any{
		"event": "message",
		"payload": map[string]any{
			"type":    "text",
			"content": "hello agent",
		},
	}
	if err := wsConn.WriteJSON(msg); err != nil {
		t.Fatalf("websocket write failed: %v", err)
	}

	// Give server time to process
	time.Sleep(100 * time.Millisecond)

	// Step 4: Verify WebSocket is still open (no error response)
	wsConn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	_, _, err = wsConn.ReadMessage()
	// We expect timeout because stub agent doesn't send responses
	if err != nil && !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("unexpected websocket error: %v", err)
	}
}

func TestWebSocket_InvalidSession(t *testing.T) {
	srv := httptest.NewServer(New(""))
	defer srv.Close()

	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1) + "/ws/v1/sessions/nonexistent"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected dial to fail for invalid session")
	}
	if resp != nil && resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}
