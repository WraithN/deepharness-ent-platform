-- 平台模板 Schema（PostgreSQL 15+）
-- 存储平台级可复用模板，按 category + key 唯一索引，按 category + label 去重（label 为空时不参与）。

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS platform_templates (
    id BIGSERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    key VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_templates_category_key
    ON platform_templates (category, key);

-- 仅对非空 label 做唯一性约束，避免历史空 label 数据冲突。
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_templates_category_label
    ON platform_templates (category, label)
    WHERE label <> '';

DROP TRIGGER IF EXISTS trigger_platform_templates_updated_at ON platform_templates;
CREATE TRIGGER trigger_platform_templates_updated_at
BEFORE UPDATE ON platform_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
