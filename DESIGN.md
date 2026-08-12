# DeepHarness Enterprise Platform — 设计规范

> 本文档是项目 UI/UX 设计的单一事实来源。所有涉及 UI 设计、样式调整、新增组件或修改界面布局的变更，**必须先阅读并严格遵循本文档**。

---

## 1. 设计哲学

- **简洁现代**：以清晰的视觉层次和充足的留白为主，避免过度装饰。
- **极光科技风**：采用深空蓝灰分层背景 + 极光蓝主色，暗色模式避免纯黑压抑，亮色模式清爽低疲劳。
- **高可读性**：正文与背景保持高对比度，代码区域使用等宽字体确保对齐。
- **一致的体验**：所有交互元素（按钮、输入框、卡片）遵循统一的圆角、阴影和动效规范。

---

## 2. 色彩系统

色彩通过 CSS 自定义属性（CSS Variables）定义于 `apps/dh-frontend/src/index.css`，并在 `tailwind.config.js` 中映射为 Tailwind 颜色键。

### 2.1 浅色主题（Light / Aurora Light）

| Token | HSL | 色值 | 用途 |
|-------|-----|------|------|
| `--background` | `210 40% 98%` | `#F8FAFC` | 页面背景（`--bg-main`） |
| `--foreground` | `217 33% 17%` | `#1E293B` | 主文字 |
| `--card` | `0 0% 100%` | `#FFFFFF` | 卡片背景 |
| `--panel` | `217 33% 17%` | `#1E293B` | 对话窗口/主面板（比背景提亮一级） |
| `--primary` | `217 91% 60%` | `#3B82F6` | 主品牌色（极光蓝） |
| `--primary-foreground` | `0 0% 100%` | `#FFFFFF` | 主色上的文字 |
| `--secondary` | `210 40% 96%` | `#F1F5F9` | 次要背景、标签 |
| `--muted` | `210 40% 96%` | `#F1F5F9` | 禁用、次要区域 |
| `--muted-foreground` | `215 16% 47%` | `#64748B` | 辅助文字、描述 |
| `--accent` | `214 100% 97%` | `#EFF6FF` | 高亮/激活态背景 |
| `--border` | `214 32% 91%` | `#E2E8F0` | 边框、分割线 |
| `--ring` | `217 91% 60%` | `#3B82F6` | 焦点环、outline |
| `--destructive` | `0 84% 60%` | `#EF4444` | 危险操作 |

**语义状态色：**
- `success` → `#10B981`（极光绿）
- `warning` → `#F59E0B`（暖橙）
- `info` → `#3B82F6`（极光蓝）

**图表色（Chart）：**
- `chart-1` → `#3B82F6`（蓝）
- `chart-2` → `#8B5CF6`（紫）
- `chart-3` → `#10B981`（绿）
- `chart-4` → `#F59E0B`（橙）
- `chart-5` → `#EF4444`（红）

### 2.2 深色主题（Dark / Aurora Dark）

深色主题采用 **Aurora 极光暗色** 配色方案，深空蓝灰分层背景，通过 `.dark` 类切换。

| Token | HSL | 色值 | 用途 |
|-------|-----|------|------|
| `--background` | `222 47% 11%` | `#0F172A` | 页面/侧边栏/顶部导航背景 |
| `--foreground` | `210 40% 96%` | `#F1F5F9` | 主文字 |
| `--card` | `216 28% 23%` | `#2A374B` | 卡片/快捷指令卡片背景 |
| `--panel` | `217 33% 17%` | `#1E293B` | 对话窗口/主面板（比背景提亮一级） |
| `--primary` | `217 91% 60%` | `#3B82F6` | 主品牌色（极光蓝） |
| `--primary-foreground` | `222 47% 11%` | `#0F172A` | 主色上的文字 |
| `--secondary` | `216 28% 23%` | `#2A374B` | 次要背景、标签 |
| `--muted` | `215 25% 27%` | `#334155` | 禁用、次要区域 |
| `--muted-foreground` | `215 20% 65%` | `#94A3B8` | 辅助文字（灰蓝） |
| `--accent` | `218 24% 32%` | `#3E4C65` | 高亮/激活态背景 |
| `--border` | `221 28% 20%` | `#242D40` | 边框、分割线（带蓝调的极弱半透明效果） |
| `--ring` | `217 91% 60%` | `#3B82F6` | 焦点环 |
| `--destructive` | `0 84% 60%` | `#EF4444` | 危险操作 |

**图表色（Dark）：**
- `chart-1` → `#3B82F6`（蓝）
- `chart-2` → `#8B5CF6`（紫）
- `chart-3` → `#10B981`（绿）
- `chart-4` → `#F59E0B`（橙）
- `chart-5` → `#EF4444`（红）

### 2.3 色彩使用原则

- **主色（Primary）**：用于主要按钮、活跃状态、关键链接、焦点环。浅色/深色均为极光蓝 `#3B82F6`，紫色 `#8B5CF6` 仅用于渐变点缀。
- **背景层级（深色）**：`#0F172A` 页面/侧边栏 → `#1E293B` 对话窗口/主面板 → `#2A374B` 卡片/快捷指令卡片 → `#334155` 悬停/次要区域，层层递进，拒绝灰蒙蒙的脏感。
- **文字层级**：主文字（`foreground`）→ 辅助文字（`muted-foreground`）→ 禁用状态（降低透明度）。
- **边框**：统一使用柔和的半透明边框，避免生硬的实色分割。
- **危险色**：统一使用珊瑚红 `#EF4444`，深浅主题保持一致。
- **渐变**：主按钮、标题等重点元素使用 `linear-gradient(90deg, #3B82F6, #8B5CF6)`。
- **阴影**：浅色使用 `rgba(15,23,42,0.08)` 系柔和阴影；深色使用 `rgba(0,0,0,0.35)` 系阴影，为对话窗口等大卡片提供浮起深度。

---

## 3. 字体系统

### 3.1 字体栈

| 场景 | 字体 | 加载方式 |
|------|------|----------|
| 正文 / UI | 系统默认 sans-serif（Tailwind `font-sans`） | 系统字体 |
| 代码 / 等宽 | **JetBrains Mono** | Google Fonts CDN |

**JetBrains Mono 字重：** 400（Regular）、500（Medium）、600（SemiBold）、700（Bold）。

### 3.2 排版规范

- 代码块、行内代码、终端输出必须使用 `JetBrains Mono`。
- 正文使用系统默认无衬线字体，确保跨平台一致性。
- 中文文案优先使用系统默认中文字体（PingFang SC、Microsoft YaHei 等）。

---

## 4. 间距与布局

### 4.1 基础单位

- 基于 Tailwind CSS 默认间距尺度（4px 基础单位）。
- **圆角体系**：
  - `radius`（全局默认）：`0.5rem`（8px）
  - `lg`：`0.5rem`
  - `md`：`calc(var(--radius) - 2px)`（6px）
  - `sm`：`calc(var(--radius) - 4px)`（4px）

### 4.2 布局容器

- **Container**：居中对齐，`padding: 2rem`，最大宽度 `1400px`（`2xl` 断点）。
- **页面最小高度**：`min-h-screen`，确保无内容时也能撑满视口。

