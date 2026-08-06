# 2026-08-05-repo-standards-empty-url-state.md

## 现象

在"空间设置"中打开某个已保存仓库的"仓库规范配置"弹窗时，如果该仓库没有填写远程地址（`url` 为空），弹窗直接展示：

> 需要先配置 Git 仓库  
> 请填写仓库地址并保存仓库配置后，再设置仓库规范。

后端实际上并未返回任何数据，用户看不到仓库本地的 AGENTS.md / DESIGN.md 规范文件，也无法判断是"未配置远程地址"还是"仓库尚未保存"。

影响范围：仓库规范配置弹窗（`RepoStandardsDialog.tsx`）。

## 根因

前端把两种未配置状态合并为同一个 `unconfigured` 判定：

```ts
const unconfigured = !repo.url || repo.id.startsWith(LOCAL_REPO_ID_PREFIX);
```

只要 `url` 为空，就认为仓库完全未配置，直接阻止请求后端。但后端 `standardFiles` / `standardFiles/init` 接口只依赖 `repo.LocalPath` 与 `repo.CloneStatus` 读取本地目录，不依赖远程地址。因此已保存但无远程地址的仓库被错误拦截，无法展示本地已有的规范文件数据。

## 解决方案

1. 拆分状态：
   - `isLocalDraft`：`repo.id` 以 `local-` 开头，表示尚未保存入库，继续拦截并提示"需要先配置 Git 仓库"。
   - `missingRemoteUrl`：仓库已保存但 `url` 为空，不再拦截请求，正常调用后端读取本地规范文件。

2. 在已加载规范文件内容的界面上新增一条提示：
   - 如果仓库已克隆：提示当前未配置远程地址，无法从远程拉取/同步，但可直接编辑本地规范文件。
   - 如果仓库未克隆：提示未配置远程地址，若已克隆可编辑本地文件，否则需先填写仓库地址。

3. 验证：
   - `pnpm --filter @repo/dh-frontend check-types` 通过。
   - `pnpm --filter @repo/dh-frontend lint` 通过（Biome 无报错）。
   - `pnpm build` 全量构建成功。
   - `bash scripts/restart-dev.sh` 重启后，前后端服务均正常响应（`/` 与 `/health` 返回 200）。

## 相关文件

- `apps/dh-frontend/src/components/RepoStandardsDialog.tsx`
- `apps/dh-backend/domain/repository/standards_handler.go`
