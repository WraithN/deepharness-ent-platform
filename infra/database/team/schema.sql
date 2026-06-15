-- team 模块：团队技能 / 团队提示词
-- 用于替换前端 mock 数据，支持空间配置与智能会话下拉读取

-- 显式声明客户端连接字符集，避免中文在通过 mysql 客户端导入时出现双重编码。
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS team_skills (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL COMMENT '技能名称',
  description TEXT COMMENT '技能描述',
  category VARCHAR(100) NOT NULL DEFAULT '通用' COMMENT '技能分类（用于市场/配置筛选）',
  tags VARCHAR(500) COMMENT '标签，逗号分隔',
  downloads INT NOT NULL DEFAULT 0 COMMENT '下载/使用次数',
  rating DECIMAL(2,1) NOT NULL DEFAULT 5.0 COMMENT '评分 0.0-5.0',
  installed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已安装到当前空间',
  icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle' COMMENT '前端图标组件名称',
  phase VARCHAR(50) NOT NULL DEFAULT '代码开发' COMMENT '研发阶段（用于智能会话技能下拉分组）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_category (category),
  KEY idx_phase (phase),
  KEY idx_installed (installed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队技能';

CREATE TABLE IF NOT EXISTS team_prompts (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL COMMENT '提示词名称',
  description TEXT COMMENT '提示词简介',
  content TEXT NOT NULL COMMENT '提示词内容（插入输入框时使用）',
  use_case VARCHAR(100) NOT NULL DEFAULT '通用' COMMENT '使用场景分类',
  usage_count INT NOT NULL DEFAULT 0 COMMENT '使用次数',
  added_to_space TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已添加到空间常用列表',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_use_case (use_case),
  KEY idx_added_to_space (added_to_space)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队提示词';

-- 初始化技能数据（ID 固定，便于幂等，使用 INSERT IGNORE 避免重复）
INSERT IGNORE INTO team_skills (id, name, description, category, tags, downloads, rating, installed, icon, phase) VALUES
  ('skill-001', '代码补全专家', '智能上下文代码补全', '编码开发', '代码,效率', 12500, 4.8, 1, 'Code2', '代码开发'),
  ('skill-002', '代码重构助手', '自动识别坏味道并重构', '代码审查', '重构,质量', 8300, 4.6, 1, 'Code2', '代码开发'),
  ('skill-003', 'UI转代码', '上传设计稿自动生成前端代码', 'UI设计', 'UI,前端', 21000, 4.9, 0, 'Box', 'UI设计'),
  ('skill-004', 'API测试生成器', '根据接口文档生成测试用例', '测试验证', '测试,API', 5400, 4.5, 0, 'CheckCircle', '测试编写'),
  ('skill-005', 'PRD生成专家', '根据需求描述生成结构化PRD文档', '需求设计', 'PRD,文档', 9800, 4.7, 0, 'ListTodo', '需求设计'),
  ('skill-006', '数据库优化助手', '分析SQL性能并提供优化建议', '架构方案', '数据库,性能', 7200, 4.4, 0, 'Code2', '代码开发'),
  ('skill-007', 'Jest自动化测试', '为前端代码生成Jest单元测试', '测试验证', 'Jest,前端测试', 11000, 4.6, 0, 'CheckCircle', '测试编写'),
  ('skill-008', '预发布巡检助手', '在发布前自动检查常见风险点', '预发布验证', '发布,检查', 4500, 4.3, 0, 'UploadCloud', '需求上线'),
  ('skill-009', '自动化部署', '将完成的代码提交并部署上线', '预发布验证', '部署,上线', 8800, 4.5, 0, 'UploadCloud', '需求上线'),
  ('skill-010', '需求设计', '通过对话梳理并生成结构化需求文档', '需求设计', '需求,文档', 15000, 4.7, 1, 'ListTodo', '需求设计');

-- 初始化提示词数据
INSERT IGNORE INTO team_prompts (id, name, description, content, use_case, usage_count, added_to_space) VALUES
  ('prompt-001', '编写PRD文档模板', '提供组件描述，生成带TypeScript和Tailwind的React组件', '请作为产品经理，根据以下需求生成一份结构化的PRD文档，包含：1. 背景与目标 2. 用户场景 3. 功能详情 4. 业务流程图 5. 数据埋点要求。当前需求：', '需求设计', 45000, 1),
  ('prompt-002', '竞品分析框架', '将复杂的代码段转换为易懂的自然语言解释', '请帮我对【功能模块】进行竞品分析，主要对比对象包括：... 比较维度应包含用户体验、功能完整度、商业模式等。', '需求设计', 32000, 1),
  ('prompt-003', 'React组件生成标准', '根据业务需求生成SQL建表语句', '请生成一个React组件，要求：使用TypeScript，TailwindCSS进行样式编写，遵循响应式设计，分离逻辑与视图，并添加适当的JSDoc注释。', '前端开发', 28000, 0),
  ('prompt-004', 'Go API 接口规范', '为指定函数编写单元测试', '实现一个RESTful API端点，语言为Go，使用Gin框架。要求包含参数验证、统一的错误处理封装、以及完整的Swagger注释。', '后端开发', 19000, 0);
