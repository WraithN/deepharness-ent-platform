// Package service 实现飞书机器人模块的业务逻辑与数据访问。
//
// 架构合规（AGENTS.md 规则12）：本模块仅通过 AGUIClient 向 gatewayd 下发命令，
// 不直接执行 agent CLI、不直接写共享目录、不直接执行 git/npm。
// 文件写入由 agent 在 gatewayd 容器中完成，回复由本模块异步发送回飞书。
package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
)

// FeishuService 定义飞书机器人模块的服务接口。
type FeishuService interface {
	// HandleEvent 异步处理一条飞书消息事件：解析用户 -> 分发 agent -> 发送回复。
	// 该方法应在独立 goroutine 中调用，因为 agent 执行可能耗时数分钟。
	HandleEvent(ev object.InboundEvent)
	// BindUser 绑定飞书 open_id 与平台用户/工作空间。
	BindUser(req object.BindUserRequest) (object.FeishuUser, error)
	// GetUser 查询飞书用户绑定关系。
	GetUser(openID string) (object.FeishuUser, error)
	// ListBindings 列出全部飞书用户绑定（管理用）。
	ListBindings() ([]object.FeishuUser, error)
	// ListChatSessions 列出飞书会话映射（管理用）。
	ListChatSessions() ([]object.FeishuChatSession, error)
}

// Config 是飞书服务依赖的配置子集，由 server.go 组装时注入。
type Config struct {
	BotUserID        string
	DefaultWorkspace string
	MockMode         bool
	DispatchTimeout  time.Duration
}

// DBFeishuService 是基于 PostgreSQL 的 FeishuService 实现。
type DBFeishuService struct {
	db            *sql.DB
	aguiClient    *client.AGUIClient
	sessions      chat.SessionStore
	messages      chat.MessageStore
	workspaceRoot string
	cfg           Config
	replier       Replier
}

// NewDBFeishuService 创建飞书机器人服务。
// aguiClient 用于向 gatewayd 分发 agent 命令；sessions/messages 用于持久化会话与消息；
// replier 负责将 agent 回复发送回飞书（mock 模式输出日志，真实模式调用飞书 Open API）。
func NewDBFeishuService(db *sql.DB, aguiClient *client.AGUIClient, sessions chat.SessionStore, messages chat.MessageStore, workspaceRoot string, cfg Config, replier Replier) *DBFeishuService {
	svc := &DBFeishuService{
		db:            db,
		aguiClient:    aguiClient,
		sessions:      sessions,
		messages:      messages,
		workspaceRoot: workspaceRoot,
		cfg:           cfg,
		replier:       replier,
	}
	// 服务初始化时自动建表，避免开发/测试环境因未执行迁移脚本而缺少表。
	_ = svc.ensureTables()
	return svc
}

