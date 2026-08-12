# 2026-08-11: 架构库类型变更未持久化

## 现象
在 Settings 页面修改代码仓库类型为"架构库"后，切换到 PersonalSpace 的"架构设计" tab，ArchDesignWorkspace 仍显示"未配置架构库"（not-configured 状态）。

## 根因
Settings 页面的仓库设置弹窗（gear icon → "仓库设置" dialog）中，"确认"按钮只更新 React 本地状态（`setGitRepos` + `markRepoDirty`），不调用后端 API 持久化。用户需要在关闭弹窗后，再点击仓库行上的"保存"按钮才真正保存到后端。

`handleConfirmRepoSettings`（Settings.tsx:1186）遗漏了对 `handleSaveRepo` 的调用，导致 type 变更仅存在于内存中，导航离开后丢失。

## 解决方案
在 `handleConfirmRepoSettings` 中，于更新本地状态和关闭弹窗之后，调用 `handleSaveRepo(updatedRepo)` 自动保存。用户点击"确认"即可立即持久化类型变更，无需额外点击"保存"按钮。

### 修改文件
- `apps/dh-frontend/src/pages/Settings.tsx:1186-1199` — `handleConfirmRepoSettings` 新增 `handleSaveRepo(updatedRepo)` 调用
