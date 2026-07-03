-- Migration 20260701: 新增用户个人信息表
-- 存储头像、个人描述、Git SSH Key 等扩展资料，与 users 表 1:1 关联。

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

-- 种子数据
INSERT INTO user_profiles (user_id, avatar_url, description, ssh_key) VALUES
  ('u1', '', '平台超级管理员，负责全局配置与空间管理。', ''),
  ('u2', '', '产品经理，专注需求分析与产品规划。', ''),
  ('u3', '', 'UI 设计师，擅长设计稿转代码与视觉规范。', ''),
  ('u4', '', '全栈开发者，热爱技术，专注全栈开发，享受将创意转化为代码的过程。', ''),
  ('u5', '', '测试工程师，负责自动化测试与质量保障。', '')
ON CONFLICT (user_id) DO NOTHING;
