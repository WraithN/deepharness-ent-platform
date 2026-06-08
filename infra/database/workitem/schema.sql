-- 工作项统一 Schema
CREATE TABLE IF NOT EXISTS workitems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'todo',
    priority VARCHAR(50) NOT NULL DEFAULT 'medium',
    assignee_id UUID,
    source VARCHAR(100) NOT NULL DEFAULT 'internal',
    external_id VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_workitems_tenant ON workitems(tenant_id);
CREATE INDEX idx_workitems_project ON workitems(project_id);
CREATE INDEX idx_workitems_status ON workitems(status);