### 4.3 常用间距模式

- 卡片内边距：`p-4` ~ `p-6`（16px ~ 24px）
- 模块间距：`gap-4` ~ `gap-6`（16px ~ 24px）
- 表单元素间距：`space-y-4`（16px）
- 侧边栏宽度：`w-64`（256px）或 `w-72`（288px）

---

## 5. 组件规范

### 5.1 组件库

- **基础组件**：shadcn/ui（New York 风格）
- **底层依赖**：Radix UI（无障碍 + 行为）+ `class-variance-authority`（变体管理）+ `tailwind-merge`（类名合并）
- **路径约定**：
  - 组件：`@/components`
  - UI 基础组件：`@/components/ui`
  - 工具函数：`@/lib/utils`

### 5.2 按钮（Button）

- **主按钮**：`bg-primary text-primary-foreground`，hover 时亮度提升。
- **次按钮**：`bg-secondary text-secondary-foreground`。
- **幽灵按钮**：`hover:bg-accent hover:text-accent-foreground`。
- **危险按钮**：`bg-destructive text-destructive-foreground`。
- 统一圆角：`rounded-md`（6px）。

### 5.3 卡片（Card）

- 背景：`bg-card`
- 文字：`text-card-foreground`
- 圆角：`rounded-lg`
- 阴影：默认无阴影或极轻微阴影，需要强调时使用 `.soft-shadow` 或 `.claude-card`

### 5.4 输入框（Input）

- 背景：`bg-background`
- 边框：`border border-input`
- 聚焦：`focus-visible:ring-2 focus-visible:ring-ring`
- 圆角：`rounded-md`

### 5.5 对话框 / 弹窗

- 遮罩：`bg-black/50 backdrop-blur-sm`
- 内容区：`bg-card rounded-lg shadow-lg`
- 动画：fade-in + scale 缩放

### 5.6 侧边栏（Sidebar）

- 背景：`bg-sidebar`
- 活跃项：`bg-sidebar-primary text-sidebar-primary-foreground`
- 宽度：默认收起/展开状态，展开时约 `16rem`（256px）

### 5.7 列表 / 表格（List Table）

数据列表页（如成员管理、成员会话轨迹）统一采用以下格式，各页面仅列定义不同：

- **卡片容器**：`soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card`，内容区 `p-6`。
- **卡片头部**（标题 + 可选搜索框/操作按钮，底部 `mb-5`）：
  - 标题：`text-xl font-semibold text-foreground`，可附带数量，如「空间成员 (12)」。
  - 副标题：`text-muted-foreground mt-1`。
  - 搜索框：`w-80 pl-10 bg-muted/30 rounded-lg`，搜索图标 `absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground`。
- **表格包裹层**：`overflow-x-auto rounded-lg border border-border/50`，表格本体 `min-w-max text-[15px]`。
- **表头行**：`bg-muted/30`，行 `hover:bg-transparent`；表头单元格 `px-4 py-4 font-medium text-muted-foreground`。
- **数据行**：`transition-colors hover:bg-primary/5`（浅色为淡蓝底纹）；单元格 `px-4 py-5`；长文本列加 `whitespace-nowrap`。
- **头像**：`rounded-full bg-primary/15 text-primary` 首字母头像，列表行内用 `h-6 w-6 text-xs`，信息密度低的场景（如成员信息列）用 `h-10 w-10`；无头像的资源行（技能、智能体）用同规格圆形图标底 `rounded-full bg-primary/15` + `text-primary` 图标（行内 `h-8 w-8` + `h-4 w-4` 图标）。
- **筛选条**（可选，位于头部与表格之间）：`flex flex-wrap gap-2 items-center mb-4`，前缀标签 `text-sm text-muted-foreground`。
  - 通用列表筛选：筛选项为 `h-8` 的 `secondary`（选中）/`ghost`（未选中）按钮。
  - 技能/提示词市场的分类筛选：筛选项为 `rounded-full h-8 px-4 whitespace-nowrap` 的 `default`（选中）/`outline`（未选中）药丸按钮，与空间管理中的技能/提示词市场保持一致。
- **状态/角色徽章**：`rounded-lg px-3 py-1.5 font-medium`；肯定态（如“是”）`bg-primary text-primary-foreground`，否定态 `variant="outline"`；语义分类徽章（角色、会话类型）保留语义色并带 `dark:` 变体。
- **时间列**：`text-muted-foreground`，配 `Clock` 图标（`w-3 h-3`）。
- **行操作**：`variant="ghost" size="icon"` + `MoreHorizontal` 图标，`hover:bg-primary/10 hover:text-primary rounded-md`，菜单展开时保持 `data-[state=open]:bg-primary/10 data-[state=open]:text-primary`；下拉菜单容器采用极光玻璃质感：`bg-popover/95 backdrop-blur-xl border-border/50 rounded-lg shadow-lg`；菜单项统一为图标+文字，高度 32px、`rounded-md`，普通项 `text-secondary-foreground` + `focus:bg-primary/10 focus:text-primary`，危险项（删除等）使用 `text-destructive focus:bg-destructive/10 focus:text-destructive`，并与普通项用 `DropdownMenuSeparator` 分隔。
- **底部分页**：`mt-5 flex flex-wrap justify-between items-center gap-3 text-sm`；左侧「共 N 条记录，第 X/Y 页」`text-muted-foreground`；右侧页码按钮 `h-9 min-w-9 px-3 text-sm rounded-md`，当前页 `variant="default"`，其余 `variant="outline"`。
- **空状态**：单行 `colSpan` 全宽，`text-center py-8 text-muted-foreground`。

### 5.8 看板（Kanban）

需求/缺陷/用例看板统一采用以下格式（产品空间看板、智能会话看板一致）：

- **布局**：三列状态看板使用 `grid grid-cols-1 md:grid-cols-3 gap-5`；五列需求看板使用 `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5`；智能会话抽屉使用 `flex gap-3` 横向滚动，列宽 `w-56 shrink-0`。
- **状态体系统一**：需求看板固定五个状态——待处理、进行中、已完成、已取消、已挂起；前后端状态值映射为 `todo` / `in_progress` / `done` / `cancelled` / `on_hold`（历史 `backlog` 并入 `todo`）。
- **列头**：`flex items-center justify-between px-4 py-3 mb-4 rounded-xl`，pastel 背景按状态着色（待处理=蓝 `bg-blue-100/70`、进行中=琥珀 `bg-amber-100/70`、已完成=绿 `bg-green-100/70`、已取消=锌灰 `bg-zinc-100/70`、已挂起=橙 `bg-orange-100/70`，均带 `dark:` 变体）。
  - 标题：`text-lg font-semibold`，与列头同色（如 `text-blue-700 dark:text-blue-300`；已取消=`text-zinc-600 dark:text-zinc-300`）；紧凑场景用 `text-sm`。
  - 计数：实心圆形 `h-7 w-7 rounded-full grid place-items-center text-sm font-bold text-white`，背景为状态实色（`bg-blue-600` / `bg-amber-500` / `bg-green-500` / `bg-zinc-500` / `bg-orange-500`）；紧凑场景用 `h-6 w-6 text-xs`。
