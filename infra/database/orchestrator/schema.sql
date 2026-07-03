-- Agent 编排会话 Schema（PostgreSQL 15+）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS orchestrator_sessions (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    agent_type VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_status ON orchestrator_sessions (status);
CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_updated ON orchestrator_sessions (updated_at DESC);

DROP TRIGGER IF EXISTS trigger_orchestrator_sessions_updated_at ON orchestrator_sessions;
CREATE TRIGGER trigger_orchestrator_sessions_updated_at
BEFORE UPDATE ON orchestrator_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 种子数据：原 mock 数据迁移至数据库
INSERT INTO orchestrator_sessions (id, title, agent_type, model, status, created_at, updated_at) VALUES
('sess-001', '实现登录页面UI', 'ui-designer', 'gpt-4o', 'completed', '2026-06-10T09:00:00Z', '2026-06-10T09:15:00Z'),
('sess-002', '用户管理模块需求分析', 'requirement-analyst', 'gpt-4o', 'completed', '2026-06-09T14:00:00Z', '2026-06-09T14:30:00Z'),
('sess-003', '修复API跨域问题', 'code-assistant', 'gpt-4o', 'completed', '2026-06-08T10:00:00Z', '2026-06-08T10:20:00Z'),
('sess-004', '重构数据库表结构', 'code-assistant', 'claude-3-5-sonnet', 'completed', '2026-06-07T16:00:00Z', '2026-06-07T16:45:00Z'),
('sess-005', '订单模块接口设计', 'api-designer', 'gpt-4o', 'active', '2026-06-06T09:00:00Z', '2026-06-10T08:00:00Z')
ON CONFLICT (id) DO NOTHING;
