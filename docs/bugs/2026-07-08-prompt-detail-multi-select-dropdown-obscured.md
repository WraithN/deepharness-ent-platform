# 2026-07-08 提示词详情 MultiSelect 下拉框被遮挡

## 现象

在提示词详情弹窗中，分类选择器 `MultiSelect` 的下拉面板被弹窗底部截断，无法完整展示所有分类选项。弹窗使用 `max-h-[85vh]` 与 `overflow-hidden` 限制高度，下拉面板默认向下展开（`top-full`），其绝对定位层被父级 `overflow-hidden` 裁剪，导致用户体验较差。

## 根因

1. `MultiSelect` 组件硬编码下拉方向为向下展开，未提供向上展开的选项。
2. 提示词详情弹窗高度受限且使用 `overflow-hidden`，向下展开的面板超出可视区域后被截断。
3. 选择框和输入框样式与项目当前 shadcn/ui 风格不一致：圆角、边框、焦点环、标签样式等需要统一。

## 解决方案

1. 在 `MultiSelect` 组件中新增 `dropdownPosition?: 'top' | 'bottom'` 属性，默认仍向下展开；当传入 `dropdownPosition="top"` 时使用 `bottom-[calc(100%+8px)]` 向上展开，与触发框保持 8px 间距。
2. 在提示词详情弹窗的 `MultiSelect` 实例上显式传入 `dropdownPosition="top"`，使下拉框在分类选择器上方展开，避免被弹窗底部截断。
3. 重构 `MultiSelect` 组件样式，完全参考设计稿：
   - 触发框：`min-h-[44px]`、`rounded-lg border border-input bg-background px-3 py-2`、hover 与 focus 状态使用品牌主色边框和柔和外发光。
   - 已选项标签：`rounded-md bg-primary/10 text-primary text-xs`，带 `X` 删除按钮。
   - 下拉箭头：使用 `ChevronUp`，展开时指向下方（向上弹出）。
   - 下拉面板：`bg-popover rounded-lg border border-border py-2`，向上时距离触发框 8px；面板顶部/底部增加旋转 45° 的小三角指示器。
   - 下拉选项：`rounded-md px-3 py-2`，hover 使用 `hover:bg-muted`；选中项使用 `bg-primary/5 text-primary` 并显示 `Check` 勾选图标。
4. 重构提示词详情弹窗内部布局：
   - 标题栏使用主色图标背景块 + 标题，底部加边框分隔。
   - 内容区改为 `px-6 py-5 space-y-5` 的垂直分组，textarea 与分类选择器各自带 `label`。
   - textarea 使用 `bg-muted/30 border-input rounded-lg`，focus 态与参考稿一致。
   - 底部操作区使用 `bg-muted/30 border-t` 背景，按钮顺序：复制、关闭、保存。
5. 重构「添加提示词」弹窗（提示词市场弹窗）样式：
   - 弹窗宽度改为 `sm:max-w-[620px]`，内容区无默认 padding，由内部区域自行控制。
   - 标题栏使用 `text-xl font-semibold` + 底部分隔线。
   - 搜索框使用 `pl-9` 搜索图标、`rounded-lg`、focus 态主色边框 + 柔和阴影。
   - 分类筛选使用 shadcn/ui Select，触发器样式与搜索框统一为 `rounded-lg h-10`。
   - 提示词卡片改为 `border border-border rounded-lg p-4`，hover 时边框加深并带轻微阴影。
   - 卡片内展示：名称 + 分类 Badge、描述、使用次数（带 Download 图标）、右侧「添加」按钮。
   - 列表底部显示 `共 N 条` 统计。
   - 底部操作栏使用 `bg-muted/30 border-t`，仅保留「关闭」按钮。
6. 重构「去市场添加技能」弹窗样式：
   - 弹窗宽度改为 `sm:max-w-[680px]`，内容区无默认 padding。
   - 标题栏使用 `text-xl font-semibold` + 底部分隔线。
   - 搜索框与分类筛选触发器统一为 `rounded-lg h-10`、focus 态主色边框 + 柔和阴影。
   - 技能项改为 `label` 包装，整行可点击切换选中；每项 `p-3.5 rounded-lg border border-border`，hover 时边框加深并带轻微阴影。
   - 选中项使用 `border-primary bg-primary/5`。
   - 每项左侧为 shadcn/ui Checkbox（`h-4 w-4`），右侧展示：名称 + 分类 Badge、描述、评分（带 Star 图标）、下载次数（带 Download 图标）。
   - 分页行左侧显示 `共 N 条`，右侧为上一页/当前页/下一页按钮组。
   - 底部操作栏使用 `bg-muted/30 border-t`，左侧「取消」、右侧「添加 (N)」按钮；未选中时添加按钮为禁用态。

## 验证结果

- `pnpm --filter @repo/dh-frontend check-types` 通过，无 TypeScript 错误。
- `pnpm build` 构建全部应用成功。
- `pnpm lint` 通过，无 lint 错误。
- `go vet ./...` 在 `apps/dh-backend` 与 `apps/agent-stub` 下均无警告。
- 本地开发服务（Frontend: 8888、DH Backend: 8080）健康检查均返回 200。
