-- 平台模板发布状态迁移（2026-07-15）
-- 为已运行的数据库补充 published 字段，并将历史空 label 数据回填充 key。

ALTER TABLE platform_templates
    ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false;

-- 历史数据默认视为已发布，避免升级后业务页面模板全部消失。
UPDATE platform_templates SET published = true WHERE published = false;

-- 回填历史上因编辑被清空的 label，避免保存时触发 label is required。
UPDATE platform_templates SET label = key WHERE label = '' OR label IS NULL;
