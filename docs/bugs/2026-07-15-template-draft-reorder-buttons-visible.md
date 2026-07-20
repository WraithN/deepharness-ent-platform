# 2026-07-15 草稿态模板仍显示排序按钮

## 现象

在超管模板管理页（`/admin/templates`）左侧模板列表中：

- 已发布模板会显示「上移 / 下移」排序按钮；
- 草稿态模板同样显示了这两个排序按钮，只是被置为 `disabled` 状态；
- 后端 `UpdateOrder` 仅允许对已发布模板排序，因此草稿态的排序按钮没有实际意义，属于界面冗余。

## 根因

前端 `TemplateManagement.tsx` 在渲染列表项操作时，没有根据 `published` 状态区分按钮：

- 上下移动按钮始终渲染，仅通过 `disabled` 和 `title` 提示用户不可用；
- 这与后端「仅已发布模板可排序」的语义不一致，造成视觉干扰。

## 解决方案

在 `TemplateManagement.tsx` 中，将「上移 / 下移」按钮包裹在 `{tpl.published && (...)}` 条件渲染内：

- 已发布模板：正常显示上移、下移按钮；
- 草稿态模板：不渲染排序按钮，仅保留删除按钮；
- 同时去掉此前为禁用态准备的 `title` 与 `!tpl.published` 相关 `disabled` 逻辑。

## 验证结果

- `pnpm check-types` 通过；
- `pnpm build` 通过；
- `pnpm lint` 通过（历史遗留错误与本次无关）；
- `pnpm dev` 运行中，访问 `/admin/templates` 草稿态模板不再显示排序按钮。
