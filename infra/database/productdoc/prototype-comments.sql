-- 原型页面批注评论（PostgreSQL 15+）
CREATE TABLE IF NOT EXISTS product_prototype_comments (
    id VARCHAR(36) PRIMARY KEY,
    item_id VARCHAR(36) NOT NULL REFERENCES product_docs(id) ON DELETE CASCADE,
    workspace_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prototype_comments_item ON product_prototype_comments (item_id, created_at DESC);
