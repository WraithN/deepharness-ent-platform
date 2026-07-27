-- 为需求级统一分享记录补充需求标题，便于分享落地页展示。
ALTER TABLE requirement_shares ADD COLUMN IF NOT EXISTS title VARCHAR(500);
