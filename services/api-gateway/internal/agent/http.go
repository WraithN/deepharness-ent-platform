package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

const (
	AGENT_REQUEST_TIMEOUT = 120 * time.Second
)

// SSEEvent represents an event from the agent's SSE stream
type SSEEvent struct {
	Type       string          `json:"type"`
	Properties json.RawMessage `json:"properties"`
}

// HTTPClient makes HTTP requests to the Coding Agent and parses SSE responses.
type HTTPClient struct {
	baseURL string
	client  *http.Client
}

// NewHTTPClient creates a new HTTP agent client.
func NewHTTPClient(baseURL string) *HTTPClient {
	if baseURL == "" {
		baseURL = "http://localhost:9090"
	}
	return &HTTPClient{
		baseURL: baseURL,
		client: &http.Client{
			Timeout: AGENT_REQUEST_TIMEOUT,
		},
	}
}

// SendMessage sends a user message to the agent and returns a channel of SSE events.
func (c *HTTPClient) SendMessage(ctx context.Context, session domain.Session, msg domain.Message) (<-chan SSEEvent, error) {
	url := fmt.Sprintf("%s/session/%s/prompt", c.baseURL, session.ID)

	reqBody, err := json.Marshal(map[string]any{
		"parts": []map[string]string{
			{"type": "text", "text": msg.Content},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("agent returned status %d", resp.StatusCode)
	}

	events := make(chan SSEEvent, 10)
	go func() {
		defer close(events)
		defer resp.Body.Close()
		c.parseSSE(resp, events)
	}()

	return events, nil
}

// parseSSE reads the HTTP response body and parses SSE events.
func (c *HTTPClient) parseSSE(resp *http.Response, events chan<- SSEEvent) {
	scanner := bufio.NewScanner(resp.Body)
	var currentData strings.Builder

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			// Empty line means end of event
			if currentData.Len() > 0 {
				data := currentData.String()
				currentData.Reset()

				// Remove "data: " prefix
				if strings.HasPrefix(data, "data: ") {
					data = data[6:]
				}

				var ev SSEEvent
				if err := json.Unmarshal([]byte(data), &ev); err == nil {
					select {
					case events <- ev:
					default:
						// Channel full, drop event
					}
				}
			}
			continue
		}

		if strings.HasPrefix(line, "data: ") {
			if currentData.Len() > 0 {
				currentData.WriteString("\n")
			}
			currentData.WriteString(line)
		}
	}
}
