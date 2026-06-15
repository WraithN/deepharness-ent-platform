package service

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/object"
	"github.com/google/uuid"
)

// MockPersonalAssistantService 是 PersonalAssistantService 的内存 mock 实现。
type MockPersonalAssistantService struct {
	mu         sync.RWMutex
	assistants []object.PersonalAssistant
	sessions   []object.Session
	messages   []object.Message
}

// NewMockPersonalAssistantService 创建预置示例数据的 mock 服务。
func NewMockPersonalAssistantService() *MockPersonalAssistantService {
	return &MockPersonalAssistantService{
		assistants: []object.PersonalAssistant{
			{ID: "lob-001", Name: "大钳子", Role: "测试虾", Description: "专门负责测试用例评审、缺陷分析和质量报告生成。", CreatorID: "u1", CreatorName: "Meego", IsMine: true, CreatedAt: time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC)},
			{ID: "lob-002", Name: "小红须", Role: "运维虾", Description: "擅长日志排查、告警分析和部署问题定位。", CreatorID: "u2", CreatorName: "张三", IsMine: false, CreatedAt: time.Date(2026, 5, 21, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 21, 0, 0, 0, 0, time.UTC)},
		},
		sessions: []object.Session{
			{ID: "pas-001", AssistantID: "lob-001", Title: "新会话", MessageCount: 2, CreatedAt: time.Now().UTC().Add(-24 * time.Hour), UpdatedAt: time.Now().UTC()},
		},
		messages: []object.Message{
			{ID: uuid.New().String(), SessionID: "pas-001", Role: "assistant", Type: "text", Content: "你好，我是大钳子，测试虾。今天想聊点什么？", CreatedAt: time.Now().UTC().Add(-24 * time.Hour)},
		},
	}
}

// ListAssistants 返回助手列表（当前返回全部，isMine 根据 userID 判断）。
func (s *MockPersonalAssistantService) ListAssistants(userID string) ([]object.PersonalAssistant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]object.PersonalAssistant, len(s.assistants))
	for i, a := range s.assistants {
		result[i] = a
		result[i].IsMine = a.CreatorID == userID
	}
	return result, nil
}

// CreateAssistant 创建新助手。
func (s *MockPersonalAssistantService) CreateAssistant(userID, userName string, req CreateAssistantRequest) (object.PersonalAssistant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	assistant := object.PersonalAssistant{
		ID:          "lob-" + uuid.New().String()[:8],
		Name:        req.Name,
		Role:        req.Role,
		Description: req.Description,
		CreatorID:   userID,
		CreatorName: userName,
		IsMine:      true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	s.assistants = append(s.assistants, assistant)
	return assistant, nil
}

// GetAssistant 按 ID 获取助手。
func (s *MockPersonalAssistantService) GetAssistant(id string) (object.PersonalAssistant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, a := range s.assistants {
		if a.ID == id {
			return a, nil
		}
	}
	return object.PersonalAssistant{}, errors.New("assistant not found")
}

// DeleteAssistant 删除助手及其会话消息。
func (s *MockPersonalAssistantService) DeleteAssistant(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, a := range s.assistants {
		if a.ID == id {
			s.assistants = append(s.assistants[:i], s.assistants[i+1:]...)
			break
		}
	}
	// 清理关联会话和消息
	remainingSessions := make([]object.Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		if sess.AssistantID != id {
			remainingSessions = append(remainingSessions, sess)
		}
	}
	s.sessions = remainingSessions
	remainingMessages := make([]object.Message, 0, len(s.messages))
	for _, m := range s.messages {
		if !isMessageOfAssistant(m, id, s.sessions) {
			remainingMessages = append(remainingMessages, m)
		}
	}
	s.messages = remainingMessages
	return nil
}

func isMessageOfAssistant(m object.Message, assistantID string, sessions []object.Session) bool {
	for _, sess := range sessions {
		if sess.ID == m.SessionID && sess.AssistantID == assistantID {
			return true
		}
	}
	return false
}

// ListSessions 返回指定助手的会话列表。
func (s *MockPersonalAssistantService) ListSessions(assistantID string) ([]object.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]object.Session, 0)
	for _, sess := range s.sessions {
		if sess.AssistantID == assistantID {
			result = append(result, sess)
		}
	}
	return result, nil
}

// CreateSession 创建新会话。
func (s *MockPersonalAssistantService) CreateSession(assistantID, title string) (object.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	session := object.Session{
		ID:          "pas-" + uuid.New().String()[:8],
		AssistantID: assistantID,
		Title:       title,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	s.sessions = append(s.sessions, session)
	return session, nil
}

// DeleteSession 删除会话及其消息。
func (s *MockPersonalAssistantService) DeleteSession(assistantID, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, sess := range s.sessions {
		if sess.ID == sessionID && sess.AssistantID == assistantID {
			s.sessions = append(s.sessions[:i], s.sessions[i+1:]...)
			break
		}
	}
	remainingMessages := make([]object.Message, 0, len(s.messages))
	for _, m := range s.messages {
		if m.SessionID != sessionID {
			remainingMessages = append(remainingMessages, m)
		}
	}
	s.messages = remainingMessages
	return nil
}

// GetMessages 返回会话消息列表。
func (s *MockPersonalAssistantService) GetMessages(sessionID string) ([]object.Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]object.Message, 0)
	for _, m := range s.messages {
		if m.SessionID == sessionID {
			result = append(result, m)
		}
	}
	return result, nil
}

// ProcessMessage 保存用户消息并生成助手回复。
func (s *MockPersonalAssistantService) ProcessMessage(assistantID, sessionID, content string) (object.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	assistant, err := s.findAssistantLocked(assistantID)
	if err != nil {
		return object.Message{}, err
	}

	sessionIdx := -1
	for i, sess := range s.sessions {
		if sess.ID == sessionID {
			sessionIdx = i
			break
		}
	}
	if sessionIdx == -1 {
		return object.Message{}, errors.New("session not found")
	}

	now := time.Now().UTC()
	userMsg := object.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "user",
		Type:      "text",
		Content:   content,
		CreatedAt: now,
	}
	s.messages = append(s.messages, userMsg)

	replyContent := fmt.Sprintf("我是%s（%s）。收到你的消息：%s", assistant.Name, assistant.Role, content)
	reply := object.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "assistant",
		Type:      "text",
		Content:   replyContent,
		CreatedAt: now,
	}
	s.messages = append(s.messages, reply)

	// 更新会话消息数和时间
	s.sessions[sessionIdx].MessageCount += 2
	s.sessions[sessionIdx].UpdatedAt = now
	if s.sessions[sessionIdx].Title == "新会话" && len(content) > 0 {
		title := content
		if len(title) > 20 {
			title = title[:20]
		}
		s.sessions[sessionIdx].Title = title
	}

	return reply, nil
}

func (s *MockPersonalAssistantService) findAssistantLocked(id string) (object.PersonalAssistant, error) {
	for _, a := range s.assistants {
		if a.ID == id {
			return a, nil
		}
	}
	return object.PersonalAssistant{}, errors.New("assistant not found")
}
