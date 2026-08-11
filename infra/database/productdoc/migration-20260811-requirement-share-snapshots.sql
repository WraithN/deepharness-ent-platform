-- 需求级分享文档快照：创建分享时锁定文档当前最新已发布版本，
-- 后续文档上下线状态变化不影响已发出的分享内容。

CREATE TABLE IF NOT EXISTS requirement_share_doc_snapshots (
    share_token     VARCHAR(16) PRIMARY KEY,
    doc_id          VARCHAR(36) NOT NULL,
    doc_title       TEXT,
    doc_content     TEXT,
    doc_version     INT,
    published_at    TIMESTAMPTZ,
    created_by_name VARCHAR(200),
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rsd_snapshots_share FOREIGN KEY (share_token)
        REFERENCES requirement_shares(token) ON DELETE CASCADE
);
