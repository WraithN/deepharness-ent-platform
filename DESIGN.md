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

色彩通过 CSS 自定义属性（CSS Variables）定义于 `apps/web/src/index.css`，并在 `tailwind.config.js` 中映射为 Tailwind 颜色键。

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
apps/web/src/
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
