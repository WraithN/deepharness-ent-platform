# 2026-08-07 工程代码视图下方出现空白

## 现象

在个人工作台的「工程代码」Tab 中，代码浏览器（`ProjectCode`）下方会留有一块空白区域，内部内容没有撑满外部容器。具体表现为：

- 左侧文件树和右侧代码面板高度不足，下方出现未利用的空白。
- 未选择文件时的占位提示（"在左侧选择一个文件进行查看"）没有垂直居中，或者因为容器过高而显示在可视区域之外。

## 根因

`ProductWorkspace` 和 `ProjectCode` 根节点都使用了基于视口高度（`100vh`）的固定高度，而不是让内部组件自适应父容器高度：

- `ProductWorkspace` 使用 `h-[calc((100vh-6rem)*2)]`，导致整个工作台高度被放大到接近两倍视口高度，内部 `Card` 也随之被撑高。
- `ProjectCode` 使用 `h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)]`，高度只等于一个视口高度，无法填满被 `ProductWorkspace` 撑大的父容器，于是下方留下空白。

## 解决方案

将两个组件的根节点高度改为自适应父容器：

1. `apps/dh-frontend/src/components/workspace/ProductWorkspace.tsx`
   - 把 `h-[calc((100vh-6rem)*2)] md:h-[calc((100vh-8rem)*2)] min-h-[1000px]` 改为 `h-full min-h-0`。
   - 移除底部的 `pb-8`，避免产生额外的空白内边距。

2. `apps/dh-frontend/src/pages/ProjectCode.tsx`
   - 把 `h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px]` 改为 `h-full min-h-0`。
   - 移除 `pb-8`，让内部 `Main Content` 的 `flex-1` 真正占满剩余空间。

这样，从 `Layout` → `ProductWorkspace` → `Card` → `ProjectCode` → `ResizablePanelGroup` 形成一致的 `h-full` / `flex-1` 高度链，内部编辑器、文件树和空状态都会自动填满可用空间。

## 验证

- `pnpm --filter @repo/dh-frontend check-types` 通过，无 TypeScript 错误。
- `pnpm build` 全量构建成功。
- `go vet ./...` 在 `apps/dh-backend` 和 `apps/personal-stub` 下均无警告。
- 使用 `developer@deepharness.com` 登录并访问 `/personal-space?tab=code`：
  - 未选择文件时占位提示已垂直居中显示。
  - 选择 `package.json` 后代码编辑器铺满整个右侧面板，下方无空白。
