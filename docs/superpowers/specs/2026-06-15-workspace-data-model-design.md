# Workspace 数据模型设计

## 1. 设计目标

为 DeepHarness Enterprise Platform 建立清晰的 workspace 数据模型，支撑以下业务关系：

- `tenant : workspace = 1 : N`
- `workspace : demand_project = 1 : 1`
- `workspace : repository = 1 : N`
- `workspace : agent = 1 : N`，`agent : session = 1 : N`，`session : message = 1 : N`
- `workspace : member = 1 : N`（多对多通过 `workspace_members`）
- `workspace : skill / prompt = 1 : N`（技能/提示词市场需先引入 workspace 私有才能使用）
- `workspace : standard = 1 : N`（支持 workspace 级与 repository 级）
- `workspace : cicd = 1 : 1`

## 2. 设计原则

- **无数据库外键**：所有关联约束在应用层校验，数据库只建普通索引。
- **统一 ID 与时间戳**：主键使用 `CHAR(36)` UUID；时间戳使用 `DATETIME(3)`，统一 UTC。
- **字符集 utf8mb4**：所有新建表使用 `utf8mb4_unicode_ci`。
- **全局市场与 workspace 私有分离**：`skill_library` / `prompt_library` 供市场展示；`workspace_skills` / `workspace_prompts` 存放已引入或可自定义的私有副本。

## 3. 核心 ER 关系

```text
tenant
  └── workspace (tenant_id)
        ├── demand_project (workspace_id, unique)
        ├── repository (workspace_id)
        ├── agent (workspace_id)
        │      └── agent_session (agent_id, workspace_id)
        │              └── agent_message (session_id)
        ├── workspace_member (workspace_id, user_id)
        ├── workspace_skill (workspace_id, library_skill_id nullable)
        ├── workspace_prompt (workspace_id, library_prompt_id nullable)
        ├── workspace_standard (workspace_id, repository_id nullable)
        └── workspace_cicd (workspace_id, unique)

skill_library  ──被引入──► workspace_skill
prompt_library ──被引入──► workspace_prompt
user ──被加入──► workspace_member
```

## 4. 表结构

### 4.1 workspaces

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | UUID |
| `tenant_id` | CHAR(36) NOT NULL, IDX | 归属租户 |
| `name` | VARCHAR(200) NOT NULL | 空间名称 |
| `description` | TEXT | 描述 |
| `created_at` | DATETIME(3) | UTC |
| `updated_at` | DATETIME(3) | UTC |

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspaces_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.2 workspace_members

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | CHAR(36) PK / IDX | |
| `user_id` | CHAR(36) PK / IDX | |
| `role` | VARCHAR(50) NOT NULL | `admin` / `user` |
| `sub_role` | VARCHAR(50) | `developer` / `tester` / `pm` / `designer` |
| `joined_at` | DATETIME(3) | |

```sql
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role VARCHAR(50) NOT NULL,
  sub_role VARCHAR(50),
  joined_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (workspace_id, user_id),
  INDEX idx_workspace_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.3 demand_projects

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id` | CHAR(36) NOT NULL, UNIQUE, IDX | 1:1 |
| `platform` | VARCHAR(50) | `meego` / `jira` / `pingcode` |
| `external_key` | VARCHAR(200) NOT NULL | 外部平台项目 key |
| `name` | VARCHAR(200) | 显示名称 |
| `config` | JSON | 平台特有配置 |
| `created_at` / `updated_at` | DATETIME(3) | |

```sql
CREATE TABLE IF NOT EXISTS demand_projects (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL UNIQUE,
  platform VARCHAR(50) NOT NULL DEFAULT 'meego',
  external_key VARCHAR(200) NOT NULL,
  name VARCHAR(200),
  config JSON,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_demand_projects_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.4 repositories

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id` | CHAR(36) NOT NULL, IDX | |
| `name` | VARCHAR(200) | |
| `url` | VARCHAR(500) | Git 地址 |
| `type` | VARCHAR(50) | `dev` / `case` / `product` |
| `default_branch` | VARCHAR(100) | |
| `config` | JSON | 额外配置 |
| `created_at` / `updated_at` | DATETIME(3) | |

```sql
CREATE TABLE IF NOT EXISTS repositories (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  url VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL,
  default_branch VARCHAR(100),
  config JSON,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_repositories_type (type),
  INDEX idx_repositories_workspace_type (workspace_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.5 agents

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id` | CHAR(36) NOT NULL, IDX | |
| `name` | VARCHAR(200) | |
| `role` | VARCHAR(100) | 职能角色 |
| `description` | TEXT | |
| `config` | JSON | model / temperature / baseUrl / apiKey 等 |
| `is_default` | TINYINT(1) DEFAULT 0 | 空间默认智能体 |
| `created_by_user_id` | CHAR(36) | |
| `created_at` / `updated_at` | DATETIME(3) | |

```sql
CREATE TABLE IF NOT EXISTS agents (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(100),
  description TEXT,
  config JSON,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_by_user_id CHAR(36),
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_agents_workspace_default (workspace_id, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.6 agent_sessions / agent_messages

在现有表基础上扩展归属：

```sql
ALTER TABLE agent_sessions
  ADD COLUMN workspace_id CHAR(36) NOT NULL AFTER id,
  ADD COLUMN agent_id CHAR(36) NOT NULL AFTER workspace_id,
  ADD INDEX idx_agent_sessions_workspace (workspace_id),
  ADD INDEX idx_agent_sessions_agent (agent_id);
