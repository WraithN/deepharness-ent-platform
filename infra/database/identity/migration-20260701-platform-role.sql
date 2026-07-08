-- Migration 20260701: 平台角色重构
-- 将 users.role（单维度 superadmin/admin/user）重构为 users.platform_role，
-- 并引入系统租户 __system__ 承载超级管理员。
-- 适用：已按旧 schema.sql 初始化的数据库。

-- 1) 新增系统租户 __system__，承载 super_admin
INSERT INTO tenants (id, name) VALUES ('__system__', '系统租户（超级管理员承载）')
ON CONFLICT (id) DO NOTHING;

-- 2) users 表：role → platform_role 语义化重命名
ALTER TABLE users RENAME COLUMN role TO platform_role;

-- 3) 平台角色取值约束
ALTER TABLE users ADD CONSTRAINT chk_users_platform_role
  CHECK (platform_role IN ('super_admin', 'tenant_admin', 'user'));

-- 4) 超级管理员必须归属系统租户
ALTER TABLE users ADD CONSTRAINT chk_users_super_admin_tenant
  CHECK (platform_role <> 'super_admin' OR tenant_id = '__system__');

-- 5) 种子用户调整：
--    旧 u1（admin）→ 超级管理员，归属 __system__
--    u2~u5 补齐各职能业务用户（密码均为 123456）
UPDATE users SET platform_role = 'super_admin', tenant_id = '__system__',
                 email = 'admin@deepharness.com', name = '管理员'
  WHERE id = 'u1';

INSERT INTO users (id, tenant_id, email, name, platform_role, password_hash) VALUES
  ('a7390f0b07e245d9a7495682738153b5', 't1', 'pm@deepharness.com', '产品小红', 'user', crypt('123456', gen_salt('bf'))),
  ('2dd09f577fb1421d8204c504d325b359', 't1', 'designer@deepharness.com', '设计小李', 'user', crypt('123456', gen_salt('bf'))),
  ('9113acf484b540f2ab340d7c7a110d7c', 't1', 'developer@deepharness.com', '开发小明', 'user', crypt('123456', gen_salt('bf'))),
  ('98d9613544fe42dfa07840ea254d3019', 't1', 'tester@deepharness.com', '测试小刚', 'user', crypt('123456', gen_salt('bf')))
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  platform_role = EXCLUDED.platform_role,
  password_hash = EXCLUDED.password_hash,
  tenant_id = EXCLUDED.tenant_id;

COMMENT ON COLUMN users.platform_role IS '平台角色：super_admin（超级管理员，归属系统租户）/ tenant_admin（租户管理员）/ user（普通用户）';
