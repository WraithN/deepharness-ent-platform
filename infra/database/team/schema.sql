-- team 模块：团队技能 / 团队提示词
-- 用于替换前端 mock 数据，支持空间配置与智能会话下拉读取

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS team_skills (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT '通用',
    tags VARCHAR(500),
    downloads INT NOT NULL DEFAULT 0,
    rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
    installed BOOLEAN NOT NULL DEFAULT FALSE,
    icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
    phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
    status VARCHAR(20) NOT NULL DEFAULT 'on_shelf' CHECK (status IN ('pending_review', 'on_shelf', 'off_shelf', 'rejected')),
    reviewed_by VARCHAR(36),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN team_skills.status IS '审核生命周期状态：pending_review/on_shelf/off_shelf/rejected';
COMMENT ON COLUMN team_skills.reviewed_by IS '审核操作人用户 ID';
COMMENT ON COLUMN team_skills.reviewed_at IS '审核操作时间';

-- 技能-分类多对多链接表
CREATE TABLE IF NOT EXISTS team_skill_category_links (
    skill_id VARCHAR(36) NOT NULL REFERENCES team_skills (id) ON DELETE CASCADE,
    category_id VARCHAR(36) NOT NULL REFERENCES team_skill_categories (id) ON DELETE CASCADE,
    PRIMARY KEY (skill_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_team_skill_cat_links_cat ON team_skill_category_links (category_id);

COMMENT ON TABLE team_skill_category_links IS '技能-分类多对多链接';

-- 提示词-分类多对多链接表
CREATE TABLE IF NOT EXISTS team_prompt_category_links (
    prompt_id VARCHAR(36) NOT NULL REFERENCES team_prompts (id) ON DELETE CASCADE,
    category_id VARCHAR(36) NOT NULL REFERENCES team_prompt_categories (id) ON DELETE CASCADE,
    PRIMARY KEY (prompt_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_team_prompt_cat_links_cat ON team_prompt_category_links (category_id);

COMMENT ON TABLE team_prompt_category_links IS '提示词-分类多对多链接';

COMMENT ON TABLE team_skills IS '团队技能';
COMMENT ON COLUMN team_skills.name IS '技能名称';
COMMENT ON COLUMN team_skills.description IS '技能描述';
COMMENT ON COLUMN team_skills.category IS '技能分类（用于市场/配置筛选）';
COMMENT ON COLUMN team_skills.tags IS '标签，逗号分隔';
COMMENT ON COLUMN team_skills.downloads IS '下载/使用次数';
COMMENT ON COLUMN team_skills.rating IS '评分 0.0-5.0';
COMMENT ON COLUMN team_skills.installed IS '是否已安装到当前空间';
COMMENT ON COLUMN team_skills.icon IS '前端图标组件名称';
COMMENT ON COLUMN team_skills.phase IS '研发阶段（用于智能会话技能下拉分组）';

CREATE INDEX IF NOT EXISTS idx_category ON team_skills (category);
CREATE INDEX IF NOT EXISTS idx_phase ON team_skills (phase);
CREATE INDEX IF NOT EXISTS idx_installed ON team_skills (installed);

-- 工作区技能安装状态：按工作区记录每个技能的安装/卸载状态。
CREATE TABLE IF NOT EXISTS workspace_skill_installs (
    workspace_id VARCHAR(36) NOT NULL,
    skill_id VARCHAR(36) NOT NULL REFERENCES team_skills(id) ON DELETE CASCADE,
    installed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_skill_installs_skill ON workspace_skill_installs(skill_id);

DROP TRIGGER IF EXISTS trigger_workspace_skill_installs_updated_at ON workspace_skill_installs;
CREATE TRIGGER trigger_workspace_skill_installs_updated_at
BEFORE UPDATE ON workspace_skill_installs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_team_skills_updated_at ON team_skills;
CREATE TRIGGER trigger_team_skills_updated_at
BEFORE UPDATE ON team_skills
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS team_prompts (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    use_case VARCHAR(100) NOT NULL DEFAULT '通用',
    usage_count INT NOT NULL DEFAULT 0,
    added_to_space BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
    created_by VARCHAR(36),
    reviewed_by VARCHAR(36),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_team_prompts_status CHECK (status IN ('pending_review', 'on_shelf', 'off_shelf', 'rejected'))
);

COMMENT ON TABLE team_prompts IS '团队提示词';
COMMENT ON COLUMN team_prompts.name IS '提示词名称';
COMMENT ON COLUMN team_prompts.description IS '提示词简介';
COMMENT ON COLUMN team_prompts.content IS '提示词内容（插入输入框时使用）';
COMMENT ON COLUMN team_prompts.use_case IS '使用场景分类';
COMMENT ON COLUMN team_prompts.usage_count IS '使用次数';
COMMENT ON COLUMN team_prompts.added_to_space IS '是否已添加到空间常用列表';
COMMENT ON COLUMN team_prompts.status IS '提示词状态：pending_review/on_shelf/off_shelf/rejected';
COMMENT ON COLUMN team_prompts.created_by IS '创建人 user id';
COMMENT ON COLUMN team_prompts.reviewed_by IS '审核人 user id';
COMMENT ON COLUMN team_prompts.reviewed_at IS '审核时间';

CREATE INDEX IF NOT EXISTS idx_use_case ON team_prompts (use_case);
CREATE INDEX IF NOT EXISTS idx_added_to_space ON team_prompts (added_to_space);
CREATE INDEX IF NOT EXISTS idx_team_prompts_status ON team_prompts (status);
CREATE INDEX IF NOT EXISTS idx_team_prompts_created_by ON team_prompts (created_by);

-- 提示词复制使用去重表：同一用户同一提示词每天（按数据库当前日期）只计数一次。
CREATE TABLE IF NOT EXISTS team_prompt_usage_daily (
    prompt_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    usage_date DATE NOT NULL,
    PRIMARY KEY (prompt_id, user_id, usage_date)
);

COMMENT ON TABLE team_prompt_usage_daily IS '提示词使用计数去重表（每用户每提示词每日一条）';
COMMENT ON COLUMN team_prompt_usage_daily.prompt_id IS '市场提示词 ID（team_prompts.id）';
COMMENT ON COLUMN team_prompt_usage_daily.user_id IS '使用用户 ID';
COMMENT ON COLUMN team_prompt_usage_daily.usage_date IS '使用日期（用于按天去重）';

DROP TRIGGER IF EXISTS trigger_team_prompts_updated_at ON team_prompts;
CREATE TRIGGER trigger_team_prompts_updated_at
BEFORE UPDATE ON team_prompts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 初始化技能数据（ID 固定，便于幂等，使用 ON CONFLICT 避免重复）
INSERT INTO team_skills (id, name, description, category, tags, downloads, rating, installed, icon, phase) VALUES
  ('skill-001', '代码补全专家', '智能上下文代码补全', '编码开发', '代码,效率', 12500, 4.8, TRUE, 'Code2', '代码开发'),
  ('skill-002', '代码重构助手', '自动识别坏味道并重构', '代码审查', '重构,质量', 8300, 4.6, TRUE, 'Code2', '代码开发'),
  ('skill-003', 'UI转代码', '上传设计稿自动生成前端代码', 'UI设计', 'UI,前端', 21000, 4.9, FALSE, 'Box', 'UI设计'),
  ('skill-004', 'API测试生成器', '根据接口文档生成测试用例', '测试验证', '测试,API', 5400, 4.5, FALSE, 'CheckCircle', '测试编写'),
  ('skill-005', 'PRD生成专家', '根据需求描述生成结构化PRD文档', '需求设计', 'PRD,文档', 9800, 4.7, FALSE, 'ListTodo', '需求设计'),
  ('skill-006', '数据库优化助手', '分析SQL性能并提供优化建议', '架构方案', '数据库,性能', 7200, 4.4, FALSE, 'Code2', '代码开发'),
  ('skill-007', 'Jest自动化测试', '为前端代码生成Jest单元测试', '测试验证', 'Jest,前端测试', 11000, 4.6, FALSE, 'CheckCircle', '测试编写'),
  ('skill-008', '预发布巡检助手', '在发布前自动检查常见风险点', '预发布验证', '发布,检查', 4500, 4.3, FALSE, 'UploadCloud', '需求上线'),
  ('skill-009', '自动化部署', '将完成的代码提交并部署上线', '预发布验证', '部署,上线', 8800, 4.5, FALSE, 'UploadCloud', '需求上线'),
  ('skill-010', '需求设计', '通过对话梳理并生成结构化需求文档', '需求设计', '需求,文档', 15000, 4.7, TRUE, 'ListTodo', '需求设计')
ON CONFLICT (id) DO NOTHING;

-- 初始化提示词数据
INSERT INTO team_prompts (id, name, description, content, use_case, usage_count, added_to_space) VALUES
  ('prompt-001', '编写PRD文档模板', '根据需求描述生成结构化PRD文档，自动保存到 projects/prds/ 目录', '请作为产品经理，根据以下需求生成一份结构化的PRD文档。\n\n【文件保存规范】\n1. 将文档保存到 projects/prds/ 目录下（如目录不存在请创建）\n2. 文件命名格式：{需求名称}-prd.md（例如：用户登录-prd.md）\n\n【PRD 内容结构】\n1. 背景与目标\n2. 用户场景\n3. 功能详情\n4. 业务流程图\n5. 数据埋点要求\n\n当前需求：', '需求设计', 45000, TRUE),
  ('prompt-002', '竞品分析框架', '将复杂的代码段转换为易懂的自然语言解释', '请帮我对【功能模块】进行竞品分析，主要对比对象包括：... 比较维度应包含用户体验、功能完整度、商业模式等。', '需求设计', 32000, TRUE),
  ('prompt-003', 'React组件生成标准', '根据业务需求生成SQL建表语句', '请生成一个React组件，要求：使用TypeScript，TailwindCSS进行样式编写，遵循响应式设计，分离逻辑与视图，并添加适当的JSDoc注释。', '前端开发', 28000, FALSE),
  ('prompt-004', 'Go API 接口规范', '为指定函数编写单元测试', '实现一个RESTful API端点，语言为Go，使用Gin框架。要求包含参数验证、统一的错误处理封装、以及完整的Swagger注释。', '后端开发', 19000, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 技能分类表
CREATE TABLE IF NOT EXISTS team_skill_categories (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    workspace_id VARCHAR(36),
    builtin BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_team_skill_categories_name_workspace UNIQUE (name, COALESCE(workspace_id, ''))
);

COMMENT ON TABLE team_skill_categories IS '团队技能分类';
COMMENT ON COLUMN team_skill_categories.name IS '分类名称';
COMMENT ON COLUMN team_skill_categories.builtin IS '是否内置分类，内置不可删除';
COMMENT ON COLUMN team_skill_categories.sort_order IS '排序权重';

DROP TRIGGER IF EXISTS trigger_team_skill_categories_updated_at ON team_skill_categories;
CREATE TRIGGER trigger_team_skill_categories_updated_at
BEFORE UPDATE ON team_skill_categories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 提示词分类表
CREATE TABLE IF NOT EXISTS team_prompt_categories (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    builtin BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE team_prompt_categories IS '团队提示词分类';
COMMENT ON COLUMN team_prompt_categories.name IS '分类名称';
COMMENT ON COLUMN team_prompt_categories.builtin IS '是否内置分类，内置不可删除';
COMMENT ON COLUMN team_prompt_categories.sort_order IS '排序权重';

DROP TRIGGER IF EXISTS trigger_team_prompt_categories_updated_at ON team_prompt_categories;
CREATE TRIGGER trigger_team_prompt_categories_updated_at
BEFORE UPDATE ON team_prompt_categories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 初始化技能分类
INSERT INTO team_skill_categories (id, name, builtin, sort_order) VALUES
  ('skill-cat-001', '编码开发', TRUE, 1),
  ('skill-cat-002', '代码审查', TRUE, 2),
  ('skill-cat-003', 'UI设计', TRUE, 3),
  ('skill-cat-004', '测试验证', TRUE, 4),
  ('skill-cat-005', '需求设计', TRUE, 5),
  ('skill-cat-006', '架构方案', TRUE, 6),
  ('skill-cat-007', '预发布验证', TRUE, 7)
ON CONFLICT (name) DO NOTHING;

-- 初始化提示词分类
INSERT INTO team_prompt_categories (id, name, builtin, sort_order) VALUES
  ('prompt-cat-001', '需求设计', TRUE, 1),
  ('prompt-cat-002', '前端开发', TRUE, 2),
  ('prompt-cat-003', '后端开发', TRUE, 3),
  ('prompt-cat-004', '测试', TRUE, 4),
  ('prompt-cat-005', '通用', TRUE, 5)
ON CONFLICT (name) DO NOTHING;
