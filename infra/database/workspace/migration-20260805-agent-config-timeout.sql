-- 为 workspace_agent_configs 增加 SSE 看门狗无事件超时阈值字段，默认 120 秒。
ALTER TABLE workspace_agent_configs
    ADD COLUMN IF NOT EXISTS timeout INTEGER NOT NULL DEFAULT 120;

COMMENT ON COLUMN workspace_agent_configs.timeout IS 'SSE 看门狗无事件超时阈值（秒），默认 120';
