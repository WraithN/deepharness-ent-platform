-- 产品空间功能：扩展 product_docs / product_doc_versions 表

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS user_id VARCHAR(36) NOT NULL DEFAULT '';

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'doc';

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS relative_path VARCHAR(1000) NOT NULL DEFAULT '';

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1;

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS file_ext VARCHAR(50);

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(200);

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

-- 旧表有 (workspace_id, slug) 唯一约束；产品空间改用 (workspace_id, user_id, relative_path)
ALTER TABLE product_docs
    DROP CONSTRAINT IF EXISTS product_docs_workspace_id_slug_key;

-- 对旧数据做回填，避免默认空 relative_path 导致新唯一约束冲突
UPDATE product_docs
SET relative_path = slug
WHERE relative_path = '';

ALTER TABLE product_docs
    ADD CONSTRAINT product_docs_ws_user_path UNIQUE (workspace_id, user_id, relative_path);

CREATE INDEX IF NOT EXISTS idx_product_docs_workspace_user ON product_docs (workspace_id, user_id);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS file_path VARCHAR(2000);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS file_ext VARCHAR(50);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(200);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
