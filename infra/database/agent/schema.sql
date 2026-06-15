-- 智能会话（Agent Chat）Schema（MySQL 8.0）
-- 说明：
--   - UUID 使用 CHAR(36) 存储，由应用层生成。
--   - 时间戳使用 DATETIME(3) 保留毫秒精度，统一 UTC。
--   - context / metadata 使用 JSON 类型存储。

CREATE TABLE IF NOT EXISTS agent_sessions (
    id CHAR(36) PRIMARY KEY,
    workspace_id CHAR(36) NOT NULL DEFAULT '',
    agent_id CHAR(36) NOT NULL DEFAULT '',
    agent_type VARCHAR(50) NOT NULL DEFAULT 'opencode',
    model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
    project_id VARCHAR(50),
    title VARCHAR(500),
    context JSON,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
    INDEX idx_agent_sessions_workspace (workspace_id),
    INDEX idx_agent_sessions_agent (agent_id),
    INDEX idx_agent_sessions_updated (updated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_messages (
    id CHAR(36) PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    metadata JSON,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_agent_messages_session FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    INDEX idx_agent_messages_session (session_id, created_at ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
