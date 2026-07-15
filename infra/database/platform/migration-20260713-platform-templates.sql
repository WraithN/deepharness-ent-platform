-- 平台模板表迁移（2026-07-13）
-- 为已运行的数据库补充 platform_templates 表及触发器。

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_templates_category_key
    ON platform_templates (category, key);

DROP TRIGGER IF EXISTS trigger_platform_templates_updated_at ON platform_templates;
CREATE TRIGGER trigger_platform_templates_updated_at
BEFORE UPDATE ON platform_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
