package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

// ensureSession 保证指定 session id 在数据库中存在。
func (h *AGUIHandler) ensureSession(ctx context.Context, sessionID, workspaceID string) error {
	if sessionID == "" {
		return nil
	}
	_, err := h.sessions.Get(ctx, sessionID)
	if err == nil {
		return nil
	}
	if workspaceID == "" {
		return fmt.Errorf("workspaceId is required")
	}
	sess := chat.Session{
		ID:          sessionID,
		WorkspaceID: workspaceID,
		AgentID:     defaultSessionAgentID,
		AgentType:   defaultSessionAgentType,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	return h.sessions.Create(ctx, sess)
}

// saveUserMessages 将用户输入消息持久化到数据库，并在第一条用户消息到达时生成会话标题。
// ctxItems 携带前端发送的上下文数据（quotedCard、selectedRepos），写入消息 metadata 以便历史恢复。
func (h *AGUIHandler) saveUserMessages(ctx context.Context, sessionID string, messages []agui.Message, ctxItems []agui.ContextItem) {
	if sessionID == "" {
		log.Printf("[AGUIHandler] saveUserMessages skipped: empty sessionID, count=%d", len(messages))
		return
	}
	log.Printf("[AGUIHandler] saveUserMessages session=%s count=%d", sessionID, len(messages))

	// 从上下文项中提取 quotedCard 和 selectedRepos，持久化到用户消息 metadata。
	quotedCardRaw := extractContextItemRaw(ctxItems, "quotedCard")
	selectedReposRaw := extractContextItemRaw(ctxItems, "selectedRepos")

	for _, m := range messages {
		content := m.ContentText()
		metadata := map[string]any{}
		if m.Role == agui.RoleUser {
			original := extractOriginalUserPrompt(content)
			if original != "" && original != content {
				metadata["originalText"] = original
			}
			// 持久化引用卡片和代码库，以便历史会话恢复。
			if quotedCardRaw != nil {
				var card any
				if json.Unmarshal(quotedCardRaw, &card) == nil {
					metadata["quotedCard"] = card
				}
			}
			if selectedReposRaw != nil {
				var repos any
				if json.Unmarshal(selectedReposRaw, &repos) == nil {
					metadata["selectedRepos"] = repos
				}
			}
		}
		msg := chat.Message{
			ID:        m.ID,
			SessionID: sessionID,
			Role:      string(m.Role),
			Type:      "text",
			Content:   content,
			Metadata:  metadata,
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(ctx, sessionID, msg); err != nil {
			log.Printf("[AGUIHandler] save user message failed: %v", err)
		} else {
			log.Printf("[AGUIHandler] saved user message id=%s role=%s", msg.ID, msg.Role)
		}
	}
	// 若会话尚无标题，取第一条非问候用户消息生成标题。
	h.ensureSessionTitle(ctx, sessionID, messages)
}

// finalizeSession 更新会话活动时间，并根据第一条非问候用户消息生成标题。
func (h *AGUIHandler) finalizeSession(ctx context.Context, sessionID string, inputMessages []agui.Message) {
	if sessionID == "" {
		return
	}
	_ = h.sessions.UpdateActivity(ctx, sessionID)

	// 若会话尚无标题，取第一条非问候用户消息生成标题。
	h.ensureSessionTitle(ctx, sessionID, inputMessages)
}

// ensureSessionTitle 在会话尚无标题时，根据第一条非问候用户消息生成标题。
// 规则：用户首个输入若是问候语，则跳过，等待后续功能性输入再生成标题。
func (h *AGUIHandler) ensureSessionTitle(ctx context.Context, sessionID string, messages []agui.Message) {
	sess, err := h.sessions.Get(ctx, sessionID)
	if err != nil || sess.Title != "" {
		return
	}
	for _, m := range messages {
		if m.Role != agui.RoleUser {
			continue
		}
		text := m.ContentText()
		if original := extractOriginalUserPrompt(text); original != "" {
			text = original
		}
		text = strings.TrimSpace(text)
		if text == "" || isGreeting(text) {
			continue
		}
		title := deriveSessionTitle(text)
		if title != "" {
			_ = h.sessions.UpdateTitle(ctx, sessionID, title)
		}
		break
	}
}
