-- 迁移：team_skills 审核状态 + 技能/提示词多分类链接表
-- 背景：超管后台技能管理需要与提示词对称的审核生命周期（pending_review/on_shelf/off_shelf/rejected），
-- 技能与提示词均从单分类（category/use_case 文本列）升级为多分类链接表。
-- 执行：docker exec -i deepharness-postgres psql -U deepharness -d deepharness < 本文件

-- 1. team_skills 审核状态列（与 team_prompts 对称）
ALTER TABLE team_skills ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'on_shelf';
ALTER TABLE team_skills ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(36);
ALTER TABLE team_skills ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_team_skills_status'
    ) THEN
        ALTER TABLE team_skills ADD CONSTRAINT chk_team_skills_status
            CHECK (status IN ('pending_review', 'on_shelf', 'off_shelf', 'rejected'));
    END IF;
END $$;
-- 存量数据按 installed 映射初始状态（已安装=已上架，未安装=已下架）
UPDATE team_skills SET status = CASE WHEN installed THEN 'on_shelf' ELSE 'off_shelf' END WHERE status = 'on_shelf' AND installed = FALSE;
UPDATE team_skills SET status = 'off_shelf' WHERE installed = FALSE AND status = 'on_shelf';

COMMENT ON COLUMN team_skills.status IS '审核生命周期状态：pending_review/on_shelf/off_shelf/rejected';
COMMENT ON COLUMN team_skills.reviewed_by IS '审核操作人用户 ID';
COMMENT ON COLUMN team_skills.reviewed_at IS '审核操作时间';

-- 2. 技能多分类链接表（镜像 workspace_prompt_category_links）
CREATE TABLE IF NOT EXISTS team_skill_category_links (
    skill_id VARCHAR(36) NOT NULL REFERENCES team_skills (id) ON DELETE CASCADE,
    category_id VARCHAR(36) NOT NULL REFERENCES team_skill_categories (id) ON DELETE CASCADE,
    PRIMARY KEY (skill_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_team_skill_cat_links_cat ON team_skill_category_links (category_id);
COMMENT ON TABLE team_skill_category_links IS '技能-分类多对多链接';

-- 3. 提示词多分类链接表
CREATE TABLE IF NOT EXISTS team_prompt_category_links (
    prompt_id VARCHAR(36) NOT NULL REFERENCES team_prompts (id) ON DELETE CASCADE,
    category_id VARCHAR(36) NOT NULL REFERENCES team_prompt_categories (id) ON DELETE CASCADE,
    PRIMARY KEY (prompt_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_team_prompt_cat_links_cat ON team_prompt_category_links (category_id);
COMMENT ON TABLE team_prompt_category_links IS '提示词-分类多对多链接';

-- 4. 存量单分类按名称匹配回填链接表（best-effort，名称不匹配的分类跳过）
INSERT INTO team_skill_category_links (skill_id, category_id)
SELECT s.id, c.id FROM team_skills s
JOIN team_skill_categories c ON c.name = s.category
WHERE s.category <> ''
ON CONFLICT DO NOTHING;

INSERT INTO team_prompt_category_links (prompt_id, category_id)
SELECT p.id, c.id FROM team_prompts p
JOIN team_prompt_categories c ON c.name = p.use_case
WHERE p.use_case <> ''
ON CONFLICT DO NOTHING;
