-- 身份与租户 Schema（PostgreSQL 15+）
-- 说明：本文件由 MySQL 方言迁移至 PostgreSQL 方言。
-- - ID 使用 VARCHAR(36) 存储，由应用层生成。
-- - 时间戳使用 TIMESTAMPTZ，时区由应用层处理。

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- pgcrypto 用于生成密码哈希（bcrypt）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

COMMENT ON TABLE users IS '平台用户';
COMMENT ON COLUMN users.password_hash IS '密码 bcrypt 哈希，所有种子用户默认密码 123456';

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

-- 初始化租户与种子用户（密码均为 123456，使用 bcrypt 哈希）
INSERT INTO tenants (id, name) VALUES ('t1', 'DeepHarness')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, tenant_id, email, name, role, password_hash) VALUES
  ('u1', 't1', 'xiaoming@deepharness.com', '开发者小明', 'admin', crypt('123456', gen_salt('bf'))),
  ('u2', 't1', 'xiaohong@deepharness.com', '产品小红', 'user', crypt('123456', gen_salt('bf'))),
  ('u3', 't1', 'xiaoli@deepharness.com', '设计小李', 'user', crypt('123456', gen_salt('bf'))),
  ('u4', 't1', 'xiaogang@deepharness.com', '测试小刚', 'user', crypt('123456', gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;
