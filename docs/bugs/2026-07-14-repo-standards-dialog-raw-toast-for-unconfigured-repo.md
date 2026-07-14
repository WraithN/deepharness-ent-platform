# 仓库规范弹窗对未配置仓库弹出原始错误 toast

## 现象

空间设置「代码仓库」中新增但未填写地址/未保存入库的仓库行（临时行，ID 为 `local-` 前缀），点击「设置规范」按钮后弹窗一直显示「加载仓库规范...」，同时右下角弹出原始 JSON 错误 toast：`{"code":1,"message":"repository not found"}`，体验差且信息不友好。

## 根因

`RepoStandardsDialog` 打开时无条件调用 `GET /repositories/{repoId}/standard-files`：临时仓库行尚未入库，后端查不到记录返回 404；前端 `.catch` 直接用 `toast.error(err.message)` 展示，而 `ApiError.message` 是原始响应体文本（JSON 字符串）。

## 解决方案

1. 未配置判定前置：`!repo.url || repo.id.startsWith('local-')` 时不请求后端，弹窗内居中展示空态引导「需要先配置 Git 仓库——请填写仓库地址并保存仓库配置后，再设置仓库规范」。
2. 加载失败不再弹 toast，改为弹窗内联展示失败原因（`loadError` 状态），覆盖仓库已删除等边界场景。

## 验证结果

- e2e（Playwright）：新增临时仓库行 → 点击设置规范 → 弹窗内显示「需要先配置 Git 仓库」引导，`[data-sonner-toast]` 数量为 0。
- `tsc -p tsconfig.check.json` 0 errors，biome 无问题，`pnpm build` 6/6 成功。
