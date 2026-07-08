-- 工作项表：添加 type 和 reporter 列
ALTER TABLE workitems ADD COLUMN IF NOT EXISTS "type" VARCHAR(50) NOT NULL DEFAULT 'requirement';
ALTER TABLE workitems ADD COLUMN IF NOT EXISTS reporter VARCHAR(200) NOT NULL DEFAULT '';

-- 种子数据：原 mock 数据迁移至数据库
INSERT INTO workitems (id, tenant_id, project_id, type, title, description, status, priority, assignee_id, reporter, source, external_id, created_at, updated_at) VALUES
('REQ-001', 't1', 'p1', 'requirement', '实现多租户登录功能', '支持不同租户间的数据隔离和单点登录，需要实现OAuth2.0协议和JWT Token验证机制。', 'done', 'high', '5b577fdc9e8e406f81c695553dc74836', '产品小红', 'internal', 'MEEGO-101', '2026-05-20T00:00:00Z', '2026-05-25T00:00:00Z'),
('REQ-002', 't1', 'p1', 'requirement', '数据大盘图表展示', '集成ECharts实现多维度数据可视化，支持折线图、柱状图、饼图等常见图表类型。', 'in_progress', 'high', '5b577fdc9e8e406f81c695553dc74836', '产品小红', 'internal', 'MEEGO-102', '2026-05-22T00:00:00Z', '2026-06-05T00:00:00Z'),
('REQ-003', 't1', 'p1', 'requirement', 'UI设计对话助手', '基于自然语言理解，自动生成UI组件建议和设计方案，支持多轮对话迭代。', 'todo', 'medium', '2dd09f577fb1421d8204c504d325b359', '设计小李', 'internal', 'MEEGO-103', '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z'),
('REQ-004', 't1', 'p1', 'requirement', '智能评审结果展示', '将代码评审结果以结构化方式展示，支持按严重程度和文件分组。', 'backlog', 'medium', '9113acf484b540f2ab340d7c7a110d7c', '设计小李', 'internal', 'MEEGO-104', '2026-05-27T00:00:00Z', '2026-05-27T00:00:00Z'),
('REQ-005', 't1', 'p1', 'requirement', 'API 网关限流配置', '基于令牌桶算法实现API限流，支持按用户、IP、接口维度配置限流规则。', 'todo', 'high', '5b577fdc9e8e406f81c695553dc74836', '产品小红', 'internal', 'MEEGO-105', '2026-05-28T00:00:00Z', '2026-05-28T00:00:00Z'),
('BUG-001', 't1', 'p1', 'defect', '登录页面验证码不刷新', '点击验证码图片后，网络请求返回200但图片未更新，需要排查缓存策略。', 'open', 'high', '5b577fdc9e8e406f81c695553dc74836', '测试小刚', 'internal', 'MEEGO-201', '2026-05-26T00:00:00Z', '2026-05-26T00:00:00Z'),
('BUG-002', 't1', 'p1', 'defect', '数据大盘图表数据异常', '当选择时间范围超过30天时，折线图数据点重叠导致渲染性能下降。', 'in_progress', 'medium', '5b577fdc9e8e406f81c695553dc74836', '测试小刚', 'internal', 'MEEGO-202', '2026-05-27T00:00:00Z', '2026-06-01T00:00:00Z'),
('BUG-003', 't1', 'p1', 'defect', '移动端菜单无法展开', '在iOS Safari浏览器中，侧边栏菜单按钮点击无响应，需要检查事件绑定。', 'fixed', 'high', 'a7390f0b07e245d9a7495682738153b5', '产品小红', 'internal', 'MEEGO-203', '2026-05-25T00:00:00Z', '2026-05-29T00:00:00Z'),
('BUG-004', 't1', 'p1', 'defect', '导出PDF文件乱码', '中文字体在导出PDF时出现方块，需要嵌入字体文件并配置字体映射。', 'closed', 'low', '2dd09f577fb1421d8204c504d325b359', '设计小李', 'internal', 'MEEGO-204', '2026-05-20T00:00:00Z', '2026-05-22T00:00:00Z'),
('TC-001', 't1', 'p1', 'case', '登录功能-正常登录验证', '验证用户使用正确的账号密码可以成功登录系统。', 'passed', 'high', '9113acf484b540f2ab340d7c7a110d7c', '测试小刚', 'internal', 'MEEGO-301', '2026-05-22T00:00:00Z', '2026-05-23T00:00:00Z'),
('TC-002', 't1', 'p1', 'case', '登录功能-密码错误处理', '验证输入错误密码时系统给出正确的错误提示。', 'passed', 'medium', '9113acf484b540f2ab340d7c7a110d7c', '测试小刚', 'internal', 'MEEGO-302', '2026-05-22T00:00:00Z', '2026-05-23T00:00:00Z'),
('TC-003', 't1', 'p1', 'case', '数据大盘-时间范围筛选', '验证时间范围选择器正确过滤图表数据。', 'failed', 'medium', '9113acf484b540f2ab340d7c7a110d7c', '产品小红', 'internal', 'MEEGO-303', '2026-05-27T00:00:00Z', '2026-05-28T00:00:00Z'),
('TC-004', 't1', 'p1', 'case', '权限管理-角色分配', '验证管理员可以正确分配用户角色。', 'draft', 'high', '9113acf484b540f2ab340d7c7a110d7c', '产品小红', 'internal', 'MEEGO-304', '2026-05-28T00:00:00Z', '2026-05-28T00:00:00Z'),
('TC-005', 't1', 'p1', 'case', 'API限流-超限响应验证', '验证超过限流阈值后接口返回429状态码。', 'ready', 'high', '9113acf484b540f2ab340d7c7a110d7c', '测试小刚', 'internal', 'MEEGO-305', '2026-05-28T00:00:00Z', '2026-05-28T00:00:00Z'),
('REQ-006', 't1', 'p1', 'requirement', '营销活动管理后台', '搭建营销活动管理后台系统，支持活动创建、审批、投放、数据看板等全流程管理。

核心功能模块：
1. 活动管理：创建/编辑/上下线活动，支持活动模板和批量操作
2. 审批流程：多级审批配置，支持驳回和重新提交
3. 投放管理：渠道配置（App推送/短信/站内信/弹窗），定时投放和A/B测试
4. 数据看板：活动实时数据、转化漏斗、ROI分析，支持导出报表
5. 权限管理：按角色控制菜单和数据权限，支持多租户隔离

技术要求：
- 前端：React + TypeScript + Ant Design Pro
- 后端：Node.js + Express + PostgreSQL
- 需要对接现有用户中心和消息中心', 'backlog', 'high', '5b577fdc9e8e406f81c695553dc74836', '产品小红', 'internal', 'MEEGO-106', '2026-06-15T00:00:00Z', '2026-06-20T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
