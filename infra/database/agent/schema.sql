-- 智能会话（Agent Chat）Schema（PostgreSQL 15+）
-- 说明：
--   - UUID 使用 UUID 类型存储，由应用层生成。
--   - 时间戳使用 TIMESTAMPTZ，统一 UTC。
--   - context / metadata 使用 JSONB 类型存储。

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS agent_sessions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    agent_type VARCHAR(50) NOT NULL DEFAULT 'opencode',
    model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
    project_id VARCHAR(50),
    title VARCHAR(500),
    context JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace ON agent_sessions (workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions (updated_at DESC);

DROP TRIGGER IF EXISTS trigger_agent_sessions_updated_at ON agent_sessions;
CREATE TRIGGER trigger_agent_sessions_updated_at
BEFORE UPDATE ON agent_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_messages_session FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages (session_id, created_at ASC);
