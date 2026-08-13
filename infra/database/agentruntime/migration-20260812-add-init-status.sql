-- 2026-08-12 为 agent_runtimes 表添加 init_status 列
-- 用于 personal-stub 在安装 comet skill 期间上报初始化状态信息（如"正在安装 SDD 支持"）
ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS init_status VARCHAR(256) NOT NULL DEFAULT '';
