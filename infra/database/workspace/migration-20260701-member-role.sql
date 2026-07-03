-- Migration 20260701: workspace_members 角色取值规范化
-- 明确 role（空间权限：space_admin/member）与 sub_role（职能：pm/designer/developer/tester）取值集。
-- 适用：已按旧 schema.sql 初始化的数据库。

-- 旧数据迁移：admin → space_admin，user → member
UPDATE workspace_members SET role = 'space_admin' WHERE role = 'admin';
UPDATE workspace_members SET role = 'member' WHERE role = 'user';

COMMENT ON COLUMN workspace_members.role IS
  '空间权限角色：space_admin（空间管理员，可编辑设置/管成员）| member（普通成员）';
COMMENT ON COLUMN workspace_members.sub_role IS
  '职能子角色（仅 member 生效收敛）：pm | designer | developer | tester。space_admin 此字段仅作身份展示。';

ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS chk_wm_role;
ALTER TABLE workspace_members ADD CONSTRAINT chk_wm_role
  CHECK (role IN ('space_admin', 'member'));

ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS chk_wm_sub_role;
ALTER TABLE workspace_members ADD CONSTRAINT chk_wm_sub_role
  CHECK (sub_role IS NULL OR sub_role IN ('pm', 'designer', 'developer', 'tester'));
