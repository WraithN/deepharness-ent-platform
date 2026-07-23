-- 原型工程模版表
-- 管理可复用的原型工程骨架，供 /proto-make 指令按场景描述自动选用。
-- 模版源码解压到 ${workspace_root}/shares/prototypes-templates/{id}/，依赖由后台触发 pnpm install 预装。

CREATE TABLE IF NOT EXISTS prototype_templates (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    dir_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    has_node_modules BOOLEAN NOT NULL DEFAULT FALSE,
    install_log TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prototype_templates_name
    ON prototype_templates (name);

CREATE INDEX IF NOT EXISTS idx_prototype_templates_status
    ON prototype_templates (status);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prototype_templates_updated_at ON prototype_templates;
CREATE TRIGGER trigger_prototype_templates_updated_at
BEFORE UPDATE ON prototype_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
