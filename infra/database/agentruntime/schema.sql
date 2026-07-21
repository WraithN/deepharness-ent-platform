-- Agent 运行时状态表
-- 用于存储外部 gatewayd / agent-stub 上报的运行时状态，供管理后台实时监控。

CREATE TABLE IF NOT EXISTS agent_runtimes (
    runtime_id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    tenant_name VARCHAR(255) NOT NULL DEFAULT '',
    workspace_id VARCHAR(64) NOT NULL,
    workspace_name VARCHAR(255) NOT NULL DEFAULT '',
    user_id VARCHAR(64) NOT NULL,
    user_name VARCHAR(255) NOT NULL DEFAULT '',
    user_display_name VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL,
    uptime_seconds BIGINT NOT NULL DEFAULT 0,
    cpu_percent REAL NOT NULL DEFAULT 0,
    mem_percent REAL NOT NULL DEFAULT 0,
    sandbox_spec VARCHAR(64) NOT NULL DEFAULT '',
    gatewayd_url VARCHAR(512) NOT NULL DEFAULT '',
    workspace_path VARCHAR(512) NOT NULL DEFAULT '',
    agents JSONB NOT NULL DEFAULT '[]'::jsonb,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_runtimes_tenant ON agent_runtimes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_runtimes_workspace ON agent_runtimes (workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_runtimes_user ON agent_runtimes (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runtimes_status ON agent_runtimes (status);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_agent_runtimes_updated_at ON agent_runtimes;
CREATE TRIGGER trigger_agent_runtimes_updated_at
BEFORE UPDATE ON agent_runtimes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
