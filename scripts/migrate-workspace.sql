-- 工作空间数据模型迁移脚本
-- 将现有数据迁移到新的 workspace 模型，支持幂等多次执行

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- 1. 创建默认工作空间（幂等）
INSERT INTO workspaces (id, tenant_id, name, description, created_at, updated_at)
SELECT 'ws-default', 't1', '默认工作空间', '迁移生成的默认空间', NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = 'ws-default');

-- 2. 将所有已有用户加入默认工作空间（管理员 / PM）
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
SELECT 'ws-default', id, 'admin', 'pm', created_at FROM users;

-- 3. 迁移 team_skills -> skill_library + workspace_skills
-- 3.1 将团队技能写入全局技能库；已存在则更新元信息。
-- 注意：team_skills 没有 content 字段，因此 skill_library.content 保持原值，避免重跑时被 NULL 覆盖。
INSERT INTO skill_library (id, name, description, category, tags, downloads, rating, icon, phase)
SELECT id, name, description, category, tags, downloads, rating, icon, phase
FROM team_skills
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  category = VALUES(category),
  tags = VALUES(tags),
  downloads = VALUES(downloads),
  rating = VALUES(rating),
  icon = VALUES(icon),
  phase = VALUES(phase);

-- 3.2 为默认工作空间安装这些技能（幂等：使用固定组合 ID）
INSERT IGNORE INTO workspace_skills (
  id, workspace_id, library_skill_id, name, description, category, tags,
  downloads, rating, icon, phase, content, is_custom, installed, created_at, updated_at
)
SELECT
  CONCAT('ws-default-', ts.id),
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
  0,
  1,
  NOW(3),
  NOW(3)
FROM team_skills ts;

-- 4. 迁移 team_prompts -> prompt_library + workspace_prompts
-- 4.1 将团队提示词写入全局提示词库；已存在则更新元信息
INSERT INTO prompt_library (id, name, description, content, use_case, usage_count)
SELECT id, name, description, content, use_case, usage_count
FROM team_prompts
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  content = VALUES(content),
  use_case = VALUES(use_case),
  usage_count = VALUES(usage_count);

-- 4.2 为默认工作空间安装这些提示词（幂等：使用固定组合 ID）
INSERT IGNORE INTO workspace_prompts (
  id, workspace_id, library_prompt_id, name, description, content,
  use_case, usage_count, is_custom, added_to_space, created_at, updated_at
)
SELECT
  CONCAT('ws-default-', tp.id),
  'ws-default',
  tp.id,
  tp.name,
  tp.description,
  tp.content,
  tp.use_case,
  tp.usage_count,
  0,
  tp.added_to_space,
  NOW(3),
  NOW(3)
FROM team_prompts tp;

-- 5. 为 agent_sessions 补充 workspace_id / agent_id 列（条件式，幂等）
SET @add_workspace_col = IF(
  NOT EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_sessions'
      AND column_name = 'workspace_id'
  ),
  'ALTER TABLE agent_sessions ADD COLUMN workspace_id CHAR(36) NOT NULL DEFAULT "" AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @add_workspace_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_agent_col = IF(
  NOT EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_sessions'
      AND column_name = 'agent_id'
  ),
  'ALTER TABLE agent_sessions ADD COLUMN agent_id CHAR(36) NOT NULL DEFAULT "" AFTER workspace_id',
  'SELECT 1'
);
PREPARE stmt FROM @add_agent_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. 创建默认 Agent（幂等）
INSERT INTO agents (id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at)
SELECT 'agent-default', 'ws-default', '默认智能体', 'general', '迁移生成的默认智能体', '{}', 1, 'u1', NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE id = 'agent-default');

-- 7. 回填已有会话的默认工作空间与默认 Agent。
-- 警告：此步骤为一次性初始回填。若应用已运行并产生新的未归属会话，重跑该脚本也会将其归到默认空间。
-- 请在确认无新增未归属会话后执行，或根据 created_at 限定迁移范围。
UPDATE agent_sessions
SET workspace_id = 'ws-default', agent_id = 'agent-default'
WHERE workspace_id IS NULL OR workspace_id = '';

-- 8. 为 agent_sessions 新增列添加索引（幂等）
SET @create_idx_workspace = IF(
  NOT EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_sessions'
      AND index_name = 'idx_agent_sessions_workspace'
  ),
  'CREATE INDEX idx_agent_sessions_workspace ON agent_sessions(workspace_id)',
  'SELECT 1'
);
PREPARE stmt FROM @create_idx_workspace;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @create_idx_agent = IF(
  NOT EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_sessions'
      AND index_name = 'idx_agent_sessions_agent'
  ),
  'CREATE INDEX idx_agent_sessions_agent ON agent_sessions(agent_id)',
  'SELECT 1'
);
PREPARE stmt FROM @create_idx_agent;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
