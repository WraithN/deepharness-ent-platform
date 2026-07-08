-- 迁移：tenants 表新增 display_id 列，原 id 改为 UUID 作为业务主键
-- 策略：
--   1. 新增 display_id 列（展示用，如 t1, t2...）
--   2. 原 id 列从 't1' 改为 UUID4 去横线格式（业务关联用）
--   3. __system__ 保持不变（系统租户，类似 ws-default）
--   4. 级联更新 users.tenant_id 和 workspaces.tenant_id

-- Step 1: 新增 display_id 列
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS display_id VARCHAR(20);
COMMENT ON COLUMN tenants.display_id IS '租户展示 ID（如 t1, t2...），仅用于展示';

-- Step 2: 将原 id 值复制到 display_id
UPDATE tenants SET display_id = id WHERE display_id IS NULL;

-- Step 3: 为 t1 生成 UUID（__system__ 保持不变）
-- 先删除外键约束，再更新引用，最后重建外键
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_tenant;

-- 生成 t1 的新 UUID
DO $$
DECLARE
    new_tenant_uuid VARCHAR(32);
BEGIN
    SELECT replace(gen_random_uuid()::text, '-', '') INTO new_tenant_uuid;
    
    -- 更新 users.tenant_id
    UPDATE users SET tenant_id = new_tenant_uuid WHERE tenant_id = 't1';
    
    -- 更新 workspaces.tenant_id
    UPDATE workspaces SET tenant_id = new_tenant_uuid WHERE tenant_id = 't1';
    
    -- 更新 tenants.id（主键）
    UPDATE tenants SET id = new_tenant_uuid WHERE id = 't1';
END $$;

-- Step 4: 重建外键约束
ALTER TABLE users 
    ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Step 5: 创建序列用于自动生成 display_id（t1, t2, t3...）
CREATE SEQUENCE IF NOT EXISTS tenant_display_id_seq START 2;

-- Step 6: 为 display_id 添加唯一索引（排除系统租户）
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_display_id 
    ON tenants (display_id) WHERE display_id != '__system__';
