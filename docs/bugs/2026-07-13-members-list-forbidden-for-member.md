# 普通成员无法查看空间成员列表（403）

## 现象

普通成员（role=member）打开「空间设置 → 成员管理」时，成员列表加载失败：`GET /api/v1/workspaces/{id}/members` 返回 403 `forbidden: space admin required`，前端 toast「加载成员列表失败」。

## 根因

`domain/workspace/handler.go` 的 `Members` 入口对 GET（列表）与 POST（添加）统一调用 `requireWorkspaceAdmin`，即只有空间管理员/租户管理员能访问。按产品权限模型，成员列表应对所有空间成员可见，仅操作（增删/任免）需要管理员权限。

## 解决方案

1. 新增 `requireWorkspaceMember`：超级管理员、同租户租户管理员或该空间任意成员均可通过，用于 GET 成员列表；POST 保持 `requireWorkspaceAdmin`。
2. 顺带补齐操作权限矩阵（新增 `requireSuperOrTenantAdmin` 复用校验）：
   - POST 添加为 `space_admin`、PUT 新角色为 `space_admin`、DELETE 目标为 `space_admin` 时，仅租户管理员/超级管理员可操作（空间管理员 403）；
   - PUT 原有的「目标是空间管理员需租户管理员」校验复用同一 helper。
3. 前端 Settings 成员管理同步：「添加成员」按钮对空间管理员/租户管理员可见；「同时设置为空间管理员」勾选框与「设为/取消空间管理员」菜单项仅租户管理员可见；空间管理员对空间管理员行显示「无操作权限」。

验证结果：13 项 curl 权限矩阵全部符合预期（普通成员 GET 200 / POST 403 / DELETE 403；空间管理员增删普通成员通过、任免空间管理员 403；租户管理员全部通过）；浏览器 e2e 验证三种角色视角的按钮/菜单可见性正确。
