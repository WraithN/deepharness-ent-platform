-- 虾班智守（Personal Assistant）Schema（MySQL 8.0）
-- 说明：
--   - UUID 使用 CHAR(36) 存储，由应用层生成。
--   - 时间戳使用 DATETIME(3) 保留毫秒精度，统一 UTC。
--   - 表引擎使用 InnoDB，字符集 utf8mb4。

CREATE TABLE IF NOT EXISTS personal_assistants (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    role VARCHAR(50) NOT NULL,
    description TEXT,
    creator_id CHAR(36) NOT NULL,
    creator_name VARCHAR(200) NOT NULL,
    avatar_url VARCHAR(500),
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
    INDEX idx_pa_creator (creator_id),
    INDEX idx_pa_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personal_assistant_sessions (
    id CHAR(36) PRIMARY KEY,
    assistant_id CHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL DEFAULT '新会话',
    message_count INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
    CONSTRAINT fk_pa_sessions_assistant FOREIGN KEY (assistant_id) REFERENCES personal_assistants(id) ON DELETE CASCADE,
    INDEX idx_pa_sessions_assistant (assistant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personal_assistant_messages (
    id CHAR(36) PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_pa_messages_session FOREIGN KEY (session_id) REFERENCES personal_assistant_sessions(id) ON DELETE CASCADE,
    INDEX idx_pa_messages_session (session_id),
    INDEX idx_pa_messages_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
