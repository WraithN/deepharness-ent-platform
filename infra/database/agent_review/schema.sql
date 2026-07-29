CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS agent_review_reports (
    id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    VARCHAR(36)  NOT NULL,
    session_id      VARCHAR(36)  NOT NULL DEFAULT '',
    project_path    VARCHAR(500) NOT NULL,
    project_name    VARCHAR(200) NOT NULL,
    branch          VARCHAR(200) NOT NULL,
    commit_hash     VARCHAR(64)  NOT NULL,
    report_path     TEXT         NOT NULL,
    summary         TEXT         NOT NULL DEFAULT '',
    issues          JSONB        NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_agent_review_reports_updated_at
    BEFORE UPDATE ON agent_review_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_agent_review_reports_workspace ON agent_review_reports(workspace_id);
CREATE INDEX idx_agent_review_reports_session ON agent_review_reports(session_id);
CREATE INDEX idx_agent_review_reports_created ON agent_review_reports(created_at DESC);
