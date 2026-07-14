-- 分享文档批注：访客在免登录分享页选中文本提交批注，需登录用户可在文档内查看并标记解决。
-- 批注同时记录 share_token（来源分享链接）与 doc_id/workspace_id（便于文档维度聚合查询）。

CREATE TABLE IF NOT EXISTS product_doc_share_comments (
    id VARCHAR(36) PRIMARY KEY,
    share_token VARCHAR(32) NOT NULL,
    doc_id VARCHAR(36) NOT NULL REFERENCES product_docs(id) ON DELETE CASCADE,
    workspace_id VARCHAR(36) NOT NULL,
    author_name VARCHAR(64) NOT NULL,
    quote_text TEXT NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(36)
);

CREATE INDEX IF NOT EXISTS idx_product_doc_share_comments_doc ON product_doc_share_comments(doc_id, created_at);
CREATE INDEX IF NOT EXISTS idx_product_doc_share_comments_token ON product_doc_share_comments(share_token);
