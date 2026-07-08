-- 20260707: 为工作空间增加 locked_agent_keys 列（单独锁定某些智能体）
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS locked_agent_keys TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN workspaces.locked_agent_keys IS '单独锁定的 agent key 数组；agentConfigLocked 为 false 时，此列表中的 agent 仍被锁定';
