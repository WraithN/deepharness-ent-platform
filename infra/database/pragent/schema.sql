-- PR Agent 评审 Schema（PostgreSQL 15+）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS review_results (
    id VARCHAR(36) PRIMARY KEY,
    repo VARCHAR(200) NOT NULL,
    pr_id INT NOT NULL,
    title VARCHAR(500) NOT NULL,
    summary TEXT,
    issues JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_results_repo ON review_results (repo);
CREATE INDEX IF NOT EXISTS idx_review_results_created ON review_results (created_at DESC);

-- 种子数据：原 mock 数据迁移至数据库
INSERT INTO review_results (id, repo, pr_id, title, summary, issues, created_at) VALUES
(
    'rev-001', 'frontend-web', 42, 'feat: 新增登录页面',
    '代码整体结构良好，但存在2处潜在问题和1个优化建议。',
    '[
        {"id":"iss-001","file":"src/pages/Login.tsx","line":34,"severity":"high","message":"密码输入框缺少 autocomplete 属性，可能导致浏览器无法正确识别"},
        {"id":"iss-002","file":"src/hooks/useAuth.ts","line":12,"severity":"medium","message":"JWT Token 未设置过期时间检查，存在安全风险"},
        {"id":"iss-003","file":"src/utils/validator.ts","line":8,"severity":"low","message":"邮箱正则表达式可以优化，当前不支持部分新顶级域名"}
    ]',
    '2026-06-09T10:00:00Z'
),
(
    'rev-002', 'backend-api', 38, 'fix: 修复数据大盘查询性能',
    'SQL 查询优化显著提升了性能，但建议补充单元测试覆盖边界情况。',
    '[
        {"id":"iss-004","file":"internal/dashboard/service.go","line":56,"severity":"medium","message":"时间范围参数未做上限校验，可能导致大量数据查询"},
        {"id":"iss-005","file":"internal/dashboard/service.go","line":78,"severity":"low","message":"建议将 magic number 30 提取为常量"}
    ]',
    '2026-06-08T15:30:00Z'
),
(
    'rev-003', 'ui-components', 15, 'refactor: 重构 Button 组件',
    '重构逻辑清晰，组件复用性提升。无严重问题。',
    '[
        {"id":"iss-006","file":"src/components/Button.tsx","line":22,"severity":"low","message":"variant prop 可以进一步约束为联合类型"}
    ]',
    '2026-06-07T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;
