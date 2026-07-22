-- 原型页面批注增加位置/元素信息（PostgreSQL 15+）
ALTER TABLE product_prototype_comments
ADD COLUMN IF NOT EXISTS selector VARCHAR(500),
ADD COLUMN IF NOT EXISTS target_text TEXT,
ADD COLUMN IF NOT EXISTS x DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS y DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_prototype_comments_item_selector
ON product_prototype_comments (item_id, selector);
