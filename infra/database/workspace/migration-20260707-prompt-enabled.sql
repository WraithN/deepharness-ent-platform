-- 为 workspace_prompts 增加 enabled 字段，用于控制提示词是否在会话输入框下拉菜单中展示。
ALTER TABLE workspace_prompts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN workspace_prompts.enabled IS '是否启用，未启用时不展示在会话输入框下拉菜单';
CREATE INDEX IF NOT EXISTS idx_workspace_prompts_enabled ON workspace_prompts (workspace_id, enabled);
