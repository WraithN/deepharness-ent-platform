-- 需求与产品空间条目（文档/原型）关联映射表
-- 一个需求可关联多个文档或原型，通过本表建立多对多映射关系。
BEGIN;

CREATE TABLE IF NOT EXISTS workitem_doc_links (
    id VARCHAR(36) PRIMARY KEY,
    workitem_id VARCHAR(36) NOT NULL,
    product_space_item_id VARCHAR(36) NOT NULL,
    workspace_id VARCHAR(36) NOT NULL,
    item_type VARCHAR(50) NOT NULL DEFAULT 'doc',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workitem_id, product_space_item_id)
);

CREATE INDEX IF NOT EXISTS idx_workitem_doc_links_workitem ON workitem_doc_links (workitem_id);
CREATE INDEX IF NOT EXISTS idx_workitem_doc_links_item ON workitem_doc_links (product_space_item_id);
CREATE INDEX IF NOT EXISTS idx_workitem_doc_links_workspace ON workitem_doc_links (workspace_id);

COMMIT;