// ensureTables 在表不存在时自动创建 feishu_users 与 feishu_chat_sessions 表。
func (s *DBFeishuService) ensureTables() error {
	// 飞书用户与平台用户的绑定关系表。
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS feishu_users (
			open_id VARCHAR(128) PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			workspace_id VARCHAR(64) NOT NULL DEFAULT '',
			user_name VARCHAR(255) NOT NULL DEFAULT '',
			nick_name VARCHAR(255) NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create feishu_users table failed: %w", err)
	}

	// 飞书会话与平台 agent session 的映射表。
	// 同一 chat_id 复用同一 session_id 以保持多轮上下文。
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS feishu_chat_sessions (
			chat_id VARCHAR(128) PRIMARY KEY,
			session_id VARCHAR(128) NOT NULL,
			user_id VARCHAR(64) NOT NULL,
			workspace_id VARCHAR(64) NOT NULL DEFAULT '',
			mode VARCHAR(16) NOT NULL DEFAULT 'oneshot',
			chat_type VARCHAR(16) NOT NULL DEFAULT 'group',
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create feishu_chat_sessions table failed: %w", err)
	}

	_, err = s.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_feishu_chat_sessions_user ON feishu_chat_sessions (user_id);
		CREATE INDEX IF NOT EXISTS idx_feishu_chat_sessions_session ON feishu_chat_sessions (session_id);
	`)
	if err != nil {
		return fmt.Errorf("create feishu_chat_sessions indexes failed: %w", err)
	}

	return nil
}

// BindUser 绑定或更新飞书用户与平台用户的映射关系（upsert）。
func (s *DBFeishuService) BindUser(req object.BindUserRequest) (object.FeishuUser, error) {
	if req.OpenID == "" || req.UserID == "" {
		return object.FeishuUser{}, errors.New("openId and userId are required")
	}
	var u object.FeishuUser
	err := s.db.QueryRow(`
		INSERT INTO feishu_users (open_id, user_id, workspace_id, user_name, nick_name)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (open_id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			workspace_id = EXCLUDED.workspace_id,
			user_name = EXCLUDED.user_name,
			nick_name = EXCLUDED.nick_name
		RETURNING open_id, user_id, workspace_id, user_name, nick_name, created_at, updated_at
	`, req.OpenID, req.UserID, req.WorkspaceID, req.UserName, req.NickName).
		Scan(&u.OpenID, &u.UserID, &u.WorkspaceID, &u.UserName, &u.NickName, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return object.FeishuUser{}, fmt.Errorf("bind feishu user failed: %w", err)
	}
	return u, nil
}

// GetUser 查询飞书用户绑定关系。
func (s *DBFeishuService) GetUser(openID string) (object.FeishuUser, error) {
	var u object.FeishuUser
	err := s.db.QueryRow(`
		SELECT open_id, user_id, workspace_id, user_name, nick_name, created_at, updated_at
		FROM feishu_users WHERE open_id = $1
	`, openID).Scan(&u.OpenID, &u.UserID, &u.WorkspaceID, &u.UserName, &u.NickName, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.FeishuUser{}, errors.New("feishu user not bound")
		}
		return object.FeishuUser{}, fmt.Errorf("get feishu user failed: %w", err)
	}
	return u, nil
}

// ListBindings 列出全部飞书用户绑定记录。
func (s *DBFeishuService) ListBindings() ([]object.FeishuUser, error) {
	rows, err := s.db.Query(`
		SELECT open_id, user_id, workspace_id, user_name, nick_name, created_at, updated_at
		FROM feishu_users ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list feishu users failed: %w", err)
	}
	defer rows.Close()

	list := make([]object.FeishuUser, 0)
	for rows.Next() {
		var u object.FeishuUser
		if err := rows.Scan(&u.OpenID, &u.UserID, &u.WorkspaceID, &u.UserName, &u.NickName, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan feishu user failed: %w", err)
		}
		list = append(list, u)
	}
	return list, rows.Err()
}

// ListChatSessions 列出全部飞书会话映射记录。
func (s *DBFeishuService) ListChatSessions() ([]object.FeishuChatSession, error) {
	rows, err := s.db.Query(`
		SELECT chat_id, session_id, user_id, workspace_id, mode, chat_type, created_at, updated_at
		FROM feishu_chat_sessions ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list feishu chat sessions failed: %w", err)
	}
	defer rows.Close()

	list := make([]object.FeishuChatSession, 0)
	for rows.Next() {
		var cs object.FeishuChatSession
		if err := rows.Scan(&cs.ChatID, &cs.SessionID, &cs.UserID, &cs.WorkspaceID, &cs.Mode, &cs.ChatType, &cs.CreatedAt, &cs.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan feishu chat session failed: %w", err)
		}
		list = append(list, cs)
	}
	return list, rows.Err()
}

// getChatSession 查询飞书会话映射，不存在时返回 sql.ErrNoRows 包装错误。
func (s *DBFeishuService) getChatSession(chatID string) (object.FeishuChatSession, error) {
	var cs object.FeishuChatSession
	err := s.db.QueryRow(`
		SELECT chat_id, session_id, user_id, workspace_id, mode, chat_type, created_at, updated_at
		FROM feishu_chat_sessions WHERE chat_id = $1
	`, chatID).Scan(&cs.ChatID, &cs.SessionID, &cs.UserID, &cs.WorkspaceID, &cs.Mode, &cs.ChatType, &cs.CreatedAt, &cs.UpdatedAt)
	if err != nil {
		return object.FeishuChatSession{}, err
	}
	return cs, nil
}

// upsertChatSession 插入或更新飞书会话映射。
func (s *DBFeishuService) upsertChatSession(cs object.FeishuChatSession) error {
	_, err := s.db.Exec(`
		INSERT INTO feishu_chat_sessions (chat_id, session_id, user_id, workspace_id, mode, chat_type)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (chat_id) DO UPDATE SET
			session_id = EXCLUDED.session_id,
			user_id = EXCLUDED.user_id,
			workspace_id = EXCLUDED.workspace_id,
			mode = EXCLUDED.mode,
			chat_type = EXCLUDED.chat_type
	`, cs.ChatID, cs.SessionID, cs.UserID, cs.WorkspaceID, string(cs.Mode), string(cs.ChatType))
	if err != nil {
		return fmt.Errorf("upsert feishu chat session failed: %w", err)
	}
	return nil
}
