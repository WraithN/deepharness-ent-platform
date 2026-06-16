-- migration-20260616.sql
-- 目标：将已有 PostgreSQL 实例从 demand_projects/repositories(旧) 迁移到新结构。
-- 请在 psql 中执行：\i migration-20260616.sql

-- 1. 重命名 demand_projects 为 workitem_projects
ALTER TABLE IF EXISTS demand_projects RENAME TO workitem_projects;
ALTER INDEX IF EXISTS idx_demand_projects_workspace_id RENAME TO idx_workitem_projects_workspace_id;

-- 重命名主键约束（表重命名不会自动修改主键约束名）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'demand_projects_pkey'
          AND conrelid = 'workitem_projects'::regclass
    ) THEN
        ALTER TABLE workitem_projects RENAME CONSTRAINT demand_projects_pkey TO workitem_projects_pkey;
    END IF;
END $$;

-- PostgreSQL 的 ALTER TRIGGER 不支持 IF EXISTS，使用 DO 块判断后重命名
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_demand_projects_updated_at'
          AND tgrelid = 'workitem_projects'::regclass
    ) THEN
        ALTER TRIGGER trigger_demand_projects_updated_at ON workitem_projects
        RENAME TO trigger_workitem_projects_updated_at;
    END IF;
END $$;

-- 2. 扩展 repositories 表
ALTER TABLE IF EXISTS repositories
    ADD COLUMN IF NOT EXISTS ssh_key TEXT,
    ADD COLUMN IF NOT EXISTS local_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS clone_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 已有数据默认标记为 pending，等待重新同步
UPDATE repositories SET clone_status = 'pending' WHERE clone_status IS NULL;

-- 添加唯一约束（如果尚未存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'repositories_workspace_id_name_key'
    ) THEN
        ALTER TABLE repositories ADD CONSTRAINT repositories_workspace_id_name_key UNIQUE (workspace_id, name);
    END IF;
END $$;
