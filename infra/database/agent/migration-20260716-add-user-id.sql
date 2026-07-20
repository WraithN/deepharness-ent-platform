-- 2026-07-16 为 agent_sessions 增加 user_id，实现会话按用户隔离。
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace_user ON agent_sessions (workspace_id, user_id);
