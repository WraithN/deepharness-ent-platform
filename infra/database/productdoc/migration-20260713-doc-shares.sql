-- 产品文档分享短链：已发布文档可生成免登录访问的公开链接。
-- 分享记录指向文档，访问时动态解析该文档的最新已发布版本，保证链接内容随发布更新。

CREATE TABLE IF NOT EXISTS product_doc_shares (
    id VARCHAR(36) PRIMARY KEY,
    token VARCHAR(16) NOT NULL UNIQUE,
    doc_id VARCHAR(36) NOT NULL REFERENCES product_docs(id) ON DELETE CASCADE,
    workspace_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_doc_shares_doc ON product_doc_shares(doc_id);
