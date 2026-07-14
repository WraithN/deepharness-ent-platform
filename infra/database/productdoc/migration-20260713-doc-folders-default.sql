-- 产品文档目录默认目录迁移（2026-07-13）
-- is_default 标记每个工作空间的默认"未分类"目录：自动创建、不可删除。

ALTER TABLE product_doc_folders ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- 每个工作空间最多一个默认目录
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_doc_folders_default
    ON product_doc_folders (workspace_id) WHERE is_default;
