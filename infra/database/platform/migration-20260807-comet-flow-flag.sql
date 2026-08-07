-- 平台级功能开关表，支持运行时动态开关（如 Comet Classic 工作流开关）。
-- 供后台指令管理页切换，开关状态由 dh-backend 运行时读取，决定指令渲染走原模板还是 cometTemplate。
CREATE TABLE IF NOT EXISTS platform_feature_flags (
    flag_key  VARCHAR(64) PRIMARY KEY,
    enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE platform_feature_flags IS '平台级功能开关';
COMMENT ON COLUMN platform_feature_flags.flag_key IS '开关标识（如 comet_flow）';
COMMENT ON COLUMN platform_feature_flags.enabled IS '是否启用';
COMMENT ON COLUMN platform_feature_flags.updated_at IS '更新时间';

-- 默认插入 comet_flow 开关（关闭状态）。
INSERT INTO platform_feature_flags(flag_key, enabled) VALUES ('comet_flow', false)
    ON CONFLICT (flag_key) DO NOTHING;

DROP TRIGGER IF EXISTS trigger_platform_feature_flags_updated_at ON platform_feature_flags;
CREATE TRIGGER trigger_platform_feature_flags_updated_at
BEFORE UPDATE ON platform_feature_flags
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
