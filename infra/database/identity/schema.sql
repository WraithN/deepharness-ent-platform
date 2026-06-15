-- 身份与租户 Schema（MySQL 8.0）
-- 说明：本文件由 PostgreSQL 方言迁移至 MySQL 方言。
-- - UUID 类型使用 CHAR(36) 存储 UUID 字符串，由应用层生成。
-- - 时间戳使用 DATETIME(3) 保留毫秒精度，时区由应用层处理。
-- - 表引擎统一使用 InnoDB 以支持外键约束。
CREATE TABLE IF NOT EXISTS tenants (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    tenant_id CHAR(36) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
