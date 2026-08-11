-- 会话关联需求：从 quotedCard 持久化 workitem_id，支持按需求汇集会话与提交。
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS workitem_id VARCHAR(36);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workitem ON agent_sessions(workitem_id);

-- 需求开发提交记录：agent 在会话中执行 git commit 时自动记录。
CREATE TABLE IF NOT EXISTS workitem_commits (
    id             VARCHAR(36) PRIMARY KEY,
    workitem_id    VARCHAR(36) NOT NULL,
    workspace_id   VARCHAR(36) NOT NULL,
    session_id     VARCHAR(36) NOT NULL,
    repository_id  VARCHAR(36),
    commit_hash    VARCHAR(64) NOT NULL,
    commit_message TEXT,
    author         VARCHAR(200),
    committed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workitem_commits_workitem
    ON workitem_commits(workitem_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_workitem_commits_session
    ON workitem_commits(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workitem_commits_workitem_hash
    ON workitem_commits(workitem_id, commit_hash);
