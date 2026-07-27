-- 需求级产品设计版本表
-- 每个版本代表一个需求在某一时刻的设计快照，可包含产品文档和产品原型。
BEGIN;

CREATE TABLE IF NOT EXISTS workitem_design_versions (
    id VARCHAR(36) PRIMARY KEY,
    workitem_id VARCHAR(36) NOT NULL,
    workspace_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    version_number INT NOT NULL,
    change_summary VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(36) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workitem_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_workitem_design_versions_workitem ON workitem_design_versions (workitem_id);
CREATE INDEX IF NOT EXISTS idx_workitem_design_versions_workspace ON workitem_design_versions (workspace_id);

CREATE TABLE IF NOT EXISTS workitem_design_version_items (
    id VARCHAR(36) PRIMARY KEY,
    design_version_id VARCHAR(36) NOT NULL,
    product_space_item_id VARCHAR(36) NOT NULL,
    product_doc_version_id INT NOT NULL,
    item_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (design_version_id) REFERENCES workitem_design_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workitem_design_version_items_design_version ON workitem_design_version_items (design_version_id);
CREATE INDEX IF NOT EXISTS idx_workitem_design_version_items_item ON workitem_design_version_items (product_space_item_id);

COMMIT;
