-- 工作项空间隔离：为 workitems 表添加 workspace_id 列
-- 所有工作项归属于具体空间，实现按空间维度的数据隔离

ALTER TABLE workitems ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(36) NOT NULL DEFAULT '';

-- 为空间维度查询创建索引
CREATE INDEX IF NOT EXISTS idx_workitems_workspace_id ON workitems(workspace_id);

-- 回填现有数据：将所有未关联空间的工作项归入「硅尘侠影」空间
UPDATE workitems SET workspace_id = '056529ec51754cfcb38859c999aa86f0' WHERE workspace_id = '';