- **任务卡片**：`relative bg-card border border-border/50 rounded-xl pl-5 pr-4 py-4 transition-all duration-200`，hover 时上浮 `-translate-y-1` + `shadow-lg`（dark 下 `shadow-black/30`）。
  - **优先级条**：卡片左侧 `absolute left-0 top-0 h-full w-1 rounded-l-xl`，按优先级着色（高=`bg-red-500`、中=`bg-amber-500`、低=`bg-blue-500`）；缺陷卡片按严重度（critical/high/medium/low）同色映射。
  - **标题**：`text-base font-medium leading-snug line-clamp-2`，右侧配优先级胶囊 `px-2 py-0.5 rounded-full text-xs font-semibold`（高=红、中=琥珀、低=蓝 pastel 配色）。
  - **元信息**：负责人 `text-sm text-muted-foreground`；日期 `text-xs text-muted-foreground/80` + `CalendarDays` 图标（`h-3 w-3`）。
  - **完成态**（已完成/已取消列，及缺陷的已关闭、用例的通过）：卡片 `opacity-75`，标题 `line-through text-muted-foreground`。
  - **拖拽态**（可拖拽看板）：`opacity-50 border-primary`，`active:cursor-grabbing`。
- **空列占位**：`border border-dashed border-border/40 rounded-xl` + 居中提示文字。

### 5.9 Aurora 统一标签栏体系

B 端设置页遵循「导航 Tab 全部左对齐，与内容区左侧基准线对齐」的阅读动线；居中仅用于空状态、弹窗按钮等少量场景。标签栏按使用场景分为三级，避免层级权重错配。

| 层级 | 定位 | 对齐方式 | 容器 | 选项 | 选中态 |
|------|------|----------|------|------|--------|
| 一级 Tab | 页面级导航（基础配置 / 研发规范等） | 左对齐，与下方卡片同宽 | `aurora-tab-bar level-1`，高度 44px，全宽 | `aurora-tab-item level-1`，高度 32px，14px 文字 | 蓝紫渐变实底 + 白色文字 |
| 二级 Tab | 卡片内分类（编码规范 / 设计规范） | 左对齐，与卡片内容同边距 | `aurora-tab-bar level-2`，高度 36px | `aurora-tab-item level-2`，高度 28px，13px 文字 | 蓝紫渐变实底 + 白色文字 |
| 三级 Tab | 编辑器内切换（可视化 / Markdown / 预览） | 左对齐，紧贴工具栏 | `aurora-tab-bar level-3`，高度 42px，透明底、无圆角、无阴影 | `aurora-tab-item level-3`，13px 文字，间距 24px | 品牌色文字 + 蓝紫渐变下划线 |

**一/二级容器规范**：
- `bg-panel/80 backdrop-blur-xl` 磨砂玻璃底
- `border-border/30` 弱边框
- 默认 `!justify-start`，所有胶囊栏左对齐
- 一级栏额外使用 `w-full`，与下方内容区同宽
- 亮色内阴影 `inset 0 1px 0 rgba(255,255,255,0.9)`，暗色 `inset 0 1px 0 rgba(255,255,255,0.04)`
- 圆角 `rounded-xl`（12px）

**一/二级选项规范**：
- 未选中：`text-secondary-foreground`（一级）/ `text-muted-foreground`（二级）
- Hover：`bg-muted`（亮色）/ `bg-card/80` 或 `bg-card/60`（暗色），文字提亮
- 选中：`background: linear-gradient(90deg, #3B82F6, #8B5CF6)`，`text-white`，`shadow-[0_0_12px_rgba(59,130,246,0.25)]`
- 统一过渡 `transition-all duration-200`

**三级（编辑器内）规范**：
- 容器：透明底、无圆角、无阴影、`border-0`，`gap-6`（24px），高度 42px，与编辑器顶部工具栏同背景/边距
- 选项：`text-[13px] text-muted-foreground`，hover 时 `text-secondary-foreground`
- 选中：`text-primary font-medium`，底部 `h-0.5` 蓝紫渐变下划线（`var(--gradient-primary)`），位置 `bottom-0`
- 不撑满全宽，紧跟左侧工具栏

**辅助元素**：
- 分隔线：`.aurora-tab-divider`（`w-px h-5 bg-border/50`）
- 标签徽章：`.aurora-tab-badge`（`bg-primary/20 text-primary`，11px 圆角）
- 图标按钮：`.aurora-tab-icon-btn`（`h-8 w-8 rounded-lg`，hover 背景提亮）
- 与 shadcn Select 结合时，使用 `.aurora-tab-select-trigger` 重置默认边框/背景/阴影，再叠加 `.aurora-tab-item.level-1`

**应用示例**：
- `Settings`：一级（基础/智能体/技能/提示词/规范/CICD/成员）、二级（研发规范内编码/设计规范）、三级（MarkdownEditor 内可视化/Markdown/预览）。
- `AdminDashboard`：一级（平台概览/技能大盘/提示词大盘）、二级（各卡片内图表趋势/分布切换）。
- `AdminPage`：一级（智能体/规范/CICD 配置）、二级（规范设置内编码/设计规范）。
- `ProjectCode`：仓库/分支/刷新栏使用一级样式；代码/图谱/评审/文档/预览/仓库详情使用二级样式。
- `RepoStandardsDialog`：工程规范/设计规范使用二级样式（弹窗内内容切换）。
- `Chat`：工作项类型（需求/缺陷/用例）与阶段筛选使用二级样式（抽屉/面板内视图切换）。

---

## 6. 图标系统

- **图标库**：`lucide-react`
- **使用规范**：
  - 导航图标：20px（`size={20}` 或默认）
  - 按钮内图标：16px（`size={16}`）
  - 状态/装饰图标：根据上下文灵活调整
- **图标颜色**：默认继承当前文字颜色（`currentColor`），活跃状态使用 `primary`。

---

## 7. 阴影与特效

### 7.1 预设阴影

| 类名 | 效果 |
|------|------|
| `.soft-shadow` | 柔和弥散阴影，暗色模式下增强深度 |
| `.shadow-card` | 卡片标准阴影（通过 CSS 变量 `--shadow-card`） |
| `.shadow-hover` | Hover 状态增强阴影（通过 CSS 变量 `--shadow-hover`） |

### 7.2 自定义特效

| 类名 | 效果 | 适用场景 |
|------|------|----------|
| `.glass-panel` | 毛玻璃 + 半透明边框 + 阴影 | 浮层面板、模态框、主内容区 |
| `.glass-card` | 基于 `--card` 的半透明毛玻璃 + 高光内阴影 | 内容卡片、功能区块 |
| `.click-card` | 在 `.glass-card`/`.glass-panel` 上叠加 Hover 上浮、边框发光、点击缩放 | 可点击卡片、菜单项 |
| `.input-glow` | 聚焦时边框变品牌色并产生柔和光晕 | 输入框、文本域 |
| `.claude-card` | 顶部亮底部暗的渐变背景 + 微妙边框 | 旧版内容卡片（逐步迁移至 `.glass-card`） |
| `.tech-border` | 淡色边框 + 外发光 + 内阴影 | 代码块、技术展示区域 |

**暗色模式适配**：以上特效均提供 `.dark` 变体，确保在 Dracula 主题下保持视觉层次。

