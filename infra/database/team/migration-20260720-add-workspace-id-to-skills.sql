-- 为 team_skills 添加 workspace_id 列，实现技能按工作区隔离。
-- 已有技能（全局技能）保持 workspace_id 为 NULL，表示所有工作区可见。

ALTER TABLE team_skills
    ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS idx_team_skills_workspace ON team_skills(workspace_id);
