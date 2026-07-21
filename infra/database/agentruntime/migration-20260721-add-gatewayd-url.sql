-- 2026-07-21 为 agent_runtimes 表添加 gatewayd_url 列
-- 修复外部 gatewayd / agent-stub 上报运行时状态时因列不存在而 500 的问题。

ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS gatewayd_url VARCHAR(512) NOT NULL DEFAULT '';