---

## 8. 动画与过渡

### 8.1 预设动画

| 动画名 | 效果 | 时长 | 缓动 |
|--------|------|------|------|
| `fade-in` | 透明度 0→1 + 下移 10px→0 | 0.5s | `ease-out` |
| `slide-in` | 透明度 0→1 + 左移 20px→0 | 0.5s | `ease-out` |
| `accordion-down` | 高度 0 → 内容高度 | 0.2s | `ease-out` |
| `accordion-up` | 内容高度 → 0 | 0.2s | `ease-out` |

### 8.2 交互过渡（Aurora 动效规范）

- **全局缓动**：所有交互元素统一使用 `cubic-bezier(0.4, 0, 0.2, 1)`，通过 Tailwind 自定义 `ease-smooth` 与 `duration-250` 应用。
- **按钮**：`transition-all duration-250 ease-smooth`；Hover 时 `-translate-y-px` + `shadow-glow`；点击时 `scale-[0.98]`（主按钮 `0.97`）。
- **可点击卡片**：使用 `.click-card`；Hover 时 `translateY(-1px)` + 边框变为 `primary/40` + `shadow-glow`；点击时 `scale(0.98)`。
- **输入框**：使用 `.input-glow`；聚焦时边框变为 `primary`，并产生 `0 0 0 3px primary/15` 的柔和发光。
- **焦点状态**：`focus-visible:ring-2 ring-ring/50`，确保键盘导航可见性。
- **页面切换**：建议使用 `fade-in` 或 `slide-in` 营造流畅感

---

## 9. 滚动条

- **宽度**：`6px`（细滚动条）
- **轨道**：透明背景
- **滑块**：`hsl(var(--border))` 颜色，`3px` 圆角
- **全局生效**：应用于所有可滚动容器

```css
* {
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--border)) transparent;
}
```

---

## 10. 主题切换

- **切换方式**：`next-themes`，使用 `class` 策略。
- **默认主题**：跟随系统（`system`）。
- **切换触发**：在 DOM 根元素上添加/移除 `.dark` 类。
- **图标映射**：
  - 浅色模式：`<Sun />`
  - 深色模式：`<Moon />`

---

## 11. 页面布局模式

### 11.1 登录页

- **布局**：左右分栏（`flex`），左侧品牌区（占满剩余空间），右侧登录表单（固定宽度或比例）。
- **左侧**：深色/渐变背景 + 品牌 Logo + 轮播标语（自动切换，5秒间隔）。
- **右侧**：白色/卡片背景 + 登录表单 + 底部辅助链接。

### 11.2 主应用布局（租户工作空间）

- **整体**：左侧固定侧边栏 + 右侧主内容区。
- **侧边栏**：顶部 Logo + 主导航（图标 + 文字）+ 底部用户信息。
- **顶部栏**：面包屑/标题 + 全局操作（主题切换、通知、用户菜单）。
- **内容区**：滚动区域，内部按功能模块划分卡片/表格/表单。

### 11.3 超级管理员后台

- **布局**：与主应用类似，但导航项变为管理员专用（数据大盘、租户管理、技能管理、提示词管理、模板管理）。

---

## 12. 响应式断点

| 断点 | 宽度 | 用途 |
|------|------|------|
| `sm` | 640px | 小屏手机 |
| `md` | 768px | 平板竖屏 |
| `lg` | 1024px | 平板横屏 / 小笔记本 |
| `xl` | 1280px | 标准桌面 |
| `2xl` | 1400px | 大屏桌面（Container 最大宽度） |

---

## 13. 文件结构

```
apps/dh-frontend/src/
├── index.css           # 主题变量 + 自定义工具类 + 滚动条
├── main.tsx            # 应用入口
├── App.tsx             # 根组件（Router + Toaster）
├── routes.tsx          # 路由定义
├── components/
│   ├── ui/             # shadcn/ui 基础组件（~50个）
│   ├── common/         # IntersectObserver, PageMeta
│   └── layout.tsx      # 主布局（侧边栏 + 顶部栏）
├── pages/              # 页面级组件
├── hooks/              # 自定义 Hooks
├── lib/
│   └── utils.ts        # cn(), formatDate(), createQueryString()
└── mock/data.ts        # Mock 数据
```

---

## 14. 弹窗设计规范

所有模态弹窗必须基于共享组件实现（`ui/dialog`、`ui/alert-dialog`、`ui/sheet`、`ui/sonner`），**禁止手写 `fixed inset-0` + 居中卡片的自实现模态**。弹窗容器为**实色不透明**（不使用半透明/毛玻璃），保证任何背景下内容清晰可读。

### 14.1 组件选型

| 场景 | 组件 | 说明 |
|------|------|------|
| 操作确认（删除/作废/跳转/切换等需显式确认） | `AlertDialog` | 无右上角 X，必须通过底部按钮作出选择 |
| 表单、详情、预览等复杂内容 | `Dialog` | 带右上角 X，可点遮罩/Esc 关闭 |
| 侧滑详情、评论面板 | `Sheet` | `side="right"` 详情、`side="bottom"` 评论 |
| 轻量结果反馈（成功/失败/警告） | `toast`（sonner） | 不阻断流程，禁止用弹窗做结果提示 |

### 14.2 遮罩与容器

- 遮罩层：`bg-[rgba(15,23,42,0.08)]`（亮色浅调、无模糊；暗色模式 `dark:bg-black/80`）。
- 弹窗盒（**实色不透明**，禁止 `bg-white/xx` 半透明与 `backdrop-blur`）：
  - 背景 `bg-white`（暗色 `dark:bg-[#1E293B]`）
  - 边框 `border-[rgba(148,163,184,0.18)]`（暗色 `dark:border-[rgba(148,163,184,0.15)]`）
  - 阴影 `shadow-[0_10px_32px_rgba(15,23,42,0.12)]`（暗色 `dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)]`）
  - 圆角 `rounded-2xl`（16px，移动端同样保持圆角）
- 关闭按钮（X）：`absolute right-4 top-4 rounded-lg p-1.5`，`text-muted-foreground`，`hover:bg-muted hover:text-foreground`。
- 进出动画：fade + zoom/slide，`duration-200` 以内，不使用弹性/回弹动效。

### 14.3 标准结构

- **常规弹窗**：`DialogHeader`（`DialogTitle` `text-lg font-semibold` + `DialogDescription` `text-sm text-muted-foreground`）→ 内容区 → `DialogFooter`（`sm:justify-end sm:space-x-2`）。
- **大弹窗/详情弹窗**（`p-0` 自定义结构）：头部 `px-6 py-4 border-b`（图标 + 标题 + 关闭/操作）→ 内容区 `px-6 py-4 overflow-y-auto` → 底部 `px-6 py-3.5 border-t bg-muted/30`。
- Footer 按钮一律右对齐（`justify-end`），顺序为「取消在左、主按钮在右」；禁止使用 `justify-between` 拆分主操作。

### 14.4 宽度分级

| 类型 | 宽度 | 移动端保护 |
|------|------|-----------|
| 确认/极简表单 | `sm:max-w-md` | `max-w-[calc(100%-2rem)]` |
| 标准表单 | `sm:max-w-lg` | 同上 |
| 复杂表单/中等详情 | `sm:max-w-2xl` | — |
| 大详情/预览 | `max-w-[760px]`（内容复杂时 `max-w-3xl`/`max-w-4xl`）+ `max-h-[85vh]` | — |

