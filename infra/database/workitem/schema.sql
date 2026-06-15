-- 工作项统一 Schema（MySQL 8.0）
-- 说明：本文件由 PostgreSQL 方言迁移至 MySQL 方言。
-- - UUID 类型使用 CHAR(36) 存储 UUID 字符串，由应用层生成。
-- - 时间戳使用 DATETIME(3) 保留毫秒精度，时区由应用层处理。
-- - 表引擎统一使用 InnoDB。
CREATE TABLE IF NOT EXISTS workitems (
    id CHAR(36) PRIMARY KEY,
    tenant_id CHAR(36) NOT NULL,
    project_id CHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'todo',
    priority VARCHAR(50) NOT NULL DEFAULT 'medium',
    assignee_id CHAR(36),
    source VARCHAR(100) NOT NULL DEFAULT 'internal',
    external_id VARCHAR(200),
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    INDEX idx_workitems_tenant (tenant_id),
    INDEX idx_workitems_project (project_id),
    INDEX idx_workitems_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
