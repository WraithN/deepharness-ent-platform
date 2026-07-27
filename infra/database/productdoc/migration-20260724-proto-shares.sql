-- 原型产品分享短链：按产品（prototypes 一级目录）生成免登录访问的公开链接。
-- token 绑定 workspace+user+product_folder，访问时动态解析该产品下全部原型页面，
-- 保证链接内容随页面增删自动更新。同一产品重复创建返回已有链接（幂等）。

CREATE TABLE IF NOT EXISTS product_prototype_shares (
    id VARCHAR(36) PRIMARY KEY,
    token VARCHAR(16) NOT NULL UNIQUE,
    workspace_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    product_folder VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 同一产品仅保留一条分享记录，保证链接稳定
CREATE UNIQUE INDEX IF NOT EXISTS idx_proto_shares_ws_user_folder
    ON product_prototype_shares(workspace_id, user_id, product_folder);

CREATE INDEX IF NOT EXISTS idx_proto_shares_token ON product_prototype_shares(token);
