-- 产品文档目录迁移（2026-07-13）
-- 支持最多两级目录：一级目录 parent_id 为 NULL，二级目录 parent_id 指向一级目录。
-- 目录支持置顶（pinned）与排序（sort_order）；文档通过 folder_id 归属目录，可移动。

CREATE TABLE IF NOT EXISTS product_doc_folders (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    parent_id VARCHAR(36) REFERENCES product_doc_folders(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_doc_folders_workspace ON product_doc_folders (workspace_id);

-- 同一工作空间、同一父目录下目录名不区分大小写唯一（parent_id 为 NULL 时按 '' 参与比较）
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_doc_folders_unique_name
    ON product_doc_folders (workspace_id, COALESCE(parent_id, ''), lower(name));

-- 文档所属目录；目录删除时文档回到根目录（SET NULL）
ALTER TABLE product_docs ADD COLUMN IF NOT EXISTS folder_id VARCHAR(36)
    REFERENCES product_doc_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_docs_folder ON product_docs (folder_id);

DROP TRIGGER IF EXISTS trigger_product_doc_folders_updated_at ON product_doc_folders;
CREATE TRIGGER trigger_product_doc_folders_updated_at
BEFORE UPDATE ON product_doc_folders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
