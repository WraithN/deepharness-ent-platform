-- 通知系统 Schema
-- 用于存储用户通知，支持需求分配通知、AI开发状态通知、评审完成通知等

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL DEFAULT '',
    workspace_id VARCHAR(36) NOT NULL DEFAULT '',
    type VARCHAR(32) NOT NULL,
    title VARCHAR(256) NOT NULL,
    body TEXT,
    data JSONB,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    action_type VARCHAR(32),
    action_status VARCHAR(32) DEFAULT 'pending',
    action_url VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user ON notifications(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_ws_unread ON notifications(workspace_id, user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
