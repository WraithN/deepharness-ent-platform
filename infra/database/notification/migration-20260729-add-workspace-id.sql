-- 通知系统迁移：添加 workspace_id 列
-- 修复已有数据库实例中 notifications 表缺少 workspace_id 列的问题

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(36) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_ws_unread ON notifications(workspace_id, user_id, read) WHERE read = FALSE;
