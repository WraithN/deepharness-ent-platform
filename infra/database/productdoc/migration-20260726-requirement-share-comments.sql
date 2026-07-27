-- 为需求级统一分享记录增加是否允许访客添加批注的开关。
ALTER TABLE requirement_shares ADD COLUMN IF NOT EXISTS allow_comments BOOLEAN NOT NULL DEFAULT true;
-- 历史记录默认允许访客批注，保持与旧行为一致。
UPDATE requirement_shares SET allow_comments = true WHERE allow_comments IS NULL;
