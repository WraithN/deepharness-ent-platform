# 2026-07-07 空间设置页无法添加自定义技能分类

## 现象

在租户空间的**设置 > 技能**页面，点击分类栏的「+」新增自定义分类并输入名称后，前端提示：

> 添加分类失败，可能已存在

实际上该分类名称并未重复。该问题导致租户管理员/空间管理员无法在空间设置页创建自定义技能分类，只能使用系统内置分类。

## 根因

后端 `POST /api/v1/team/skill-categories` 在权限校验时仅允许 **超级管理员（super_admin）** 创建技能分类：

```go
if role != identity.PlatformRoleSuperAdmin {
    handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
    return
}
```

而技能分类属于团队/租户级别的配置，租户管理员本应有权管理。前端在空间设置页是以租户管理员身份调用该接口，因此收到 403，前端统一将非 403 错误提示为「可能已存在」，造成误导。

## 解决方案

将 `apps/dh-backend/domain/team/handler.go` 中创建技能分类的权限校验放宽为 **超级管理员或租户管理员**：

```go
if role != identity.PlatformRoleSuperAdmin && role != identity.PlatformRoleTenantAdmin {
    handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or super admin required")
    return
}
```

前端同步保持 `isTenantAdmin` 的判断，确保只有具备平台租户管理员角色的用户才展示新增/删除分类入口。

## 验证结果

1. 重新编译并启动开发服务器：`pnpm build`、`pnpm dev`。
2. 使用租户管理员 token 调用接口：
   ```bash
   curl -X POST http://localhost:8080/api/v1/team/skill-categories \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"name":"tenant-test"}'
   ```
   返回 201 并返回新建分类信息，创建成功。
3. `pnpm check-types`、`pnpm lint`、`pnpm build` 均通过，无新增 warning。
4. 前后端健康检查均正常：
   - Backend: `http://localhost:8080/health` → 200
   - Frontend: `http://localhost:8888/` → 200
