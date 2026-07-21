-- 2026-07-21 为 agent_runtimes 表添加 workspace_path 列
-- 用于 gatewayd 通过状态上报接口回传实际工作目录。

ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS workspace_path VARCHAR(512) NOT NULL DEFAULT '';
