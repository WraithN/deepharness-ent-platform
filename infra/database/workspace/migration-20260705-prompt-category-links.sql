-- 2026-07-05: 空间提示词与分类改为多对多关联
-- 说明：
--   1. 新增 workspace_prompt_category_links 关联表。
--   2. 把现有的单 category_id 迁移到关联表。
--   3. 删除 workspace_prompts.category_id 字段。

CREATE TABLE IF NOT EXISTS workspace_prompt_category_links (
    prompt_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (prompt_id, category_id)
);

COMMENT ON TABLE workspace_prompt_category_links IS '空间提示词与分类的多对多关联表';
COMMENT ON COLUMN workspace_prompt_category_links.prompt_id IS '空间提示词 ID';
COMMENT ON COLUMN workspace_prompt_category_links.category_id IS '分类 ID';

CREATE INDEX IF NOT EXISTS idx_workspace_prompt_category_links_category_id
    ON workspace_prompt_category_links (category_id);

-- 迁移现有的单分类关系到关联表
INSERT INTO workspace_prompt_category_links (prompt_id, category_id)
SELECT id, category_id
FROM workspace_prompts
WHERE category_id IS NOT NULL AND category_id <> ''
ON CONFLICT (prompt_id, category_id) DO NOTHING;

-- 删除单分类字段
ALTER TABLE workspace_prompts DROP COLUMN IF EXISTS category_id;
