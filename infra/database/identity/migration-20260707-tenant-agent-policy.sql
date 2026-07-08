-- 迁移：tenants 表增加智能体策略列
-- 将原 workspaces 表上的智能体策略迁移到 tenants 表（租户维度统一管理）

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_config_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locked_agent_keys TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allowed_agent_keys TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_agent_configs JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN tenants.agent_config_locked IS '超管是否整体锁定该租户的智能体配置';
COMMENT ON COLUMN tenants.locked_agent_keys IS '被超管单独锁定的智能体 key 列表';
COMMENT ON COLUMN tenants.allowed_agent_keys IS '超管为该租户允许使用的智能体 key 列表';
COMMENT ON COLUMN tenants.default_agent_configs IS '超管为该租户预设的默认智能体配置快照';

-- 将 ws-default 空间的智能体策略迁移到其所属租户 t1
UPDATE tenants SET
    agent_config_locked = w.agent_config_locked,
    locked_agent_keys = w.locked_agent_keys,
    allowed_agent_keys = w.allowed_agent_keys,
    default_agent_configs = w.default_agent_configs
FROM workspaces w
WHERE w.id = 'ws-default' AND tenants.id = w.tenant_id;
