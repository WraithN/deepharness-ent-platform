# DeepHarness Enterprise Platform — 设计规范

> 本文档是项目 UI/UX 设计的单一事实来源。所有涉及 UI 设计、样式调整、新增组件或修改界面布局的变更，**必须先阅读并严格遵循本文档**。

---

## 1. 设计哲学

- **简洁现代**：以清晰的视觉层次和充足的留白为主，避免过度装饰。
- **端云科技风**：采用偏蓝的科技色调，配合 Dracula 暗色主题，营造专业、高效的开发者氛围。
- **高可读性**：正文与背景保持高对比度，代码区域使用等宽字体确保对齐。
- **一致的体验**：所有交互元素（按钮、输入框、卡片）遵循统一的圆角、阴影和动效规范。

---

## 2. 色彩系统

色彩通过 CSS 自定义属性（CSS Variables）定义于 `apps/dh-frontend/src/index.css`，并在 `tailwind.config.js` 中映射为 Tailwind 颜色键。

### 2.1 浅色主题（Light）

| Token | HSL | 色值 | 用途 |
|-------|-----|------|------|
| `--background` | `216 33% 97%` | `#F7F9FC` | 页面背景 |
| `--foreground` | `222 47% 11%` | `#0F172A` | 主文字 |
| `--card` | `0 0% 100%` | `#FFFFFF` | 卡片背景 |
| `--primary` | `228 82% 55%` | `#2F54EB` | 主品牌色、按钮、链接 |
| `--primary-foreground` | `210 40% 98%` | `#F8FAFC` | 主色上的文字 |
| `--secondary` | `216 20% 95%` | `#EDF0F5` | 次要背景、标签 |
| `--muted` | `216 20% 95%` | `#EDF0F5` | 禁用、次要区域 |
| `--muted-foreground` | `215 16% 47%` | `#64748B` | 辅助文字、描述 |
| `--border` | `216 20% 90%` | `#E2E8F0` | 边框、分割线 |
| `--ring` | `228 82% 55%` | `#2F54EB` | 焦点环、outline |
| `--destructive` | `0 84.2% 60.2%` | `#EF4444` | 危险操作 |

**语义状态色：**
- `success` → `hsl(var(--success))`（绿色系）
- `warning` → `hsl(var(--warning))`（橙/黄色系）
- `info` → `hsl(var(--info))`（蓝色系）

**图表色（Chart）：**
- `chart-1` → `#2F54EB`
- `chart-2` → `#2A9D8F`
- `chart-3` → `#264653`
- `chart-4` → `#E9C46A`
- `chart-5` → `#F4A261`

### 2.2 深色主题（Dark / Dracula）

深色主题采用 **Dracula** 配色方案，通过 `.dark` 类切换。

| Token | HSL | 色值 | 用途 |
|-------|-----|------|------|
| `--background` | `231 15% 18%` | `#282A36` | 页面背景 |
| `--foreground` | `60 30% 96%` | `#F8F8F2` | 主文字 |
| `--card` | `232 14% 31%` | `#44475A` | 卡片背景 |
| `--primary` | `265 89% 78%` | `#BD93F9` | 主品牌色（紫色） |
| `--muted-foreground` | `232 18% 55%` | `#6272A4` | 辅助文字（灰蓝） |
| `--destructive` | `0 100% 67%` | `#FF5555` | 危险操作 |
| `--border` | `232 14% 31%` | `#44475A` | 边框 |
| `--ring` | `265 89% 78%` | `#BD93F9` | 焦点环 |

**图表色（Dark）：**
- `chart-1` → `#BD93F9`（紫）
- `chart-2` → `#50FA7B`（绿）
- `chart-3` → `#FFB86C`（橙）
- `chart-4` → `#FF79C6`（粉）
- `chart-5` → `#8BE9FD`（青）

### 2.3 色彩使用原则

- **主色（Primary）**：用于主要按钮、活跃状态、关键链接、焦点环。浅色为蓝 `#2F54EB`，深色为紫 `#BD93F9`。
- **背景层级**：页面背景 → 卡片/面板背景 → 输入框背景，每层亮度/暗度递进。
- **文字层级**：主文字（`foreground`）→ 辅助文字（`muted-foreground`）→ 禁用状态（降低透明度）。
- **边框**：统一使用柔和的半透明边框，避免生硬的实色分割。
- **危险色**：统一使用红色系，深浅主题保持一致的情绪传达。

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
- **筛选条**（可选，位于头部与表格之间）：`flex flex-wrap gap-2 items-center mb-4`，前缀标签 `text-sm text-muted-foreground`，筛选项为 `h-8` 的 `secondary`（选中）/`ghost`（未选中）按钮。
- **状态/角色徽章**：`rounded-lg px-3 py-1.5 font-medium`；肯定态（如“是”）`bg-primary text-primary-foreground`，否定态 `variant="outline"`；语义分类徽章（角色、会话类型）保留语义色并带 `dark:` 变体。
- **时间列**：`text-muted-foreground`，配 `Clock` 图标（`w-3 h-3`）。
- **行操作**：`variant="ghost" size="icon"` + `MoreHorizontal` 图标，`hover:bg-muted rounded-md`，下拉菜单 `align="end"`；行内直接操作可用 Switch（上下架开关）、`variant="outline" size="sm"` 按钮（审核类）或 `ghost size="icon"` 删除按钮（`hover:text-destructive`）。
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
| `.glass-panel` | 毛玻璃 + 半透明边框 + 阴影 | 浮层面板、模态框 |
| `.claude-card` | 顶部亮底部暗的渐变背景 + 微妙边框 | 内容卡片、功能区块 |
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

### 8.2 交互过渡

- **按钮 Hover**：`transition-colors duration-200`
- **卡片 Hover**：轻微上浮或阴影增强
- **焦点状态**：`ring-2 ring-ring ring-offset-2`，确保键盘导航可见性
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

- **布局**：与主应用类似，但导航项变为管理员专用（数据大盘、空间管理、技能/提示词审核、全局配置）。

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

## 14. 变更记录

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
