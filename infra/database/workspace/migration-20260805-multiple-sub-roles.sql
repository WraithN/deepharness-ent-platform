-- 支持同一成员拥有多个职能子角色
-- 原 sub_role 列改为逗号分隔存储多个角色，如 'pm,developer'。
-- 移除单值 CHECK 约束，由应用层校验每个子角色取值。

ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS chk_wm_sub_role;

COMMENT ON COLUMN workspace_members.sub_role IS
  '职能子角色（可多个，逗号分隔；仅 member 生效收敛）：pm | designer | developer | tester。space_admin 此字段仅作身份展示。';
