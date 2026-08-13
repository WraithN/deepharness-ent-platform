-- 新增 source_doc_path 字段，存储触发流程的源文档路径
ALTER TABLE processes ADD COLUMN IF NOT EXISTS source_doc_path VARCHAR(1024) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_processes_workitem_doc ON processes(workitem_id, source_doc_path);
