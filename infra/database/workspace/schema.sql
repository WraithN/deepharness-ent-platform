-- workspace 模块：空间、需求项目、仓库、Agent、空间级技能/提示词/规范/CI-CD
-- 本 schema 约定：
--   - 主键使用 UUID，类型为 UUID
--   - 时间戳使用 TIMESTAMPTZ
--   - 不建立外键约束，关系校验在应用层完成

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workspaces IS '工作空间';
COMMENT ON COLUMN workspaces.id IS '空间 ID（UUID）';
COMMENT ON COLUMN workspaces.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN workspaces.name IS '空间名称';
COMMENT ON COLUMN workspaces.description IS '空间描述';
COMMENT ON COLUMN workspaces.created_at IS '创建时间';
COMMENT ON COLUMN workspaces.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_id ON workspaces (tenant_id);

DROP TRIGGER IF EXISTS trigger_workspaces_updated_at ON workspaces;
CREATE TRIGGER trigger_workspaces_updated_at
BEFORE UPDATE ON workspaces
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(50) NOT NULL,
    sub_role VARCHAR(50),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
);

COMMENT ON TABLE workspace_members IS '空间成员';
COMMENT ON COLUMN workspace_members.workspace_id IS '空间 ID';
COMMENT ON COLUMN workspace_members.user_id IS '用户 ID';
COMMENT ON COLUMN workspace_members.role IS '成员角色';
COMMENT ON COLUMN workspace_members.sub_role IS '子角色';
COMMENT ON COLUMN workspace_members.joined_at IS '加入时间';

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members (user_id);

