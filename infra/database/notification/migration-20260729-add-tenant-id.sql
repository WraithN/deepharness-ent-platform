-- 通知系统迁移：添加 tenant_id 列，通知按租户+用户维度展示
-- workspace_id 保留作为来源标记，不再用于列表过滤

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT '';

-- 从 users 表回填 tenant_id
UPDATE notifications n
SET tenant_id = u.tenant_id
FROM users u
WHERE n.user_id = u.id AND n.tenant_id = '';

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user ON notifications(tenant_id, user_id);
