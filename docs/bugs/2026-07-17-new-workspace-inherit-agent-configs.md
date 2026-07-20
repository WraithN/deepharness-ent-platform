# 2026-07-17-new-workspace-inherit-agent-configs

## 现象

通过左侧工作空间下拉创建新空间时，新空间不会继承当前所在空间的智能体配置（启用状态、默认智能体、模型选择等），创建后需要重新配置，体验割裂。

## 根因

后端 `CreateWorkspace` 只接收租户和基础信息，没有源空间参数，也不会复制 `workspace_agent_configs` 表；前端 `Layout.tsx` 创建时只传了 `tenantId`、`name`、`ownerUserId`、`subRole`，没有携带当前空间 ID。

## 解决方案

1. 后端：
   - 在 `WorkspaceService` 接口和 `DBWorkspaceService.CreateWorkspace` 中增加 `sourceWorkspaceID` 参数。
   - 在事务中插入新空间、成员后，若 `sourceWorkspaceID` 非空，调用 `copyWorkspaceAgentConfigsTx` 校验源空间是否属于同一租户，并将源空间的 `workspace_agent_configs` 行复制到目标空间。
   - 在 `workspace/handler.go` 的 `createWorkspaceRequest` 中增加 `sourceWorkspaceId` 字段并透传。
2. 前端：
   - 在 `workspaceApi.create` 类型中增加 `sourceWorkspaceId`。
   - 在 `Layout.tsx` 的 `handleCreateWorkspace` 中传入 `sourceWorkspaceId: getCurrentWorkspaceId()`。

## 验证

- 后端 `go vet ./apps/dh-backend/...` 通过。
- 前端类型检查与构建通过。
- 本地开发环境启动后，创建新空间会继承当前空间的智能体配置。
