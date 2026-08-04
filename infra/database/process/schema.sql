-- 流程追踪 Schema
-- 用于存储 AI 开发流程记录，包含阶段状态、关联会话等信息

CREATE TABLE IF NOT EXISTS processes (
    id VARCHAR(64) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    workitem_id VARCHAR(64) NOT NULL,
    title VARCHAR(256) NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'ai_dev',
    stages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processes_workspace ON processes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_processes_workitem ON processes(workitem_id);
CREATE INDEX IF NOT EXISTS idx_processes_created_at ON processes(created_at DESC);