- 新增弹窗按上表就近取档，禁止发明新的任意宽度值（如 `max-w-[440px]`、`max-w-[680px]`）。
- `Dialog` 默认宽度 `max-w-[760px]` 面向大详情场景，表单/确认类必须显式覆写宽度。

### 14.5 底部按钮

- 取消按钮：`variant="outline"`（`bg-muted`、`text-muted-foreground`、`hover:bg-border`、`hover:text-foreground`）。
- 主按钮：`variant="default"` 蓝紫渐变 + hover 发光 + active 缩放。
- **危险按钮（删除/作废/驳回/退出等不可逆操作）**：`variant="destructive"`；在 `AlertDialogAction` 等不支持 variant 的组件上，统一写 `className="bg-destructive text-destructive-foreground hover:bg-destructive/90"`，三个类缺一不可。

### 14.6 危险操作确认

- 不可逆操作一律使用 `AlertDialog`，标题为「确认 + 动词」（如「确认删除」），描述说明影响与不可撤销性，主按钮为 destructive 危险按钮并重复动作词（如「删除」）。
- 可逆的跳转/切换类确认使用默认主按钮（渐变蓝），不使用 destructive。

### 14.7 抽屉（Sheet）

- 右侧详情抽屉：`side="right"`，`w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl p-0`；底部评论抽屉：`side="bottom"`，`h-[60vh] p-0`。
- 抽屉与弹窗共用 14.2 的遮罩规范；页面级局部抽屉（如图画布节点详情）可使用 `absolute inset-0` 手写实现，但遮罩色与面板样式须与 Sheet 一致。
- `ui/drawer`（vaul）为未启用组件，新增需求一律使用 `Sheet`。

### 14.8 Toast 轻提示

- 统一 `import { toast } from 'sonner'`，挂载点为 `App.tsx` 的 `<Toaster />`（跟随 next-themes，样式定制见 `ui/sonner.tsx`）。
- 位置默认 bottom-right；`toast.success` 成功、`toast.error` 失败、`toast.warning` 警告，文案以动词开头、一句话说清结果，不堆砌技术错误堆栈。

### 14.9 表单控件

- 输入框：`bg-background`（`#F8FAFC`）底，`border-input`（`#E2E8F0`）边框；focus 时背景变白、边框变为品牌蓝并产生 `0 0 0 3px primary/15` 光晕。
- 下拉框：与输入框保持一致的浅色底和焦点态，右侧箭头弱化（`opacity-50`）。

### 14.10 现状偏差与整改记录

2026-08-11 首轮排查发现的 7 类偏差**已全部整改完成**：

1. 危险按钮误用主按钮：删除仓库（`Settings.tsx`）、作废文档（`FileView.tsx`、`InlineFilePreview.tsx`）已改 destructive；`Settings.tsx` 删除分类/成员两处补齐 `text-destructive-foreground`。
2. 确认弹窗选型分裂：退出登录（`Layout.tsx`/`AdminLayout.tsx`）、删除租户（`AdminPage.tsx`）已统一为 `AlertDialog`；`NotificationCenter.tsx` 驳回原因弹窗含 Textarea 表单项，按 14.1 规范属于表单弹窗，保留 `Dialog` 为正确选型。
3. 基础组件已对齐：`ui/dialog.tsx` 遮罩与容器改为毛玻璃规范；`ui/sheet.tsx` 遮罩统一。
4. 宽度已收敛：任意值（425/440/480/500/620/680/800px）全部归入 14.4 四档；`Settings.tsx` 仓库设置弹窗补 `sm:max-w-md`。
5. 圆角已统一：`AlertDialog` 全端 `rounded-2xl`；`Sheet` 按方向补圆角。
6. `PersonalAssistantPage.tsx` 动态 Tailwind 类名 Bug 已修复（改为完整字面量条件类名）。
7. `KanbanWorkspace.tsx` Footer `justify-between` 已改为右对齐。

新增弹窗须对照本章自查；发现新的偏差时补充到本节。

---

## 15. IDE / 代码编辑器规范（暗色/亮色自适应）

代码编辑器采用与普通后台**相反**的分层逻辑：核心编辑区最深，周围容器稍亮，形成「编辑区凹陷、面板环绕浮起」的专业 IDE 空间感。

- **暗色模式**：使用深空蓝灰分层（`#0F172A` / `#1E293B` / `#2A374B` / `#334155`），配合 `auroraDark` 语法高亮。
- **亮色模式**：使用主题变量（`bg-background` 代码区、`bg-panel` 容器、`bg-accent` 高亮），配合 `vs` 浅色语法高亮。
- 所有硬编码色值已替换为 CSS 变量，确保切换主题时无需额外维护两套代码。

### 15.1 分层色值

| 层级 | 区域 | 色值 | 说明 |
|------|------|------|------|
| L0 最深 | 代码编辑区 | `#0F172A` | 纯深空蓝底，护眼，突出代码 |
| L1 次深 | 资源管理器、标签栏、顶部模式栏、面包屑 | `#1E293B` | 容器层，与编辑区拉开色差 |
| L2 高亮 | 选中文件、激活标签、悬停行 | `#2A374B` | 交互态提亮 |
| L3 交互 | 搜索框、按钮 | `#334155` | 可点击元素再提亮一级 |

### 15.2 边框与分割线

- 编辑器内部所有分割线统一使用 `rgba(148, 163, 184, 0.15)`，避免中性灰在深底上发雾发脏。
- 外层编辑器容器使用 `1px solid rgba(148, 163, 184, 0.15)` + `rounded-xl`。

### 15.3 焦点态

- **左侧选中文件**：`bg-[#2A374B] text-[#F1F5F9] border-l-2 border-primary`。
- **顶部激活标签**：`bg-[#0F172A] text-[#F1F5F9] border-b-2 border-primary`，背景与代码区连通。
- **模式切换按钮组**：容器 `bg-[#1E293B]`，选中项 `bg-[#0F172A]` + 底部品牌色边框。

### 15.4 代码高亮（Aurora 语法 Token）

| Token | 色值 | 用途 |
|-------|------|------|
| 关键字 | `#3B82F6` | `interface` / `const` / `export` 等 |
| 函数名 | `#8B5CF6` | 函数调用与定义 |
| 字符串 | `#10B981` | 字符串字面量 |
| 类型/类名 | `#F59E0B` | 类型、接口名 |
| 数字/布尔 | `#F97316` | 数字、布尔值 |
| 注释 | `#64748B` | 注释，弱化不干扰 |
| 普通变量/文本 | `#F1F5F9` | 主体文字 |
| 行号 | `#475569` | 深度弱化 |

实现位于 `CodeBlock.tsx` 的 `auroraDark` Prism 主题，编辑器模式通过 `variant="editor"` 启用无边框圆角、L0/L1 分层背景与顶部内阴影凹陷效果。

### 15.5 动效

- 可点击文件行、标签、按钮统一使用 `transition-all duration-150` / `duration-200`。
- 悬停状态从 `text-[#94A3B8]` 过渡到 `bg-[#2A374B] text-[#F1F5F9]`。

