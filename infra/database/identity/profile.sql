-- 用户个人信息 Schema（PostgreSQL 15+）
-- 说明：
-- - 主键 user_id 关联 users.id，1:1 关系。
-- - 存储 users 表之外的个人资料：头像、描述、SSH Key。
-- - 昵称仍存于 users.name，保存资料时由应用层同步更新。

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id VARCHAR(36) PRIMARY KEY,
    avatar_url VARCHAR(500),
    description TEXT,
    ssh_key TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE user_profiles IS '用户个人信息';
COMMENT ON COLUMN user_profiles.user_id IS '用户 ID（关联 users.id）';
COMMENT ON COLUMN user_profiles.avatar_url IS '头像图片 URL';
COMMENT ON COLUMN user_profiles.description IS '个人描述';
COMMENT ON COLUMN user_profiles.ssh_key IS 'Git SSH Key，用于代码库授权访问';
COMMENT ON COLUMN user_profiles.updated_at IS '更新时间';

-- 种子数据：为现有用户插入默认个人信息
INSERT INTO user_profiles (user_id, avatar_url, description, ssh_key) VALUES
  ('5b577fdc9e8e406f81c695553dc74836', '', '平台超级管理员，负责全局配置与空间管理。', ''),
  ('a7390f0b07e245d9a7495682738153b5', '', '产品经理，专注需求分析与产品规划。', ''),
  ('2dd09f577fb1421d8204c504d325b359', '', 'UI 设计师，擅长设计稿转代码与视觉规范。', ''),
  ('9113acf484b540f2ab340d7c7a110d7c', '', '全栈开发者，热爱技术，专注全栈开发，享受将创意转化为代码的过程。', ''),
  ('98d9613544fe42dfa07840ea254d3019', '', '测试工程师，负责自动化测试与质量保障。', '')
ON CONFLICT (user_id) DO NOTHING;