-- demand_projects 与 workspaces 为 1:1 关系设计：
-- 每个 workspace 最多对应一个 demand_project。
-- 下方的 UNIQUE INDEX 在数据层强制这一约束，应用层应保证写入时的一致性。
CREATE TABLE IF NOT EXISTS demand_projects (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'meego',
    external_key VARCHAR(200) NOT NULL,
    name VARCHAR(200),
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE demand_projects IS '需求项目（一个空间仅对应一个）';
COMMENT ON COLUMN demand_projects.id IS '需求项目 ID（UUID）';
COMMENT ON COLUMN demand_projects.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN demand_projects.platform IS '需求平台类型';
COMMENT ON COLUMN demand_projects.external_key IS '外部系统项目标识';
COMMENT ON COLUMN demand_projects.name IS '需求项目名称';
COMMENT ON COLUMN demand_projects.config IS '平台相关配置';
COMMENT ON COLUMN demand_projects.created_at IS '创建时间';
COMMENT ON COLUMN demand_projects.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_projects_workspace_id ON demand_projects (workspace_id);

DROP TRIGGER IF EXISTS trigger_demand_projects_updated_at ON demand_projects;
CREATE TRIGGER trigger_demand_projects_updated_at
BEFORE UPDATE ON demand_projects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    url VARCHAR(500) NOT NULL,
    type VARCHAR(50) NOT NULL,
    default_branch VARCHAR(100),
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE repositories IS '代码仓库';
COMMENT ON COLUMN repositories.id IS '仓库 ID（UUID）';
COMMENT ON COLUMN repositories.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN repositories.name IS '仓库名称';
COMMENT ON COLUMN repositories.url IS '仓库地址';
COMMENT ON COLUMN repositories.type IS '仓库类型（如 dev / case / product）';
COMMENT ON COLUMN repositories.default_branch IS '默认分支';
COMMENT ON COLUMN repositories.config IS '仓库扩展配置';
COMMENT ON COLUMN repositories.created_at IS '创建时间';
COMMENT ON COLUMN repositories.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_repositories_type ON repositories (type);
CREATE INDEX IF NOT EXISTS idx_repositories_workspace_type ON repositories (workspace_id, type);

DROP TRIGGER IF EXISTS trigger_repositories_updated_at ON repositories;
CREATE TRIGGER trigger_repositories_updated_at
BEFORE UPDATE ON repositories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    role VARCHAR(100),
    description TEXT,
    config JSONB,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE agents IS '空间 Agent';
COMMENT ON COLUMN agents.id IS 'Agent ID（UUID）';
COMMENT ON COLUMN agents.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN agents.name IS 'Agent 名称';
COMMENT ON COLUMN agents.role IS 'Agent 角色';
COMMENT ON COLUMN agents.description IS 'Agent 描述';
COMMENT ON COLUMN agents.config IS 'Agent 配置';
COMMENT ON COLUMN agents.is_default IS '是否为空间默认 Agent';
COMMENT ON COLUMN agents.created_by_user_id IS '创建者用户 ID';
COMMENT ON COLUMN agents.created_at IS '创建时间';
COMMENT ON COLUMN agents.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_agents_workspace_default ON agents (workspace_id, is_default);

DROP TRIGGER IF EXISTS trigger_agents_updated_at ON agents;
CREATE TRIGGER trigger_agents_updated_at
BEFORE UPDATE ON agents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS skill_library (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT '通用',
    tags VARCHAR(500),
    downloads INT NOT NULL DEFAULT 0,
    rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
    icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
    phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
    content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE skill_library IS '技能库';
COMMENT ON COLUMN skill_library.id IS '技能 ID（UUID）';
COMMENT ON COLUMN skill_library.name IS '技能名称';
COMMENT ON COLUMN skill_library.description IS '技能描述';
COMMENT ON COLUMN skill_library.category IS '技能分类';
COMMENT ON COLUMN skill_library.tags IS '标签，逗号分隔';
COMMENT ON COLUMN skill_library.downloads IS '下载/使用次数';
COMMENT ON COLUMN skill_library.rating IS '评分 0.0-5.0';
COMMENT ON COLUMN skill_library.icon IS '前端图标组件名称';
COMMENT ON COLUMN skill_library.phase IS '研发阶段';
COMMENT ON COLUMN skill_library.content IS '技能内容';
COMMENT ON COLUMN skill_library.created_at IS '创建时间';
COMMENT ON COLUMN skill_library.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_skill_library_category ON skill_library (category);
CREATE INDEX IF NOT EXISTS idx_skill_library_phase ON skill_library (phase);

DROP TRIGGER IF EXISTS trigger_skill_library_updated_at ON skill_library;
CREATE TRIGGER trigger_skill_library_updated_at
BEFORE UPDATE ON skill_library
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS prompt_library (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    use_case VARCHAR(100) NOT NULL DEFAULT '通用',
    usage_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE prompt_library IS '提示词库';
COMMENT ON COLUMN prompt_library.id IS '提示词 ID（UUID）';
COMMENT ON COLUMN prompt_library.name IS '提示词名称';
COMMENT ON COLUMN prompt_library.description IS '提示词描述';
COMMENT ON COLUMN prompt_library.content IS '提示词内容';
COMMENT ON COLUMN prompt_library.use_case IS '使用场景分类';
COMMENT ON COLUMN prompt_library.usage_count IS '使用次数';
COMMENT ON COLUMN prompt_library.created_at IS '创建时间';
COMMENT ON COLUMN prompt_library.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_prompt_library_use_case ON prompt_library (use_case);

DROP TRIGGER IF EXISTS trigger_prompt_library_updated_at ON prompt_library;
CREATE TRIGGER trigger_prompt_library_updated_at
BEFORE UPDATE ON prompt_library
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_skills (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    library_skill_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT '通用',
    tags VARCHAR(500),
    downloads INT NOT NULL DEFAULT 0,
    rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
    icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
    phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
    content TEXT,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    installed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workspace_skills IS '空间技能';
COMMENT ON COLUMN workspace_skills.id IS '空间技能 ID（UUID）';
COMMENT ON COLUMN workspace_skills.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN workspace_skills.library_skill_id IS '关联技能库 ID（自定义技能可为空）';
COMMENT ON COLUMN workspace_skills.name IS '技能名称';
COMMENT ON COLUMN workspace_skills.description IS '技能描述';
COMMENT ON COLUMN workspace_skills.category IS '技能分类';
COMMENT ON COLUMN workspace_skills.tags IS '标签，逗号分隔';
COMMENT ON COLUMN workspace_skills.downloads IS '下载/使用次数';
COMMENT ON COLUMN workspace_skills.rating IS '评分 0.0-5.0';
COMMENT ON COLUMN workspace_skills.icon IS '前端图标组件名称';
COMMENT ON COLUMN workspace_skills.phase IS '研发阶段';
COMMENT ON COLUMN workspace_skills.content IS '技能内容';
COMMENT ON COLUMN workspace_skills.is_custom IS '是否为自定义技能';
COMMENT ON COLUMN workspace_skills.installed IS '是否已安装到空间';
COMMENT ON COLUMN workspace_skills.created_at IS '创建时间';
COMMENT ON COLUMN workspace_skills.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_workspace_skills_library_skill_id ON workspace_skills (library_skill_id);
CREATE INDEX IF NOT EXISTS idx_workspace_skills_phase ON workspace_skills (workspace_id, phase);
CREATE INDEX IF NOT EXISTS idx_workspace_skills_installed ON workspace_skills (workspace_id, installed);
CREATE INDEX IF NOT EXISTS idx_workspace_skills_category ON workspace_skills (workspace_id, category);

DROP TRIGGER IF EXISTS trigger_workspace_skills_updated_at ON workspace_skills;
CREATE TRIGGER trigger_workspace_skills_updated_at
BEFORE UPDATE ON workspace_skills
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_prompts (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    library_prompt_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    use_case VARCHAR(100) NOT NULL DEFAULT '通用',
    usage_count INT NOT NULL DEFAULT 0,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    added_to_space BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workspace_prompts IS '空间提示词';
COMMENT ON COLUMN workspace_prompts.id IS '空间提示词 ID（UUID）';
COMMENT ON COLUMN workspace_prompts.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN workspace_prompts.library_prompt_id IS '关联提示词库 ID（自定义提示词可为空）';
COMMENT ON COLUMN workspace_prompts.name IS '提示词名称';
COMMENT ON COLUMN workspace_prompts.description IS '提示词描述';
COMMENT ON COLUMN workspace_prompts.content IS '提示词内容';
COMMENT ON COLUMN workspace_prompts.use_case IS '使用场景分类';
COMMENT ON COLUMN workspace_prompts.usage_count IS '使用次数';
COMMENT ON COLUMN workspace_prompts.is_custom IS '是否为自定义提示词';
COMMENT ON COLUMN workspace_prompts.added_to_space IS '是否已添加到空间常用列表';
COMMENT ON COLUMN workspace_prompts.created_at IS '创建时间';
COMMENT ON COLUMN workspace_prompts.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_workspace_prompts_library_prompt_id ON workspace_prompts (library_prompt_id);
CREATE INDEX IF NOT EXISTS idx_workspace_prompts_use_case ON workspace_prompts (workspace_id, use_case);
CREATE INDEX IF NOT EXISTS idx_workspace_prompts_added ON workspace_prompts (workspace_id, added_to_space);

DROP TRIGGER IF EXISTS trigger_workspace_prompts_updated_at ON workspace_prompts;
CREATE TRIGGER trigger_workspace_prompts_updated_at
BEFORE UPDATE ON workspace_prompts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_standards (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    repository_id UUID,
    type VARCHAR(50) NOT NULL,
    name VARCHAR(200),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workspace_standards IS '空间研发规范';
COMMENT ON COLUMN workspace_standards.id IS '规范 ID（UUID）';
COMMENT ON COLUMN workspace_standards.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN workspace_standards.repository_id IS '关联仓库 ID（NULL 表示空间级规范）';
COMMENT ON COLUMN workspace_standards.type IS '规范类型（如 coding / design / engineering）';
COMMENT ON COLUMN workspace_standards.name IS '规范名称';
COMMENT ON COLUMN workspace_standards.content IS '规范内容';
COMMENT ON COLUMN workspace_standards.created_at IS '创建时间';
COMMENT ON COLUMN workspace_standards.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_workspace_standards_repository_id ON workspace_standards (repository_id);
CREATE INDEX IF NOT EXISTS idx_workspace_standards_workspace_type ON workspace_standards (workspace_id, type);

DROP TRIGGER IF EXISTS trigger_workspace_standards_updated_at ON workspace_standards;
CREATE TRIGGER trigger_workspace_standards_updated_at
BEFORE UPDATE ON workspace_standards
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- workspace_cicd 与 workspaces 为 1:1 关系设计：
-- 每个 workspace 最多对应一份 CI/CD 配置。
CREATE TABLE IF NOT EXISTS workspace_cicd (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    trigger_branches VARCHAR(500),
    webhook_url VARCHAR(500),
    script TEXT,
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workspace_cicd IS '空间 CI/CD 配置';
COMMENT ON COLUMN workspace_cicd.id IS 'CI/CD 配置 ID（UUID）';
COMMENT ON COLUMN workspace_cicd.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN workspace_cicd.trigger_branches IS '触发分支规则';
COMMENT ON COLUMN workspace_cicd.webhook_url IS 'Webhook 地址';
COMMENT ON COLUMN workspace_cicd.script IS 'CI/CD 脚本';
COMMENT ON COLUMN workspace_cicd.config IS '扩展配置';
COMMENT ON COLUMN workspace_cicd.created_at IS '创建时间';
COMMENT ON COLUMN workspace_cicd.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_cicd_workspace_id ON workspace_cicd (workspace_id);

DROP TRIGGER IF EXISTS trigger_workspace_cicd_updated_at ON workspace_cicd;
CREATE TRIGGER trigger_workspace_cicd_updated_at
BEFORE UPDATE ON workspace_cicd
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
