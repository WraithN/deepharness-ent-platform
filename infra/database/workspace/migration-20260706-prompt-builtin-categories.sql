-- 为 workspace_prompt_categories 增加内置分类标记，并为所有已存在空间种子化系统内置分类。
-- 内置分类不可删除，在空间创建时也会自动同步生成。

ALTER TABLE workspace_prompt_categories
    ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN workspace_prompt_categories.is_builtin IS '是否为系统内置分类，不可删除';

-- 系统内置提示词分类列表。顺序即展示顺序。
DO $$
DECLARE
    ws RECORD;
    cat_name TEXT;
    builtin_names TEXT[] := ARRAY['通用', '代码开发', '需求分析', '产品设计', '测试', '运维', '文档'];
BEGIN
    FOR ws IN SELECT id FROM workspaces LOOP
        FOREACH cat_name IN ARRAY builtin_names LOOP
            INSERT INTO workspace_prompt_categories (id, workspace_id, name, is_builtin, created_at, updated_at)
            VALUES (gen_random_uuid()::TEXT, ws.id, cat_name, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
