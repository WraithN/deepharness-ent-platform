# 2026-07-29-ProcessDetail 设计产物查看对非 PM 用户返回 403

## 现象
在流程详情页（ProcessDetail）中，非 PM 角色用户点击"查看设计产物"按钮时，前端调用 `CreateRequirementShare` API 返回 403 Forbidden，导致无法查看关联的文档和原型。

## 根因
`CreateRequirementShare` 服务方法（`db_service.go:2620`）调用了 `requirePM()` 进行权限校验，仅允许 PM 角色创建需求分享链接。而流程详情页是所有工作空间成员都可访问的页面，非 PM 用户（如开发者）也需要查看设计产物。

## 解决方案
1. 提取共享逻辑到 `createRequirementShareInternal` 内部方法，消除重复代码
2. 新增 `GetOrCreateRequirementShare` 服务方法，使用 `requireMember`（仅校验成员资格，不要求 PM 角色）
3. 新增 `GET /api/v1/workspaces/{id}/requirement-shares/view` 端点，通过查询参数传递 `doc_id`、`product_folder`、`title`
4. 前端 `ProcessDetail` 改用 `requirementShareApi.getOrCreateView` 调用新端点

### 涉及文件
- `apps/dh-backend/domain/productspace/service/service.go`：接口新增 `GetOrCreateRequirementShare`
- `apps/dh-backend/domain/productspace/service/db_service.go`：重构 + 新增实现
- `apps/dh-backend/domain/productspace/handler.go`：新增 `GetOrCreateRequirementShare` handler
- `apps/dh-backend/gateway/server/server.go`：注册新路由
- `apps/dh-frontend/src/lib/productspace-api.ts`：新增 `getOrCreateView` API 方法
- `apps/dh-frontend/src/pages/ProcessDetail.tsx`：改用新 API
