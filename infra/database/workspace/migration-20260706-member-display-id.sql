-- 迁移：将 users.id 升级为 uuid（去掉 -），并在 workspace_members 增加 display_id
-- 展示 ID 格式为 u1, u2...，每个工作空间独立自增；所有业务逻辑仍使用 uuid 形式的用户 ID。

-- 1. 创建临时映射表：old_id -> new_id（uuid 去掉 -）
CREATE TABLE IF NOT EXISTS _user_uuid_map AS
SELECT
  id AS old_id,
  LOWER(REPLACE(gen_random_uuid()::text, '-', '')) AS new_id
FROM users;

-- 2. 为 workspace_members 增加展示 ID 字段
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS display_id VARCHAR(20);

-- 3. 临时删除 user_profiles 外键，更新后重建
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS fk_user_profiles_user;

-- 4. 更新 workspace_members.user_id 为 uuid
UPDATE workspace_members wm
SET user_id = m.new_id
FROM _user_uuid_map m
WHERE wm.user_id = m.old_id;

-- 5. 更新业务表中的用户引用为 uuid
UPDATE workitems w
SET assignee_id = m.new_id
FROM _user_uuid_map m
WHERE w.assignee_id = m.old_id;

UPDATE workitems w
SET reporter = m.new_id
FROM _user_uuid_map m
WHERE w.reporter = m.old_id;

UPDATE agents a
SET created_by_user_id = m.new_id
FROM _user_uuid_map m
WHERE a.created_by_user_id = m.old_id;

UPDATE product_docs p
SET created_by = m.new_id
FROM _user_uuid_map m
WHERE p.created_by = m.old_id;

UPDATE product_doc_versions p
SET created_by = m.new_id
FROM _user_uuid_map m
WHERE p.created_by = m.old_id;

UPDATE team_prompts t
SET created_by = m.new_id
FROM _user_uuid_map m
WHERE t.created_by = m.old_id;

UPDATE team_prompts t
SET reviewed_by = m.new_id
FROM _user_uuid_map m
WHERE t.reviewed_by = m.old_id;

UPDATE user_profiles p
SET user_id = m.new_id
FROM _user_uuid_map m
WHERE p.user_id = m.old_id;

-- 6. 更新 users.id 为 uuid
UPDATE users u
SET id = m.new_id
FROM _user_uuid_map m
WHERE u.id = m.old_id;

-- 7. 重建 user_profiles 外键
ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 8. 为 workspace_members 生成展示 ID（每个空间独立自增）
WITH numbered AS (
  SELECT
    workspace_id,
    user_id,
    ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY joined_at) AS rn
  FROM workspace_members
)
UPDATE workspace_members wm
SET display_id = 'u' || n.rn
FROM numbered n
WHERE wm.workspace_id = n.workspace_id AND wm.user_id = n.user_id;

-- 9. 清理临时表
DROP TABLE _user_uuid_map;

-- 10. 确保新增成员时 display_id 不为空（后续由应用层生成）
ALTER TABLE workspace_members ALTER COLUMN display_id SET NOT NULL;
