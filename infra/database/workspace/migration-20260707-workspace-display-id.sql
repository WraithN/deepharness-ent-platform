-- 20260707: 为工作空间增加 display_id 列（租户内自增展示 ID，格式 w1, w2...）
-- 并将已有空间的 id 去掉横线（UUID4 去横线）

-- 1. 增加 display_id 列
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS display_id VARCHAR(20);

COMMENT ON COLUMN workspaces.display_id IS '租户内展示 ID，格式 w1, w2...，每个租户独立自增';

-- 2. 为已有空间按租户分组、按创建时间排序回填 display_id
WITH ranked AS (
    SELECT id, tenant_id,
           ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC) AS seq
    FROM workspaces
    WHERE display_id IS NULL
)
UPDATE workspaces w
SET display_id = 'w' || ranked.seq::TEXT
FROM ranked
WHERE w.id = ranked.id;

-- 3. 去掉已有空间 id 中的横线（仅处理 UUID 格式，跳过 ws-default 等非 UUID ID）
-- 注意：需要同时更新 workspaces.id 和所有引用该 id 的子表
DO $$
DECLARE
    r RECORD;
    new_id TEXT;
BEGIN
    FOR r IN SELECT id FROM workspaces WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LOOP
        new_id := replace(r.id, '-', '');
        -- 更新子表外键引用
        UPDATE workspace_members SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workitem_projects SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE repositories SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE agents SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workspace_standards SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workspace_cicd SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workspace_prompts SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workspace_prompt_categories SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workspace_skills SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE workspace_agent_configs SET workspace_id = new_id WHERE workspace_id = r.id;
        UPDATE product_docs SET workspace_id = new_id WHERE workspace_id = r.id;
        -- 更新主表
        UPDATE workspaces SET id = new_id WHERE id = r.id;
    END LOOP;
END $$;

-- 4. 创建唯一索引（租户 + display_id）
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_display_id_tenant
    ON workspaces (tenant_id, display_id)
    WHERE display_id IS NOT NULL;
