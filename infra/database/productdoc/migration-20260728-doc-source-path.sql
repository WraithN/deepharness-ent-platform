-- 记录文档采纳时的源文件路径，用于后续清理个人工作区中的已采纳草稿。

BEGIN;

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS source_path VARCHAR(2000);

CREATE INDEX IF NOT EXISTS idx_product_docs_source_path ON product_docs (source_path);

COMMIT;