```

`agent_messages` 结构保持不变，通过 `session_id` 关联。

### 4.7 skill_library / prompt_library（全局市场）

```sql
CREATE TABLE IF NOT EXISTS skill_library (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL DEFAULT '通用',
  tags VARCHAR(500),
  downloads INT NOT NULL DEFAULT 0,
  rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
  icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
  phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
  content TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_skill_library_category (category),
  INDEX idx_skill_library_phase (phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prompt_library (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  use_case VARCHAR(100) NOT NULL DEFAULT '通用',
  usage_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_prompt_library_use_case (use_case)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.8 workspace_skills / workspace_prompts（空间私有）

```sql
CREATE TABLE IF NOT EXISTS workspace_skills (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  library_skill_id CHAR(36),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL DEFAULT '通用',
  tags VARCHAR(500),
  downloads INT NOT NULL DEFAULT 0,
  rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
  icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
  phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
  content TEXT,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  installed TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_skills_library_skill_id (library_skill_id),
  INDEX idx_workspace_skills_phase (workspace_id, phase),
  INDEX idx_workspace_skills_installed (workspace_id, installed),
  INDEX idx_workspace_skills_category (workspace_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_prompts (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  library_prompt_id CHAR(36),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  use_case VARCHAR(100) NOT NULL DEFAULT '通用',
  usage_count INT NOT NULL DEFAULT 0,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  added_to_space TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_prompts_library_prompt_id (library_prompt_id),
  INDEX idx_workspace_prompts_use_case (workspace_id, use_case),
  INDEX idx_workspace_prompts_added (workspace_id, added_to_space)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.9 workspace_standards

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id` | CHAR(36) NOT NULL, IDX | |
| `repository_id` | CHAR(36), IDX | NULL 表示 workspace 级 |
| `type` | VARCHAR(50) | `coding` / `design` / `engineering` |
| `name` | VARCHAR(200) | |
| `content` | TEXT | Markdown |
| `created_at` / `updated_at` | DATETIME(3) | |

```sql
CREATE TABLE IF NOT EXISTS workspace_standards (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  repository_id CHAR(36),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(200),
  content TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_standards_repository_id (repository_id),
  INDEX idx_workspace_standards_workspace_type (workspace_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.10 workspace_cicd

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id` | CHAR(36) NOT NULL, UNIQUE | 1:1 |
| `trigger_branches` | VARCHAR(500) | |
| `webhook_url` | VARCHAR(500) | |
| `script` | TEXT | |
| `config` | JSON | |
| `created_at` / `updated_at` | DATETIME(3) | |

```sql
CREATE TABLE IF NOT EXISTS workspace_cicd (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  trigger_branches VARCHAR(500),
  webhook_url VARCHAR(500),
  script TEXT,
  config JSON,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  UNIQUE INDEX idx_workspace_cicd_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 5. 典型数据流

### 5.1 创建 workspace

1. 校验 `tenant_id` 存在。
2. 插入 `workspaces`。
3. 插入 `demand_projects`（`workspace_id` 唯一）。
4. 插入 `workspace_members`（创建人 `role=admin`）。
5. 可选：插入默认 `agent`（`is_default=1`）。
6. 可选：插入空 `workspace_cicd`。

### 5.2 从市场引入技能

1. 从 `skill_library` 读取源记录。
2. 在 `workspace_skills` 插入拷贝：
   - `library_skill_id` = 源 ID
   - `is_custom` = 0
   - `workspace_id` = 目标 workspace
3. 允许 workspace 覆盖 `content`、`icon`、`phase`。

自定义创建时，`library_skill_id = NULL`, `is_custom = 1`。

### 5.3 发起智能会话

1. 前端选择 `agent`。
2. 后端校验 `agent.workspace_id == 当前 workspace`。
3. 创建 `agent_sessions`（`workspace_id`, `agent_id`）。
4. 用户消息写入 `agent_messages`（`session_id`）。

### 5.4 现有 Settings 字段映射

| 现有字段 | 新模型 |
|---|---|
| `meegoProject` | `demand_projects.external_key` |
| Git 仓库列表 | `repositories` |
| 编码/设计规范 | `workspace_standards`（`repository_id = NULL`）|
| 仓库规范配置 | `workspace_standards`（带 `repository_id`）|
| 智能体配置 | `agents.config` |
| CICD 配置 | `workspace_cicd` |
| 成员管理 | `workspace_members` + `users` |

## 6. 迁移与兼容

- `tenants`、`users` 表保持不变。
- 新增 `workspaces`、`workspace_members`。
- 为当前单租户环境生成一个默认 `workspace`：
  - 将现有 `team_skills` / `team_prompts` 中适合作为全局市场的数据迁移到 `skill_library` / `prompt_library`。
  - 同时在该默认 workspace 下生成对应的 `workspace_skills` / `workspace_prompts` 拷贝。
- `agent_sessions` 增加 `workspace_id`、`agent_id`；历史数据批量回填到默认 workspace / 默认 agent。
- `personal_assistants` 逐步迁移到 `agents`（保留 `created_by_user_id`），其会话迁移到 `agent_sessions`。

## 7. 应用层校验点

- 创建 `workspace` 时校验 `tenant_id` 存在。
- 创建 `demand_project` 时校验 `workspace_id` 不存在其他 `demand_project`。
- 创建 `repository` / `agent` / `workspace_member` 时校验 `workspace_id` 存在。
- 创建 `agent_session` 时校验 `agent_id` 存在且 `agent.workspace_id == session.workspace_id`。
- 创建 `workspace_standard` 时，若 `repository_id` 非空，校验 `repository.workspace_id == standard.workspace_id`。
- 创建 `workspace_cicd` 时校验 `workspace_id` 不存在其他 `workspace_cicd`。

## 8. 未决问题

- `agents.config` 中的敏感字段（如 `apiKey`）是否加密存储？
- `workspace_members` 是否需要支持邀请状态（pending / accepted）？
- `demand_projects` 是否需要缓存外部平台同步时间字段？
