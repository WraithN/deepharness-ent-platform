-- 身份与租户 Schema（PostgreSQL 15+）
-- 说明：
-- - ID 使用 VARCHAR(36) 存储用户唯一 ID，格式为 uuid4 去掉 `-`。
-- - 时间戳使用 TIMESTAMPTZ，时区由应用层处理。
-- - 平台角色 platform_role 取值：super_admin / tenant_admin / user。
-- - 超级管理员归属系统租户 __system__，不绑定业务租户。

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
    display_id VARCHAR(20) UNIQUE,
    name VARCHAR(200) NOT NULL,
    agent_config_locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_agent_keys TEXT[] NOT NULL DEFAULT '{}',
    allowed_agent_keys TEXT[] NOT NULL DEFAULT '{}',
    default_agent_configs JSONB NOT NULL DEFAULT '{}',
    cicd_config_id VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN tenants.id IS '租户业务 ID（uuid4 去掉 -），系统租户为 __system__';
COMMENT ON COLUMN tenants.display_id IS '租户展示 ID（如 t1, t2...），仅用于展示';
COMMENT ON COLUMN tenants.agent_config_locked IS '超管是否整体锁定该租户的智能体配置';
COMMENT ON COLUMN tenants.locked_agent_keys IS '被超管单独锁定的智能体 key 列表';
COMMENT ON COLUMN tenants.allowed_agent_keys IS '超管为该租户允许使用的智能体 key 列表';
COMMENT ON COLUMN tenants.default_agent_configs IS '超管为该租户预设的默认智能体配置快照';
COMMENT ON COLUMN tenants.cicd_config_id IS '关联的全局 CICD 配置 ID';

-- 租户 display_id 自增序列（t1, t2, t3...）
CREATE SEQUENCE IF NOT EXISTS tenant_display_id_seq START 1;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    platform_role VARCHAR(50) NOT NULL DEFAULT 'user',
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT chk_users_platform_role CHECK (platform_role IN ('super_admin', 'tenant_admin', 'user')),
    CONSTRAINT chk_users_super_admin_tenant CHECK (platform_role <> 'super_admin' OR tenant_id = '__system__')
);

COMMENT ON TABLE users IS '平台用户';
COMMENT ON COLUMN users.id IS '用户唯一 ID（uuid4 去掉 -）';
COMMENT ON COLUMN users.platform_role IS '平台角色：super_admin（超级管理员，归属系统租户）/ tenant_admin（租户管理员）/ user（普通用户）';
COMMENT ON COLUMN users.password_hash IS '密码 bcrypt 哈希，所有种子用户默认密码 123456';

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

-- 初始化系统租户（承载超级管理员）与业务租户
-- 系统租户 id 固定为 __system__，业务租户 id 使用 uuid4 去横线，display_id 使用 t1, t2...
INSERT INTO tenants (id, display_id, name) VALUES
  ('__system__', '__system__', '系统租户（超级管理员承载）'),
  ('d2e39f60241e48049c51155a124e83ba', 't1', 'DeepHarness')
ON CONFLICT (id) DO NOTHING;

-- 初始化种子用户（密码均为 123456，使用 bcrypt 哈希）
-- 用户 ID 为 uuid4 去掉 `-`，仅作为系统唯一标识；前端展示使用 workspace_members.display_id。
INSERT INTO users (id, tenant_id, email, name, platform_role, password_hash) VALUES
  ('5b577fdc9e8e406f81c695553dc74836', '__system__', 'admin@deepharness.com', '管理员', 'super_admin', crypt('123456', gen_salt('bf'))),
  ('a7390f0b07e245d9a7495682738153b5', 'd2e39f60241e48049c51155a124e83ba', 'pm@deepharness.com', '产品小红', 'user', crypt('123456', gen_salt('bf'))),
  ('2dd09f577fb1421d8204c504d325b359', 'd2e39f60241e48049c51155a124e83ba', 'designer@deepharness.com', '设计小李', 'user', crypt('123456', gen_salt('bf'))),
  ('9113acf484b540f2ab340d7c7a110d7c', 'd2e39f60241e48049c51155a124e83ba', 'developer@deepharness.com', '开发小明', 'user', crypt('123456', gen_salt('bf'))),
  ('98d9613544fe42dfa07840ea254d3019', 'd2e39f60241e48049c51155a124e83ba', 'tester@deepharness.com', '测试小刚', 'user', crypt('123456', gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;
