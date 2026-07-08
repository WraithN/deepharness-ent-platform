-- 产品文档模块 Schema（PostgreSQL 15+）
-- 说明：本文件为产品经理（PM）专属文档模型，支持文档草稿、发布状态与版本历史。

-- 产品文档主表
CREATE TABLE IF NOT EXISTS product_docs (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    slug VARCHAR(500) NOT NULL,
    content TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft / published / archived
    category VARCHAR(100),
    created_by VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_product_docs_workspace ON product_docs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_product_docs_status ON product_docs (status);
CREATE INDEX IF NOT EXISTS idx_product_docs_category ON product_docs (category);

DROP TRIGGER IF EXISTS trigger_product_docs_updated_at ON product_docs;
CREATE TRIGGER trigger_product_docs_updated_at
BEFORE UPDATE ON product_docs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 产品文档版本历史表
CREATE TABLE IF NOT EXISTS product_doc_versions (
    id VARCHAR(36) PRIMARY KEY,
    doc_id VARCHAR(36) NOT NULL REFERENCES product_docs(id) ON DELETE CASCADE,
    version INT NOT NULL,
    title VARCHAR(500),
    content TEXT,
    change_summary VARCHAR(500),
    created_by VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doc_id, version)
);

CREATE INDEX IF NOT EXISTS idx_product_doc_versions_doc ON product_doc_versions (doc_id);
