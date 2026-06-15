package personalassistant

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/object"
	"github.com/gorilla/websocket"
)

var paUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WebSocket 处理 /ws/v1/personal-assistant/{assistantId}/sessions/{sessionId}。
// 这是一个完全独立于 /ws/v1/sessions 的端点，仅服务于个人助手对话。
func WebSocket(w http.ResponseWriter, r *http.Request) {
	assistantID := r.PathValue("assistantId")
	sessionID := r.PathValue("sessionId")
	if assistantID == "" || sessionID == "" {
		http.Error(w, `{"code":1,"message":"missing assistant or session id"}`, http.StatusBadRequest)
		return
	}

	// 校验助手和会话存在。
	if _, err := defaultService.GetAssistant(assistantID); err != nil {
		http.Error(w, `{"code":1,"message":"assistant not found"}`, http.StatusNotFound)
		return
	}
	sessions, err := defaultService.ListSessions(assistantID)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to validate session"}`, http.StatusInternalServerError)
		return
	}
	found := false
	for _, s := range sessions {
		if s.ID == sessionID {
			found = true
			break
		}
	}
	if !found {
		http.Error(w, `{"code":1,"message":"session not found"}`, http.StatusNotFound)
		return
	}

	conn, err := paUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[PersonalAssistant] websocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 重放历史消息。
	history, _ := defaultService.GetMessages(sessionID)
	for _, m := range history {
		if err := writeMessage(conn, m); err != nil {
			return
		}
	}

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[PersonalAssistant] websocket read error: %v", err)
			}
			break
		}

		var msg object.WSMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("[PersonalAssistant] invalid websocket message: %v", err)
			continue
		}

		if msg.Event != "message" || msg.Payload.Type != "text" {
			continue
		}

		reply, err := defaultService.ProcessMessage(assistantID, sessionID, msg.Payload.Content)
		if err != nil {
			log.Printf("[PersonalAssistant] process message failed: %v", err)
			continue
		}

		if err := writeMessage(conn, reply); err != nil {
			break
		}
	}
}

func writeMessage(conn *websocket.Conn, msg object.Message) error {
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	resp := object.WSResponse{
		Event:   "message",
		Payload: msg,
	}
	return conn.WriteJSON(resp)
}
