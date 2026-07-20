-- 为 workspace_agent_configs 增加默认智能体标记
ALTER TABLE workspace_agent_configs ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN workspace_agent_configs.is_default IS '是否为当前空间默认智能体（最多一个）';
