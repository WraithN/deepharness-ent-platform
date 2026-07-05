-- 2026-07-05: 空间提示词支持独立 category 管理
-- 说明：
--   1. 新增 workspace_prompt_categories 表，每个空间独立维护自己的分类。
--   2. workspace_prompts 增加 category_id 外键（应用层维护，不建 FK）。
--   3. 将现有的 use_case 数据迁移为分类，方便平滑过渡；后续 UI 按 category 展示。

CREATE TABLE IF NOT EXISTS workspace_prompt_categories (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workspace_prompt_categories IS '空间提示词分类（每个空间独立管理）';
COMMENT ON COLUMN workspace_prompt_categories.id IS '分类 ID';
COMMENT ON COLUMN workspace_prompt_categories.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN workspace_prompt_categories.name IS '分类名称';
COMMENT ON COLUMN workspace_prompt_categories.created_at IS '创建时间';
COMMENT ON COLUMN workspace_prompt_categories.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_workspace_prompt_categories_workspace_id
    ON workspace_prompt_categories (workspace_id);

DROP TRIGGER IF EXISTS trigger_workspace_prompt_categories_updated_at
    ON workspace_prompt_categories;
CREATE TRIGGER trigger_workspace_prompt_categories_updated_at
BEFORE UPDATE ON workspace_prompt_categories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 为 workspace_prompts 增加 category_id 字段
ALTER TABLE workspace_prompts
    ADD COLUMN IF NOT EXISTS category_id VARCHAR(36);

COMMENT ON COLUMN workspace_prompts.category_id IS '所属分类 ID（NULL 表示未分类）';

CREATE INDEX IF NOT EXISTS idx_workspace_prompts_category_id
    ON workspace_prompts (workspace_id, category_id);

-- 迁移：把现有每个空间下不同的 use_case 值转换成 category
-- 插入时去重，避免同一空间同一分类重复创建。
INSERT INTO workspace_prompt_categories (id, workspace_id, name, created_at, updated_at)
SELECT
    gen_random_uuid()::text,
    wp.workspace_id,
    wp.use_case,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT workspace_id, use_case
    FROM workspace_prompts
    WHERE use_case IS NOT NULL AND use_case <> ''
) wp
WHERE NOT EXISTS (
    SELECT 1
    FROM workspace_prompt_categories c
    WHERE c.workspace_id = wp.workspace_id AND c.name = wp.use_case
);

-- 将 workspace_prompts 的 category_id 指向刚创建的分类
UPDATE workspace_prompts wp
SET category_id = c.id
FROM workspace_prompt_categories c
WHERE wp.workspace_id = c.workspace_id
  AND wp.use_case = c.name
  AND wp.category_id IS NULL;
