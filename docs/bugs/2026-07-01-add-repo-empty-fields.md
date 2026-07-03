# 添加 Git 仓库报错

> 日期：2026-07-01

## 现象

在空间设置页点击"新增仓库"按钮时，前端立即调用 `repositoryApi.create` 发送 POST 请求，但请求体中 `name` 和 `url` 均为空字符串，后端校验 `name, url and type are required` 返回 400，前端 toast 提示"新增仓库失败"。

## 根因

`apps/web/src/pages/Settings.tsx` 的 `handleAddRepo` 函数在设计上试图先调 API 创建空记录、再将返回的 repo 加入本地状态。但后端 `Repositories` handler（`apps/dh-backend/domain/repository/handler.go:42`）对 `name`/`url`/`type` 做了非空校验，空字符串直接拒绝。

这与 UI 交互意图不符——"新增仓库"按钮的目的是为用户添加一行空白输入框供填写，实际入库应在用户填写完点"保存"后进行。

## 解决方案

1. `handleAddRepo`：不再调 API，改为在前端本地状态中新增一行空白 `WorkspaceRepository`，使用 `local-` 前缀的临时 ID 标识。
2. `handleSaveBasic`：保存时区分 `local-` 前缀（调 `repositoryApi.create`）与已入库 ID（调 `repositoryApi.update`），并将 create 返回的真实 ID 回填到本地状态。
3. `handleRemoveRepo`：对 `local-` 前缀的行直接从状态移除，无需调 API delete。

验证结果：
- 有效数据 create 返回 201 ✓
- 空字段 create 返回 400 ✓（前端不再触发此路径）
- 本地新增行 → 填写 → 保存 → create 入库 ✓
