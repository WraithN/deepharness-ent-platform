-- 审计事件 Schema（PostgreSQL 15+）
CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(200) NOT NULL,
    resource VARCHAR(200) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events (action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events (created_at DESC);

-- 种子数据：原 mock 数据迁移至数据库
INSERT INTO audit_events (id, tenant_id, user_id, action, resource, details, created_at) VALUES
('evt-001', 't1', 'u1', 'login', 'user', '{"ip":"192.168.1.100","device":"Chrome/macOS"}', '2026-06-10T08:30:00Z'),
('evt-002', 't1', 'u2', 'create_workitem', 'requirement', '{"workitemId":"REQ-005","title":"API 网关限流配置"}', '2026-06-09T14:20:00Z'),
('evt-003', 't1', 'u1', 'update_workitem', 'defect', '{"workitemId":"BUG-002","field":"status","oldValue":"open","newValue":"in_progress"}', '2026-06-09T10:15:00Z'),
('evt-004', 't1', 'u4', 'run_testcase', 'testcase', '{"workitemId":"TC-003","result":"failed"}', '2026-06-08T16:45:00Z'),
('evt-005', 't1', 'u3', 'create_skill', 'skill', '{"skillId":"s9","name":"前端性能优化助手"}', '2026-06-07T09:00:00Z')
ON CONFLICT (id) DO NOTHING;
