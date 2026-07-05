-- 提示词市场状态审核字段迁移
-- 为 team_prompts 表增加状态、创建人、审核人字段

ALTER TABLE team_prompts
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(36),
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(36),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- 先移除默认约束再添加 CHECK，避免已存在数据不满足默认值
ALTER TABLE team_prompts
  DROP CONSTRAINT IF EXISTS chk_team_prompts_status;

-- 将存量数据统一设置为已上架，避免新建逻辑与历史数据冲突
UPDATE team_prompts SET status = 'on_shelf' WHERE status = 'pending_review';

ALTER TABLE team_prompts
  ADD CONSTRAINT chk_team_prompts_status CHECK (status IN ('pending_review', 'on_shelf', 'off_shelf', 'rejected'));

-- 可选：为创建人和审核人添加索引，便于按用户过滤
CREATE INDEX IF NOT EXISTS idx_team_prompts_created_by ON team_prompts (created_by);
CREATE INDEX IF NOT EXISTS idx_team_prompts_status ON team_prompts (status);
