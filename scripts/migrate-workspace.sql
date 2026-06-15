-- 工作空间数据模型迁移脚本（PostgreSQL）
-- 将现有数据迁移到新的 workspace 模型，支持幂等多次执行

-- 1. 创建默认工作空间（幂等）
INSERT INTO workspaces (id, tenant_id, name, description, created_at, updated_at)
SELECT 'ws-default', 't1', '默认工作空间', '迁移生成的默认空间', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = 'ws-default');

-- 2. 将所有已有用户加入默认工作空间（管理员 / PM）
INSERT INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
SELECT 'ws-default', id, 'admin', 'pm', created_at FROM users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 3. 迁移 team_skills -> skill_library + workspace_skills
-- 3.1 将团队技能写入全局技能库；已存在则更新元信息。
-- 注意：team_skills 没有 content 字段，因此 skill_library.content 保持原值，避免重跑时被 NULL 覆盖。
INSERT INTO skill_library (id, name, description, category, tags, downloads, rating, icon, phase)
SELECT id, name, description, category, tags, downloads, rating, icon, phase
FROM team_skills
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  tags = EXCLUDED.tags,
  downloads = EXCLUDED.downloads,
  rating = EXCLUDED.rating,
  icon = EXCLUDED.icon,
  phase = EXCLUDED.phase;

-- 3.2 为默认工作空间安装这些技能（幂等：使用固定组合 ID）
INSERT INTO workspace_skills (
  id, workspace_id, library_skill_id, name, description, category, tags,
  downloads, rating, icon, phase, content, is_custom, installed, created_at, updated_at
)
SELECT
  'ws-default-' || ts.id,
  'ws-default',
  ts.id,
  ts.name,
  ts.description,
  ts.category,
  ts.tags,
  ts.downloads,
  ts.rating,
  ts.icon,
  ts.phase,
  NULL,
  FALSE,
  TRUE,
  NOW(),
  NOW()
FROM team_skills ts
ON CONFLICT (id) DO NOTHING;

-- 4. 迁移 team_prompts -> prompt_library + workspace_prompts
-- 4.1 将团队提示词写入全局提示词库；已存在则更新元信息
INSERT INTO prompt_library (id, name, description, content, use_case, usage_count)
SELECT id, name, description, content, use_case, usage_count
FROM team_prompts
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  content = EXCLUDED.content,
  use_case = EXCLUDED.use_case,
  usage_count = EXCLUDED.usage_count;

-- 4.2 为默认工作空间安装这些提示词（幂等：使用固定组合 ID）
INSERT INTO workspace_prompts (
  id, workspace_id, library_prompt_id, name, description, content,
  use_case, usage_count, is_custom, added_to_space, created_at, updated_at
)
SELECT
  'ws-default-' || tp.id,
  'ws-default',
  tp.id,
  tp.name,
  tp.description,
  tp.content,
  tp.use_case,
  tp.usage_count,
  FALSE,
  tp.added_to_space,
  NOW(),
  NOW()
FROM team_prompts tp
ON CONFLICT (id) DO NOTHING;

-- 5. 为 agent_sessions 补充 workspace_id / agent_id 列（条件式，幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_sessions' AND column_name = 'workspace_id'
  ) THEN
    EXECUTE 'ALTER TABLE agent_sessions ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT ''''';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_sessions' AND column_name = 'agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE agent_sessions ADD COLUMN agent_id VARCHAR(36) NOT NULL DEFAULT ''''';
  END IF;
END $$;

-- 6. 创建默认 Agent（幂等）
INSERT INTO agents (id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at)
SELECT 'agent-default', 'ws-default', '默认智能体', 'general', '迁移生成的默认智能体', '{}', TRUE, 'u1', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE id = 'agent-default');

-- 7. 回填已有会话的默认工作空间与默认 Agent。
-- 警告：此步骤为一次性初始回填。若应用已运行并产生新的未归属会话，重跑该脚本也会将其归到默认空间。
UPDATE agent_sessions
SET workspace_id = 'ws-default', agent_id = 'agent-default'
WHERE workspace_id IS NULL OR workspace_id = '';

-- 8. 为 agent_sessions 新增列添加索引（幂等）
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace ON agent_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id);
