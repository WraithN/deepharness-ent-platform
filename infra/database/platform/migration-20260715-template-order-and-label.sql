-- 平台模板排序与重名检测迁移（2026-07-15）
-- 为已运行的数据库补充 sort_order 字段与 label 唯一性约束。

ALTER TABLE platform_templates
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- 按现有 id 顺序为每个分类回填 sort_order，保证已有数据顺序不变。
WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY category ORDER BY id) AS rn
    FROM platform_templates
)
UPDATE platform_templates
SET sort_order = ordered.rn
FROM ordered
WHERE platform_templates.id = ordered.id;

-- 确保后续 sort_order 必须有值。
ALTER TABLE platform_templates
    ALTER COLUMN sort_order SET NOT NULL;

-- 仅对非空 label 做唯一性约束，避免历史空 label 数据冲突。
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_templates_category_label
    ON platform_templates (category, label)
    WHERE label <> '';
