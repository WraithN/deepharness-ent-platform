-- 工作项表：添加 parent_id 以支持需求父子关系
-- 适用：已按旧 schema.sql 初始化的数据库。
-- 请在 psql 中执行：\i migration-20260728-add-parent-id.sql

ALTER TABLE workitems ADD COLUMN IF NOT EXISTS parent_id VARCHAR(36);
CREATE INDEX IF NOT EXISTS idx_workitems_parent ON workitems (parent_id);
