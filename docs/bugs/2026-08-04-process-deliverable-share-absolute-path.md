# 交付物"打开"功能绝对路径拒绝缺陷修复

## 现象

在需求流程交付物（process deliverable）页面点击"打开"按钮时，系统无法正确共享文件，返回错误。根因是 agent 生成的交付物标记中包含绝对路径（如 `[[FILE:/home/nan/test/{userID}/{workspaceID}/pm-jobs/draft/file.md]]`），而 `importProcessDoc` / `importProcessPrototype` 在重建源文件路径时使用了 `ownerUserID`（工作项分配人），但实际文件由 `operatorId`（操作 agent 的用户）创建。当 `assigneeId` 为空时，`ownerUserID` 与实际文件路径中的用户 ID 不一致，导致路径重建错误，文件读取失败。

## 根因

1. **路径重建逻辑错误**：`importProcessDoc` 和 `importProcessPrototype` 通过 `ownerUserID`（workitem assignee）重建源文件路径，但文件实际创建在 `operatorId`（agent 用户）目录下。
2. **缺少原始绝对路径传递**：标记中的绝对路径信息在解析后丢失，未传递到文件导入逻辑中。
3. **路径规范化缺失**：交付物路径未经规范化处理，可能包含 `./`、`../` 等相对路径组件。

## 解决方案

1. **新增 `normalizeDeliverablePath` 函数**（`domain/productspace/service/fileutil.go`）：对交付物路径进行规范化处理，去除前导 `./`、解析 `../`、确保路径以 `/` 开头。
2. **保留原始绝对路径**：`ImportProcessDeliverable` 新增 `originalPath` 参数，保留标记中的原始绝对路径用于文件读取。
3. **更新 `importProcessDoc` / `importProcessPrototype` 签名**：新增 `absSourcePath` 参数，当非空时直接使用原始绝对路径读取文件，为空时回退到 `ownerUserID` 重建路径。
4. **验证**：通过 `curl` 测试确认交付物共享接口返回有效的 share token。

## 影响范围

- `domain/productspace/service/fileutil.go`：新增 `normalizeDeliverablePath` 函数
- `domain/productspace/service/folder_service.go`：`ImportProcessDeliverable`、`importProcessDoc`、`importProcessPrototype` 签名更新
