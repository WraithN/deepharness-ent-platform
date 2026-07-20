-- 技能配置按工作区隔离
-- 1. 技能分类增加 workspace_id，允许不同工作区有同名分类。
-- 2. 新增 workspace_skill_installs 记录每个工作区对每个技能的安装状态。

ALTER TABLE team_skill_categories
    ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(36);

-- 移除全局唯一名称约束，改为按工作区唯一（全局分类 workspace_id 为 NULL，仍保持唯一）。
ALTER TABLE team_skill_categories
    DROP CONSTRAINT IF EXISTS team_skill_categories_name_key;
ALTER TABLE team_skill_categories
    DROP CONSTRAINT IF EXISTS uq_team_skill_categories_name_workspace;
ALTER TABLE team_skill_categories
    ADD CONSTRAINT uq_team_skill_categories_name_workspace UNIQUE (name, COALESCE(workspace_id, ''));

CREATE INDEX IF NOT EXISTS idx_team_skill_categories_workspace ON team_skill_categories(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_skill_installs (
    workspace_id VARCHAR(36) NOT NULL,
    skill_id VARCHAR(36) NOT NULL REFERENCES team_skills(id) ON DELETE CASCADE,
    installed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_skill_installs_skill ON workspace_skill_installs(skill_id);

DROP TRIGGER IF EXISTS trigger_workspace_skill_installs_updated_at ON workspace_skill_installs;
CREATE TRIGGER trigger_workspace_skill_installs_updated_at
BEFORE UPDATE ON workspace_skill_installs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
