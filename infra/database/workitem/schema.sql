-- 工作项统一 Schema（PostgreSQL 15+）
-- 说明：本文件由 MySQL 方言迁移至 PostgreSQL 方言。
-- - ID 使用 VARCHAR(36) 存储，由应用层生成。
-- - 时间戳使用 TIMESTAMPTZ，时区由应用层处理。
-- - 表引擎统一使用 InnoDB。

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS workitems (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'todo',
    priority VARCHAR(50) NOT NULL DEFAULT 'medium',
    assignee_id VARCHAR(36),
    source VARCHAR(100) NOT NULL DEFAULT 'internal',
    external_id VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workitems_tenant ON workitems (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workitems_project ON workitems (project_id);
CREATE INDEX IF NOT EXISTS idx_workitems_status ON workitems (status);

DROP TRIGGER IF EXISTS trigger_workitems_updated_at ON workitems;
CREATE TRIGGER trigger_workitems_updated_at
BEFORE UPDATE ON workitems
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
