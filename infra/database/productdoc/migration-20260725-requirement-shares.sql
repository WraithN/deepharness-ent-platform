-- 需求级统一分享短链：一个 token 同时绑定文档与原型产品，
-- 访客通过同一落地页查看该需求的文档（Markdown）和原型页面。
-- 同一需求（workspace+user+doc+product）重复创建返回已有链接（幂等）。

CREATE TABLE IF NOT EXISTS requirement_shares (
    id VARCHAR(36) PRIMARY KEY,
    token VARCHAR(16) NOT NULL UNIQUE,
    workspace_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    doc_id VARCHAR(36),
    product_folder VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 同一需求仅保留一条分享记录，保证链接稳定
CREATE UNIQUE INDEX IF NOT EXISTS idx_requirement_shares_ws_user_doc_product
    ON requirement_shares(workspace_id, user_id, COALESCE(doc_id, ''), COALESCE(product_folder, ''));

CREATE INDEX IF NOT EXISTS idx_requirement_shares_token ON requirement_shares(token);
