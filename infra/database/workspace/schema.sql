-- workspace 模块：空间、需求项目、仓库、Agent、空间级技能/提示词/规范/CI-CD
-- 本 schema 约定：
--   - 主键使用 UUID，类型为 CHAR(36)
--   - 时间戳使用 DATETIME(3) 以保留毫秒精度
--   - 不建立外键约束，关系校验在应用层完成
--   - 字符集统一为 utf8mb4，排序规则为 utf8mb4_unicode_ci

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS workspaces (
    id CHAR(36) NOT NULL COMMENT '空间 ID（UUID）',
    tenant_id CHAR(36) NOT NULL COMMENT '所属租户 ID',
    name VARCHAR(200) NOT NULL COMMENT '空间名称',
    description TEXT COMMENT '空间描述',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_workspaces_tenant_id (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作空间';

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id CHAR(36) NOT NULL COMMENT '空间 ID',
    user_id CHAR(36) NOT NULL COMMENT '用户 ID',
    role VARCHAR(50) NOT NULL COMMENT '成员角色',
    sub_role VARCHAR(50) COMMENT '子角色',
    joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '加入时间',
    PRIMARY KEY (workspace_id, user_id),
    INDEX idx_workspace_members_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间成员';

-- demand_projects 与 workspaces 为 1:1 关系设计：
-- 每个 workspace 最多对应一个 demand_project。
-- 下方的 UNIQUE INDEX 在数据层强制这一约束，应用层应保证写入时的一致性。
CREATE TABLE IF NOT EXISTS demand_projects (
    id CHAR(36) NOT NULL COMMENT '需求项目 ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    platform VARCHAR(50) NOT NULL DEFAULT 'meego' COMMENT '需求平台类型',
    external_key VARCHAR(200) NOT NULL COMMENT '外部系统项目标识',
    name VARCHAR(200) COMMENT '需求项目名称',
    config JSON COMMENT '平台相关配置',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    UNIQUE INDEX idx_demand_projects_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项目（一个空间仅对应一个）';

CREATE TABLE IF NOT EXISTS repositories (
    id CHAR(36) NOT NULL COMMENT '仓库 ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    name VARCHAR(200) NOT NULL COMMENT '仓库名称',
    url VARCHAR(500) NOT NULL COMMENT '仓库地址',
    type VARCHAR(50) NOT NULL COMMENT '仓库类型（如 dev / case / product）',
    default_branch VARCHAR(100) COMMENT '默认分支',
    config JSON COMMENT '仓库扩展配置',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_repositories_type (type),
    INDEX idx_repositories_workspace_type (workspace_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代码仓库';

CREATE TABLE IF NOT EXISTS agents (
    id CHAR(36) NOT NULL COMMENT 'Agent ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    name VARCHAR(200) NOT NULL COMMENT 'Agent 名称',
    role VARCHAR(100) COMMENT 'Agent 角色',
    description TEXT COMMENT 'Agent 描述',
    config JSON COMMENT 'Agent 配置',
    is_default TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为空间默认 Agent',
    created_by_user_id CHAR(36) COMMENT '创建者用户 ID',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_agents_workspace_default (workspace_id, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间 Agent';

CREATE TABLE IF NOT EXISTS skill_library (
    id CHAR(36) NOT NULL COMMENT '技能 ID（UUID）',
    name VARCHAR(255) NOT NULL COMMENT '技能名称',
    description TEXT COMMENT '技能描述',
    category VARCHAR(100) NOT NULL DEFAULT '通用' COMMENT '技能分类',
    tags VARCHAR(500) COMMENT '标签，逗号分隔',
    downloads INT NOT NULL DEFAULT 0 COMMENT '下载/使用次数',
    rating DECIMAL(2,1) NOT NULL DEFAULT 5.0 COMMENT '评分 0.0-5.0',
    icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle' COMMENT '前端图标组件名称',
    phase VARCHAR(50) NOT NULL DEFAULT '代码开发' COMMENT '研发阶段',
    content TEXT COMMENT '技能内容',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_skill_library_category (category),
    INDEX idx_skill_library_phase (phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技能库';

CREATE TABLE IF NOT EXISTS prompt_library (
    id CHAR(36) NOT NULL COMMENT '提示词 ID（UUID）',
    name VARCHAR(255) NOT NULL COMMENT '提示词名称',
    description TEXT COMMENT '提示词描述',
    content TEXT NOT NULL COMMENT '提示词内容',
    use_case VARCHAR(100) NOT NULL DEFAULT '通用' COMMENT '使用场景分类',
    usage_count INT NOT NULL DEFAULT 0 COMMENT '使用次数',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_prompt_library_use_case (use_case)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提示词库';

CREATE TABLE IF NOT EXISTS workspace_skills (
    id CHAR(36) NOT NULL COMMENT '空间技能 ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    library_skill_id CHAR(36) COMMENT '关联技能库 ID（自定义技能可为空）',
    name VARCHAR(255) NOT NULL COMMENT '技能名称',
    description TEXT COMMENT '技能描述',
    category VARCHAR(100) NOT NULL DEFAULT '通用' COMMENT '技能分类',
    tags VARCHAR(500) COMMENT '标签，逗号分隔',
    downloads INT NOT NULL DEFAULT 0 COMMENT '下载/使用次数',
    rating DECIMAL(2,1) NOT NULL DEFAULT 5.0 COMMENT '评分 0.0-5.0',
    icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle' COMMENT '前端图标组件名称',
    phase VARCHAR(50) NOT NULL DEFAULT '代码开发' COMMENT '研发阶段',
    content TEXT COMMENT '技能内容',
    is_custom TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为自定义技能',
    installed TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否已安装到空间',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_workspace_skills_library_skill_id (library_skill_id),
    INDEX idx_workspace_skills_phase (workspace_id, phase),
    INDEX idx_workspace_skills_installed (workspace_id, installed),
    INDEX idx_workspace_skills_category (workspace_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间技能';

CREATE TABLE IF NOT EXISTS workspace_prompts (
    id CHAR(36) NOT NULL COMMENT '空间提示词 ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    library_prompt_id CHAR(36) COMMENT '关联提示词库 ID（自定义提示词可为空）',
    name VARCHAR(255) NOT NULL COMMENT '提示词名称',
    description TEXT COMMENT '提示词描述',
    content TEXT NOT NULL COMMENT '提示词内容',
    use_case VARCHAR(100) NOT NULL DEFAULT '通用' COMMENT '使用场景分类',
    usage_count INT NOT NULL DEFAULT 0 COMMENT '使用次数',
    is_custom TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为自定义提示词',
    added_to_space TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否已添加到空间常用列表',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_workspace_prompts_library_prompt_id (library_prompt_id),
    INDEX idx_workspace_prompts_use_case (workspace_id, use_case),
    INDEX idx_workspace_prompts_added (workspace_id, added_to_space)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间提示词';

CREATE TABLE IF NOT EXISTS workspace_standards (
    id CHAR(36) NOT NULL COMMENT '规范 ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    repository_id CHAR(36) COMMENT '关联仓库 ID（NULL 表示空间级规范）',
    type VARCHAR(50) NOT NULL COMMENT '规范类型（如 coding / design / engineering）',
    name VARCHAR(200) COMMENT '规范名称',
    content TEXT NOT NULL COMMENT '规范内容',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    INDEX idx_workspace_standards_repository_id (repository_id),
    INDEX idx_workspace_standards_workspace_type (workspace_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间研发规范';

-- workspace_cicd 与 workspaces 为 1:1 关系设计：
-- 每个 workspace 最多对应一份 CI/CD 配置。
CREATE TABLE IF NOT EXISTS workspace_cicd (
    id CHAR(36) NOT NULL COMMENT 'CI/CD 配置 ID（UUID）',
    workspace_id CHAR(36) NOT NULL COMMENT '所属空间 ID',
    trigger_branches VARCHAR(500) COMMENT '触发分支规则',
    webhook_url VARCHAR(500) COMMENT 'Webhook 地址',
    script TEXT COMMENT 'CI/CD 脚本',
    config JSON COMMENT '扩展配置',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    PRIMARY KEY (id),
    UNIQUE INDEX idx_workspace_cicd_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间 CI/CD 配置';