---

## 16. 变更记录

| 日期 | 变更内容 | 作者 |
|------|----------|------|
| 2026-06-05 | 初始设计规范，基于当前项目风格提取 | Agent |
| 2026-07-13 | 新增 5.7 列表/表格统一格式规范；成员管理、成员会话轨迹列表按该规范重构 | Agent |
| 2026-07-13 | 新增 5.8 看板统一格式规范；产品空间需求看板与智能会话看板按彩色任务看板设计重构 | Agent |
| 2026-07-13 | 统一需求状态为五态（待处理/进行中/已完成/已取消/已挂起）并固定配色，两个看板及需求分析页同步 | Agent |
| 2026-07-13 | 产品空间文档模块增强：目录树支持 chevron 展开/收起与目录搜索；MarkdownEditor 新增富文本工具栏（`h-7 w-7` 图标按钮，hover `bg-muted`，与目录行快捷按钮风格一致）；文档行「更多」菜单新增版本历史入口，弹窗采用左版本列表（w-56 卡片列表，选中 `border-primary/30 shadow-sm`）+ 右 Markdown 预览布局 | Agent |
| 2026-07-13 | 文档编辑器重构为三模式（可视化编辑/Markdown/预览）：引入 WangEditor 富文本（内容仍以 Markdown 存储，经 remark-html/turndown 双向转换）；模式标签为 `bg-muted/60 p-1 rounded-lg` 药丸组（选中 `bg-background text-primary shadow-sm`）；新增「常用模板」下拉（PRD/会议纪要/周报/Bug反馈单）与底部状态栏（字数统计 + 最近保存时间，`text-xs text-muted-foreground border-t`） | Agent |
| 2026-07-13 | 文档分享功能：已发布文档可生成免登录短链 `/s/:token`；分享落地页为居中卡片（`max-w-3xl`、`bg-background rounded-xl border soft-shadow p-8`），头部文档图标+标题+版本号；文档行⋮菜单按状态显示发布（仅草稿）/分享（仅已发布）/删除，详情工具栏发布与分享按钮同样按状态显示 | Agent |
| 2026-07-13 | 原型预览视口预设扩充为 16 档分组设备尺寸（常用/桌面/平板/手机，Select 分组标签展示）：桌面 1920×1080~1280×800 四档，平板 iPad 各代竖屏 1024×1366/834×1194/820×1180/768×1024 + 横屏 1024×768，手机 430×932/414×896/390×844/375×812/360×800/320×568；固定视口高度改为取预设真实设备视口高（原统一 16:10 推导废弃），触发器加宽至 `w-[170px]` | Agent |
| 2026-07-13 | 分页器统一：新增共享组件 `RecordPaginationBar`（左侧「共 N 条记录，第 X/Y 页」+ 右侧 上一页/页码/下一页，`h-9` 按钮组，始终展示），会话轨迹/技能市场/提示词市场/技能配置/提示词配置/代码仓库/成员管理七处分页统一为该样式；成员管理新增客户端分页（每页 10 条） | Agent |
| 2026-07-13 | 成员管理权限模型落地：成员列表对所有空间成员可见；空间管理员可添加/删除普通成员；租户管理员（含超级管理员）额外可任免空间管理员（添加弹窗「同时设置为空间管理员」勾选框与行菜单「设为/取消空间管理员」仅租户管理员可见） | Agent |
| 2026-07-13 | 提示词体系增强：①提示词市场弹窗改为多选批量添加（复选框行选中态 `border-primary bg-primary/5`，底部「添加 (n)」批量按钮带 loading 防抖）；②空间提示词卡片新增「市场」来源徽标（`Badge secondary`）、创建人（UserCircle 图标 + `text-[10px] text-muted-foreground`）、分享审核状态徽标（审核中 amber/已上架 green/已拒绝 destructive/已下架 muted 边框色），市场来源卡片提供「复制为副本」按钮（`h-7 text-xs` outline），自定义未分享卡片提供「分享到市场」按钮；③提示词详情弹窗按来源区分：市场来源只读并附锁定提示文案，自定义提示词名称/描述/内容可编辑，保存按钮统一提交内容与分类变更；④提示词市场卡片使用次数改为整数展示（`toLocaleString()`，废弃 k 缩写），新增创建人展示，「添加到空间」按钮增加 loading 防抖 | Agent |
| 2026-07-14 | 提示词市场「复制」按钮接入复制计数（同一用户同一提示词每天只计一次）并新增 5 秒冷却防抖：点击后按钮禁用，冷却结束自动恢复可用态 | Agent |
| 2026-07-14 | 空间设置市场来源提示词完全只读：详情弹窗名称/描述/内容/分类控件全部灰化禁用（MultiSelect 新增 disabled 态：半透明、隐藏移除按钮），保存按钮保留但禁用，附锁定提示与「复制为副本」入口；服务端同步拒绝市场来源提示词的分类与内容修改 | Agent |
| 2026-07-14 | 超级管理员后台技能管理/提示词管理分页器统一为 `RecordPaginationBar`（左「共 N 条记录，第 X/Y 页」+ 右 上一页/页码/下一页），与空间管理各列表分页器一致 | Agent |
| 2026-07-14 | 空间设置研发规范/设计规范由纯 Textarea 升级为 `MarkdownEditor`（可视化编辑/Markdown/预览三模式 + 工具栏），「常用模板」菜单新增模板注入能力（`templates` prop，默认产品文档模板）；新增 `standard-templates.ts`：研发规范模板 5 套（通用/前端/后端/Git 提交与分支/代码评审）、设计规范模板 4 套（UI 视觉/交互/移动端/设计走查清单），内容参考阿里开发手册、Conventional Commits、Design Token、WCAG 等行业通行实践 | Agent |
| 2026-07-14 | 空间设置研发规范/设计规范新增「智能生成」入口：编辑器右上方 `outline sm` 按钮（Sparkles 图标），弹窗含多行描述输入（2000 字上限 + 字数计数 `text-xs text-muted-foreground`）与生成按钮（loading 态 `Loader2` 旋转 + 「生成中...」）；生成成功后内容回填 MarkdownEditor（不自动落库，提示用户确认后保存）；agent 运行时不可用时 toast 友好提示「智能生成服务暂不可用」 | Agent |
| 2026-07-14 | 仓库规范配置弹窗重构：①工程规范（AGENTS.md）/设计规范（DESIGN.md）由假 Textarea 升级为 `MarkdownEditor`（可视化/Markdown/预览三模式 + 「常用模板」）；②新增「智能检测/智能生成」按钮（`outline sm` + Sparkles 图标，loading 态「检测中...」），已有规范文件时文案为「智能生成」；③未克隆仓库时弹窗内 amber 提示条（`border-amber-200 bg-amber-50 text-amber-700`）+ 编辑区灰化禁用（`opacity-50 pointer-events-none`），仅智能检测可用；④未检测到前端代码时设计规范 Tab 禁用并附 title 说明；⑤保存按钮改为「保存并提交」（落盘 + git commit 回仓库） | Agent |
| 2026-07-14 | 仓库规范弹窗未配置仓库友好态：新增未保存/未填地址的仓库行点击「设置规范」不再弹 toast，弹窗内居中展示空态（`AlertCircle h-8 text-muted-foreground/50` + 「需要先配置 Git 仓库」引导文案）；加载失败同样内联展示原因 | Agent |
| 2026-07-14 | 空间设置需求管理平台下拉框改为配置驱动：选项读取后端 config.yaml `workitem.platforms`（新接口 `GET /api/v1/workitem-platforms`，返回 key/name/needsProjectId/projectIdPlaceholder），不再硬编码 Meego/Jira/PingCode；项目 ID 输入框按平台 `needsProjectId` 展示并带平台专属占位提示（Jira 提示项目 Key）；接口失败回退内置三平台列表 | Agent |
| 2026-07-14 | 超管后台列表统一为 5.7 规范：技能管理/提示词管理/租户管理/全局配置-智能体范围配置四个列表全部改为 5.7 格式（`rounded-xl border-border/50` 卡片 + `text-xl` 标题附数量 + 副标题 + `w-80 pl-10` 搜索框，`overflow-x-auto rounded-lg border` 表格包裹层，`bg-muted/30` 表头 + `hover:bg-primary/5` 数据行 + `px-4 py-5` 单元格，徽章 `rounded-lg px-3 py-1.5` 带 dark 变体，`ghost size=icon` 行操作 + `RecordPaginationBar`）；租户列表新增客户端分页（每页 10 条）；5.7 规范补充图标头像变体、筛选条与行内操作变体说明 | Agent |
| 2026-07-14 | 超管技能/提示词管理操作与分类升级：①行操作统一为 MoreHorizontal 下拉菜单（ghost size=icon）：技能含 查看/按状态审核操作（审核中=审核通过+拒绝、已上架=下架、已下架/已拒绝=上架）/删除（destructive），提示词含 查看/审核操作；②分类列改为行内 MultiSelect 直接编辑（共享组件 `CategoryMultiCell`，`w-[200px]`，变更即保存，saving 禁用 + 失败回滚），技能与提示词均升级为多分类（链接表 team_skill_category_links / team_prompt_category_links）；③技能列表 Switch 改为状态徽章（共享 `StatusBadge`：已上架绿/审核中琥珀/已下架灰 outline/已拒绝红，均带 dark 变体，与提示词列表配色一致）；④新增只读详情弹窗（技能：描述/分类/标签/阶段/下载/评分/状态；提示词：描述/内容只读/分类/场景/状态/使用次数/创建人，label `text-muted-foreground w-20`，内容区 `bg-muted/30 rounded-lg p-3`） | Agent |
| 2026-07-14 | 超管列表多分类单元格改为折叠态：默认只展示第一个分类标签（`bg-primary/10 text-primary rounded-md`，`max-w-[120px] truncate`）+ 溢出计数徽标（`+N`，`bg-muted text-muted-foreground`），整行保持单行高度（`min-h-[36px]`）；点击单元格展开为完整 MultiSelect 编辑，点击外部自动收起；空态显示「选择分类...」占位 | Agent |
| 2026-07-14 | 智能会话输入框「文档」引用按钮（含 @ 文档内联提及）改为仅产品职能（subRole=pm）可见：文档是产品空间的产物，研发/测试/设计角色工具栏不再展示文档按钮，@ 输入也不再触发文档菜单；无子角色（管理员等）沿用产品默认视图，与欢迎卡片回退逻辑一致 | Agent |
| 2026-07-14 | 智能会话斜杠指令改为原子文本块：选中后输入框渲染为紫色高亮块（`bg-violet-500/10 text-violet-600 dark:text-violet-400` + 阴影），光标定位到块尾；Backspace/Delete 在块内部或边界时整体移除该指令块；复用 @文档提及 的 `findAtomicRange` 与叠层高亮对齐方案，指令 token 尾随空格保证前缀匹配安全 | Agent |
| 2026-07-14 | 全局主题替换为 Aurora 极光配色：浅色改为蓝灰清爽主题，深色改为深空蓝灰分层主题；主品牌色统一为极光蓝 `#3B82F6`，紫色仅用于渐变；同步更新 CodeBlock、Diff、Dashboard 图表、ProjectCode 架构图等组件硬编码颜色 | Agent |
| 2026-07-14 | 深色主题精修：页面/侧边栏/顶部统一为 `#0F172A`，对话窗口使用 `#1E293B` 面板色并加大阴影，边框统一为带蓝调弱半透明 `#242D40`，顶部标题栏去掉毛玻璃补丁，快捷指令卡片 hover 增加蓝色发光 | Agent |
| 2026-07-13 | 超管后台移除「全局配置」入口，新增「模板管理」独立页面：集中管理需求规范/设计规范/研发规范三类平台级模板池，模板数据持久化在 `localStorage`，空间设置、仓库规范弹窗与 MarkdownEditor 默认「常用模板」均从统一 `template-store` 读取；原 `/admin/config` 下的规范/CICD/智能体范围配置 tab 全部下线，智能体启用策略下沉到租户管理的 `AgentPolicyForm` | Agent |
| 2026-07-13 | Aurora 极光质感与动效规范落地：Button/Input/Textarea/Select/Dialog/AlertDialog/Card 统一使用 `transition-all duration-250 ease-smooth`、Hover 上浮 + `shadow-glow`、点击缩放；新增浅色 `--panel` 变量；Chat/Dashboard/Layout/AdminLayout 等核心页面批量应用 `.glass-panel` / `.glass-card` / `.click-card`；DESIGN.md 动效与特效章节同步更新 | Agent |
| 2026-07-13 | 代码编辑器 IDE 暗色观感重构：`ProjectCode` 代码区/资源管理器/标签栏按 L0~L3 分层（`#0F172A`/`#1E293B`/`#2A374B`/`#334155`）；分割线统一为 `rgba(148,163,184,0.15)`；选中文件左侧品牌色边框、激活标签底部品牌色边框并连通代码区；`CodeBlock` 新增 `auroraDark` 语法高亮主题（关键字蓝/函数紫/字符串绿/类型橙/注释灰）与 `variant="editor"` 沉浸式编辑器模式；DESIGN.md 新增 IDE 规范章节 | Agent |
| 2026-07-13 | Aurora 统一胶囊标签栏：`ProjectCode` 页一级仓库/分支栏与二级视图模式 Tab 统一为 `.aurora-tab-bar` / `.aurora-tab-item` 胶囊体系，一级深灰蓝玻璃胶囊文字高亮，二级蓝紫渐变实底选中，彻底消除白边描边割裂感；DESIGN.md 新增 5.9 标签栏规范 | Agent |
| 2026-07-13 | Aurora 统一胶囊标签栏全页面落地：移除 `.aurora-tab-bar-primary/.aurora-tab-bar-secondary` 两套独立样式；所有页面视图/内容 Tab（`Settings`/`AdminDashboard`/`AdminPage`/`Chat`/`RepoStandardsDialog`）统一为 `.aurora-tab-bar level-2` 蓝紫渐变选中胶囊，与 `ProjectCode` 代码空间视图 Tab 完全一致；`ProjectCode` 顶部仓库/分支栏保留 `.aurora-tab-bar level-1` 作为全局上下文栏；DESIGN.md 5.9 规范更新 | Agent |
| 2026-07-14 | `ProjectCode` 代码编辑器主题自适应：亮色模式下不再使用固定暗色，改为 `bg-background`/`bg-panel`/`bg-accent` 主题变量；`CodeBlock` 新增 `darkMode` prop 跟随全局主题；修复顶部仓库/分支下拉框文字拥挤与重复「当前」徽章问题；DESIGN.md IDE 规范更新为自适应说明 | Agent |
| 2026-07-13 | 亮色弹窗质感优化：`Dialog` / `AlertDialog` 遮罩改为轻透明+8px 模糊，弹窗容器改为半透明白色磨砂玻璃（`bg-white/88 backdrop-blur-xl`）、蓝灰半透明边框、柔和多层阴影+白色内高光；关闭按钮改为圆角灰底悬停；`Button` outline 取消蓝色 hover 发光回归中性灰；`Input`/`SelectTrigger` 在浅色模式下使用 `#F8FAFC` 底并 focus 变白；DESIGN.md 新增亮色弹窗规范章节 | Agent |
| 2026-07-14 | 暗色模式输入框/下拉框可见性修复：统一 `Input`/`SelectTrigger`/`Textarea` 默认样式，暗色下使用 `bg-card/80` 背景并提升 `--input` 边框色为 `#334155`，移除 `Settings`/`PromptMarket`/`SkillMarket`/`DesignWorkspace`/`ProjectCode`/`SmartTest`/`ProductWorkspace` 中强制 `bg-background` 的覆盖，确保输入框边界在 `#0F172A` 背景下清晰可辨 | Agent |
| 2026-07-14 | 设置页 Tab 层级与对齐重构：建立一/二/三级 Tab 体系，所有导航 Tab 左对齐；`Settings`/`AdminDashboard`/`AdminPage` 一级页面导航改为 `.aurora-tab-bar level-1` 全宽左对齐蓝紫渐变胶囊，二级卡片内分类保持 `.aurora-tab-bar level-2`，`MarkdownEditor` 内可视化/Markdown/预览改为 `.aurora-tab-bar level-3` 小型线型下划线 Tab；DESIGN.md 5.9 规范升级为三级标签栏体系 | Agent |
| 2026-07-14 | MarkdownEditor 三级 Tab 轻量优化：取消厚重胶囊，改为高度 42px、间距 24px 的线型下划线 Tab，选中态使用蓝紫渐变下划线 + 品牌蓝加粗文字；同步通过 CSS 变量重写 WangEditor 亮/暗配色，解决暗色模式下工具栏白底/图标不可见问题；DESIGN.md 5.9 三级规范更新 | Agent |
| 2026-07-14 | 租户智能体策略配置重构：新建/编辑租户弹窗内「允许使用的 Coding Agent」与「默认模型配置」上下重复列表合并为可折叠 Agent 卡片组，每张卡片头部含启用复选框、状态标签、锁定按钮、展开箭头；卡片体内完成启用开关、自定义模型、温度、Token 数等参数配置；支持单个/多个 Agent 独立锁定，锁定后配置区自动灰化禁用；未启用卡片整体弱化且不可展开；样式沿用 Aurora 卡片规范（`bg-card border-border/50 rounded-xl`）与 0.2s 过渡 | Agent |
| 2026-07-14 | 超管技能/提示词管理标签样式与空间管理对齐：分类筛选条改为 `rounded-full` 药丸按钮（选中 `default`/未选中 `outline`）；分类管理标签改用 `Badge variant="secondary"` 默认尺寸，删除图标从 `Trash2` 改为 `X`；表格内多分类折叠标签从 `bg-primary/10` 改为 `bg-secondary text-secondary-foreground`；DESIGN.md 5.7 筛选条规范补充药丸分类筛选说明 | Agent |
| 2026-07-13 | 修复模板管理创建模板后条目消失并自动跳转到下一分类的问题：分类切换器由 Radix `Tabs` 改为自定义按钮组，避免弹窗关闭时的焦点/事件冲突；新增租户行操作「复制」：点击后弹出「复制租户」弹框，自动清空租户名称与成员，保留原租户智能体策略等其他配置，名称必填 | Agent |
| 2026-07-15 | 平台模板持久化到 PostgreSQL：新增 `platformtemplate` 后端模块与 `platform_templates` 表，超管模板管理页通过 `/api/v1/templates` CRUD 管理三类模板（产品规范/设计规范/研发规范），首次启动自动 seed 默认模板；前端移除 `localStorage` 模板存储，新增 `template-api.ts` 与 `useTemplates` hook，`MarkdownEditor`、`空间设置`、`仓库规范弹窗` 均从后端读取；租户编辑弹框新增「添加成员」功能，可输入邮箱/姓名添加租户成员并指定管理员，默认密码 123456 | Agent |
| 2026-07-14 | 表格行操作下拉菜单极光玻璃化：统一 `DropdownMenuContent` 为 `bg-popover/95 backdrop-blur-xl border-border/50 rounded-lg shadow-lg`；`DropdownMenuItem` 统一高度 32px、图标+文字、hover 浅蓝底高亮；危险项（删除）使用 `text-destructive focus:bg-destructive/10 focus:text-destructive` 并与普通项用分隔线区隔；触发按钮 `ghost` 增加 hover/open 浅蓝高亮；技能/提示词/租户管理下拉菜单补充图标；DESIGN.md 5.7 行操作规范更新 | Agent |
| 2026-08-11 | 弹窗设计规范系统化：全面排查约 60 处弹窗（Dialog/AlertDialog/Sheet/toast），将原「亮色弹窗规范」扩充为「弹窗设计规范」（组件选型/遮罩容器/标准结构/宽度分级/底部按钮/危险确认/抽屉/Toast），明确危险操作一律 AlertDialog + destructive 按钮、宽度按四档收敛、禁止手写 fixed 模态；现存 7 类偏差记录在 14.10 待整改；章节重编号（弹窗→14、IDE→15、变更记录→16，修正原双 13 编号冲突与 IDE 子节编号） | Agent |
| 2026-08-11 | 弹窗规范 7 类偏差全部整改：三处危险确认（删除仓库/作废文档）改 destructive 红色按钮；退出登录与删除租户确认由 Dialog 迁移至 AlertDialog；`ui/dialog.tsx` 与 `ui/sheet.tsx` 遮罩/容器对齐毛玻璃规范（亮色轻透模糊、暗色深遮罩），Sheet 按方向补 `rounded-*-2xl`，AlertDialog 移动端补圆角；任意宽度值（425/440/480/500/620/680/800px）收敛至四档，仓库设置弹窗补 `sm:max-w-md`；修复创建助手弹窗动态 Tailwind 类名失效 Bug；看板引导弹窗 Footer 改右对齐 | Agent |
| 2026-08-11 | 弹窗容器改为实色不透明：应产品要求去除弹窗半透明/毛玻璃效果，`ui/dialog.tsx`、`ui/alert-dialog.tsx` 容器改实色白底（暗色实色 `#1E293B`），三个组件遮罩统一为无模糊浅调 `bg-[rgba(15,23,42,0.08)]`；DESIGN.md 14.2 规范同步更新 | Agent |
