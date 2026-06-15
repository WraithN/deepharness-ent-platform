-- 虾班智守（Personal Assistant）Schema（PostgreSQL 15+）
-- 说明：
--   - UUID 使用 UUID 类型存储，由应用层生成。
--   - 时间戳使用 TIMESTAMPTZ，统一 UTC。
--   - 表引擎使用 InnoDB，字符集 utf8mb4。

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS personal_assistants (
    id UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    role VARCHAR(50) NOT NULL,
    description TEXT,
    creator_id UUID NOT NULL,
    creator_name VARCHAR(200) NOT NULL,
    avatar_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pa_creator ON personal_assistants (creator_id);
CREATE INDEX IF NOT EXISTS idx_pa_role ON personal_assistants (role);

DROP TRIGGER IF EXISTS trigger_personal_assistants_updated_at ON personal_assistants;
CREATE TRIGGER trigger_personal_assistants_updated_at
BEFORE UPDATE ON personal_assistants
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS personal_assistant_sessions (
    id UUID PRIMARY KEY,
    assistant_id UUID NOT NULL,
    title VARCHAR(500) NOT NULL DEFAULT '新会话',
    message_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pa_sessions_assistant FOREIGN KEY (assistant_id) REFERENCES personal_assistants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pa_sessions_assistant ON personal_assistant_sessions (assistant_id);

DROP TRIGGER IF EXISTS trigger_personal_assistant_sessions_updated_at ON personal_assistant_sessions;
CREATE TRIGGER trigger_personal_assistant_sessions_updated_at
BEFORE UPDATE ON personal_assistant_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS personal_assistant_messages (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pa_messages_session FOREIGN KEY (session_id) REFERENCES personal_assistant_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pa_messages_session ON personal_assistant_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_pa_messages_created ON personal_assistant_messages (created_at);
