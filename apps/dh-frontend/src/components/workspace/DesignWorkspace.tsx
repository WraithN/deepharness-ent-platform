import React, { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Eye,
  LayoutGrid,
  FileText,
  Scissors,
  ChevronRight,
  ChevronDown,
  Search,
  Download,
  Image as ImageIcon,
  Folder,
  FileImage,
  FileCode,
  Type,
  MousePointer,
  Box,
  Grid3x3,
  AlignLeft,
  CheckCircle2,
  Monitor,
  Smartphone,
  Tablet,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';

type DesignTab = 'preview' | 'components' | 'specs' | 'slices';

interface DesignProject {
  id: string;
  name: string;
}

interface DesignVersion {
  id: string;
  name: string;
}

interface DesignPage {
  id: string;
  name: string;
  thumbnail?: string;
  width: number;
  height: number;
  updatedAt: string;
}

interface ComponentCategory {
  id: string;
  name: string;
  icon: React.ElementType;
}

interface DesignComponent {
  id: string;
  name: string;
  categoryId: string;
  description: string;
  variantCount: number;
  thumbnail?: string;
}

interface DesignSpec {
  id: string;
  name: string;
  category: string;
  content: string;
  updatedAt: string;
}

interface SliceFolder {
  id: string;
  name: string;
  children?: SliceFolder[];
}

interface SliceAsset {
  id: string;
  name: string;
  folderId: string;
  format: string;
  size: string;
  resolution: string;
}

// ── Mock 数据 ──

const PROJECTS: DesignProject[] = [
  { id: 'p1', name: 'DeepHarness 官网改版' },
  { id: 'p2', name: 'AI 辅助编码平台' },
  { id: 'p3', name: '移动端 App 设计' },
];

const VERSIONS: DesignVersion[] = [
  { id: 'v1', name: 'v2.3.0 正式版' },
  { id: 'v2', name: 'v2.2.1 评审版' },
  { id: 'v3', name: 'v2.2.0 历史版本' },
];

const PAGES: DesignPage[] = [
  { id: 'page-1', name: '01 首页', width: 1440, height: 3240, updatedAt: '2026-07-05' },
  { id: 'page-2', name: '02 产品功能', width: 1440, height: 2860, updatedAt: '2026-07-05' },
  { id: 'page-3', name: '03 定价方案', width: 1440, height: 1920, updatedAt: '2026-07-04' },
  { id: 'page-4', name: '04 客户案例', width: 1440, height: 2400, updatedAt: '2026-07-04' },
  { id: 'page-5', name: '05 关于我们', width: 1440, height: 1680, updatedAt: '2026-07-03' },
  { id: 'page-6', name: '06 登录/注册', width: 1440, height: 900, updatedAt: '2026-07-03' },
];

const COMPONENT_CATEGORIES: ComponentCategory[] = [
  { id: 'cat-buttons', name: '按钮', icon: MousePointer },
  { id: 'cat-icons', name: '图标', icon: Grid3x3 },
  { id: 'cat-forms', name: '表单', icon: AlignLeft },
  { id: 'cat-navigation', name: '导航', icon: Box },
  { id: 'cat-cards', name: '卡片', icon: LayoutGrid },
  { id: 'cat-typography', name: '字体', icon: Type },
];

const COMPONENTS: DesignComponent[] = [
  { id: 'c1', name: 'Primary Button', categoryId: 'cat-buttons', description: '主操作按钮，用于页面核心行为触发。', variantCount: 4 },
  { id: 'c2', name: 'Secondary Button', categoryId: 'cat-buttons', description: '次要操作按钮，用于取消、返回等场景。', variantCount: 3 },
  { id: 'c3', name: 'Ghost Button', categoryId: 'cat-buttons', description: '幽灵按钮，用于弱引导操作。', variantCount: 2 },
  { id: 'c4', name: 'Navigation Bar', categoryId: 'cat-navigation', description: '顶部导航栏，支持多级菜单。', variantCount: 2 },
  { id: 'c5', name: 'Sidebar Menu', categoryId: 'cat-navigation', description: '侧边导航菜单，支持折叠与展开。', variantCount: 3 },
  { id: 'c6', name: 'Text Input', categoryId: 'cat-forms', description: '基础文本输入框。', variantCount: 5 },
  { id: 'c7', name: 'Select Dropdown', categoryId: 'cat-forms', description: '下拉选择器。', variantCount: 3 },
  { id: 'c8', name: 'Checkbox Group', categoryId: 'cat-forms', description: '复选框组。', variantCount: 2 },
  { id: 'c9', name: 'Info Card', categoryId: 'cat-cards', description: '信息展示卡片。', variantCount: 4 },
  { id: 'c10', name: 'Statistic Card', categoryId: 'cat-cards', description: '数据统计卡片。', variantCount: 3 },
  { id: 'c11', name: 'Logo Icon', categoryId: 'cat-icons', description: '品牌 Logo 图标。', variantCount: 6 },
  { id: 'c12', name: 'Action Icons', categoryId: 'cat-icons', description: '常用操作图标集。', variantCount: 24 },
];

const SPECS: DesignSpec[] = [
  {
    id: 'spec-1',
    name: '色彩系统',
    category: '视觉',
    updatedAt: '2026-07-05',
    content: '## 色彩系统\n\n### 主色\n- **Primary**: `#6366f1` — 用于主按钮、链接、强调色。\n- **Primary Hover**: `#4f46e5`\n- **Primary Active**: `#4338ca`\n\n### 中性色\n- **Background**: `#ffffff` / `#0f172a`（深色模式）\n- **Foreground**: `#020617` / `#f8fafc`（深色模式）\n- **Muted**: `#f1f5f9` / `#1e293b`（深色模式）\n\n### 语义色\n- **Success**: `#22c55e`\n- **Warning**: `#f59e0b`\n- **Destructive**: `#ef4444`\n',
  },
  {
    id: 'spec-2',
    name: '字体与排版',
    category: '视觉',
    updatedAt: '2026-07-04',
    content: '## 字体与排版\n\n### 字体栈\n- **标题**: Inter, system-ui, sans-serif\n- **正文**: Inter, system-ui, sans-serif\n- **代码**: JetBrains Mono, monospace\n\n### 字号层级\n| 级别 | 大小 | 行高 | 字重 | 用途 |\n|------|------|------|------|------|\n| H1 | 2.25rem | 2.5rem | 700 | 页面大标题 |\n| H2 | 1.5rem | 2rem | 600 | 区块标题 |\n| Body | 0.875rem | 1.5rem | 400 | 正文 |\n| Small | 0.75rem | 1rem | 400 | 辅助说明 |\n',
  },
  {
    id: 'spec-3',
    name: '间距与布局',
    category: '布局',
    updatedAt: '2026-07-03',
    content: '## 间距与布局\n\n### 基础单位\n基础间距单位为 `4px`，所有间距均为 4 的倍数。\n\n### 常用间距\n- `xs`: 4px\n- `sm`: 8px\n- `md`: 16px\n- `lg`: 24px\n- `xl`: 32px\n- `2xl`: 48px\n\n### 栅格系统\n采用 12 列栅格， gutter 为 24px，容器最大宽度 1440px。\n',
  },
  {
    id: 'spec-4',
    name: '组件使用规范',
    category: '组件',
    updatedAt: '2026-07-02',
    content: '## 组件使用规范\n\n### 按钮\n- 同一操作区最多出现 1 个主按钮。\n- 删除等危险操作需使用 Destructive 样式并二次确认。\n\n### 表单\n- 必填项需标注红色星号。\n- 表单提交失败时，错误提示应定位到具体字段。\n\n### 弹窗\n- 弹窗宽度不超过 640px。\n- 复杂表单建议使用抽屉（Drawer）承载。\n',
  },
];

const SLICE_FOLDERS: SliceFolder[] = [
  {
    id: 'f-root',
    name: '全部素材',
    children: [
      { id: 'f-icons', name: '图标' },
      { id: 'f-illustrations', name: '插画' },
      { id: 'f-photos', name: '照片' },
      {
        id: 'f-components',
        name: '组件切图',
        children: [
          { id: 'f-buttons', name: '按钮' },
          { id: 'f-cards', name: '卡片' },
        ],
      },
    ],
  },
];

const SLICE_ASSETS: SliceAsset[] = [
  { id: 's1', name: 'logo-primary', folderId: 'f-icons', format: 'SVG', size: '12 KB', resolution: '48x48' },
  { id: 's2', name: 'icon-dashboard', folderId: 'f-icons', format: 'SVG', size: '2 KB', resolution: '24x24' },
  { id: 's3', name: 'icon-settings', folderId: 'f-icons', format: 'SVG', size: '2 KB', resolution: '24x24' },
  { id: 's4', name: 'hero-illustration', folderId: 'f-illustrations', format: 'PNG', size: '256 KB', resolution: '800x600' },
  { id: 's5', name: 'feature-ai', folderId: 'f-illustrations', format: 'PNG', size: '188 KB', resolution: '600x400' },
  { id: 's6', name: 'team-photo-01', folderId: 'f-photos', format: 'JPG', size: '1.2 MB', resolution: '1200x800' },
  { id: 's7', name: 'btn-primary-default', folderId: 'f-buttons', format: 'PNG', size: '4 KB', resolution: '120x40' },
  { id: 's8', name: 'btn-primary-hover', folderId: 'f-buttons', format: 'PNG', size: '4 KB', resolution: '120x40' },
  { id: 's9', name: 'card-info-default', folderId: 'f-cards', format: 'PNG', size: '8 KB', resolution: '320x160' },
];

// ── 子组件 ──

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}> = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    <Icon className="w-4 h-4" />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const ResourceItem: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  meta?: React.ReactNode;
}> = ({ active, onClick, icon: Icon, label, meta }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`}
  >
    <Icon className="w-4 h-4 shrink-0" />
    <span className="flex-1 truncate">{label}</span>
    {meta && <span className="shrink-0">{meta}</span>}
  </button>
);

const FolderTree: React.FC<{
  folders: SliceFolder[];
  selectedId: string;
  onSelect: (id: string) => void;
  level?: number;
}> = ({ folders, selectedId, onSelect, level = 0 }) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({
    'f-root': true,
    'f-components': true,
  });

  return (
    <div className="space-y-0.5">
      {folders.map(folder => {
        const isExpanded = expanded[folder.id] ?? false;
        const hasChildren = folder.children && folder.children.length > 0;
        return (
          <div key={folder.id}>
            <button
              onClick={() => {
                onSelect(folder.id);
                if (hasChildren) {
                  setExpanded(prev => ({ ...prev, [folder.id]: !isExpanded }));
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                selectedId === folder.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              style={{ paddingLeft: `${12 + level * 16}px` }}
            >
              {hasChildren && (
                isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              {!hasChildren && <span className="w-3.5 shrink-0" />}
              <Folder className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{folder.name}</span>
            </button>
            {hasChildren && isExpanded && (
              <div className="mt-0.5">
                <FolderTree
                  folders={folder.children!}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  level={level + 1}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── 主组件 ──

/**
 * 设计空间工作台（Designer 专属）。
 *
 * 支持：
 * - 设计项目 / 版本选择
 * - 设计预览 / 组件库 / 设计规范 / 切图资源 四种工作模式
 * - 左侧资源区（页面列表 / 组件分类 / 规范文档 / 素材文件夹）
 * - 主内容区（设计稿预览 / 组件卡片 / 规范文档 / 切图下载）
 */
export const DesignWorkspace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DesignTab>('preview');
  const [selectedProject, setSelectedProject] = useState(PROJECTS[0].id);
  const [selectedVersion, setSelectedVersion] = useState(VERSIONS[0].id);
  const [selectedPageId, setSelectedPageId] = useState<string>(PAGES[0].id);
  const [selectedComponentCategory, setSelectedComponentCategory] = useState<string>(COMPONENT_CATEGORIES[0].id);
  const [selectedSpecId, setSelectedSpecId] = useState<string>(SPECS[0].id);
  const [selectedSliceFolderId, setSelectedSliceFolderId] = useState<string>('f-root');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewZoom, setPreviewZoom] = useState(75);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  const tabs: { key: DesignTab; label: string; icon: React.ElementType }[] = [
    { key: 'preview', label: '设计预览', icon: Eye },
    { key: 'components', label: '组件库', icon: LayoutGrid },
    { key: 'specs', label: '设计规范', icon: FileText },
    { key: 'slices', label: '切图资源', icon: Scissors },
  ];

  const selectedPage = useMemo(
    () => PAGES.find(p => p.id === selectedPageId) ?? PAGES[0],
    [selectedPageId]
  );

  const filteredPages = useMemo(
    () => PAGES.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [searchQuery]
  );

  const filteredComponents = useMemo(
    () => COMPONENTS.filter(
      c => c.categoryId === selectedComponentCategory &&
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [selectedComponentCategory, searchQuery]
  );

  const filteredSpecs = useMemo(
    () => SPECS.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [searchQuery]
  );

  const filteredSlices = useMemo(
    () => SLICE_ASSETS.filter(
      a =>
        (selectedSliceFolderId === 'f-root' || a.folderId === selectedSliceFolderId || isChildFolder(selectedSliceFolderId, a.folderId)) &&
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [selectedSliceFolderId, searchQuery]
  );

  const selectedSpec = useMemo(
    () => SPECS.find(s => s.id === selectedSpecId) ?? SPECS[0],
    [selectedSpecId]
  );

  const deviceWidths = { desktop: '100%', tablet: '768px', mobile: '375px' };

  function isChildFolder(parentId: string, assetFolderId: string): boolean {
    const findFolder = (folders: SliceFolder[], id: string): SliceFolder | undefined => {
      for (const f of folders) {
        if (f.id === id) return f;
        if (f.children) {
          const found = findFolder(f.children, id);
          if (found) return found;
        }
      }
      return undefined;
    };
    const parent = findFolder(SLICE_FOLDERS, parentId);
    if (!parent || !parent.children) return false;
    const contains = (folders: SliceFolder[], targetId: string): boolean => {
      for (const f of folders) {
        if (f.id === targetId) return true;
        if (f.children && contains(f.children, targetId)) return true;
      }
      return false;
    };
    return contains(parent.children, assetFolderId);
  }

  const renderLeftPanel = () => {
    const searchPlaceholder =
      activeTab === 'preview' ? '搜索页面…' :
      activeTab === 'components' ? '搜索组件…' :
      activeTab === 'specs' ? '搜索规范…' :
      '搜索素材…';

    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={searchPlaceholder}
              className="pl-8 h-9 text-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="flex-1 p-2">
          {activeTab === 'preview' && (
            <div className="space-y-0.5">
              {filteredPages.map(page => (
                <ResourceItem
                  key={page.id}
                  active={selectedPageId === page.id}
                  onClick={() => setSelectedPageId(page.id)}
                  icon={Monitor}
                  label={page.name}
                  meta={<span className="text-xs text-muted-foreground">{page.updatedAt}</span>}
                />
              ))}
            </div>
          )}

          {activeTab === 'components' && (
            <div className="space-y-0.5">
              {COMPONENT_CATEGORIES.map(cat => {
                const Icon = cat.icon;
                return (
                  <ResourceItem
                    key={cat.id}
                    active={selectedComponentCategory === cat.id}
                    onClick={() => setSelectedComponentCategory(cat.id)}
                    icon={Icon}
                    label={cat.name}
                    meta={
                      <Badge variant="secondary" className="text-xs font-normal">
                        {COMPONENTS.filter(c => c.categoryId === cat.id).length}
                      </Badge>
                    }
                  />
                );
              })}
            </div>
          )}

          {activeTab === 'specs' && (
            <div className="space-y-0.5">
              {filteredSpecs.map(spec => (
                <ResourceItem
                  key={spec.id}
                  active={selectedSpecId === spec.id}
                  onClick={() => setSelectedSpecId(spec.id)}
                  icon={FileText}
                  label={spec.name}
                  meta={<span className="text-xs text-muted-foreground">{spec.category}</span>}
                />
              ))}
            </div>
          )}

          {activeTab === 'slices' && (
            <FolderTree
              folders={SLICE_FOLDERS}
              selectedId={selectedSliceFolderId}
              onSelect={setSelectedSliceFolderId}
            />
          )}
        </ScrollArea>
      </div>
    );
  };

  const renderMainContent = () => {
    if (activeTab === 'preview') {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{selectedPage.name}</span>
              <span className="text-xs text-muted-foreground">
                {selectedPage.width} × {selectedPage.height}px
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${previewDevice === 'desktop' ? 'text-primary' : ''}`}
                onClick={() => setPreviewDevice('desktop')}
              >
                <Monitor className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${previewDevice === 'tablet' ? 'text-primary' : ''}`}
                onClick={() => setPreviewDevice('tablet')}
              >
                <Tablet className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${previewDevice === 'mobile' ? 'text-primary' : ''}`}
                onClick={() => setPreviewDevice('mobile')}
              >
                <Smartphone className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-5 mx-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewZoom(z => Math.max(25, z - 25))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground w-10 text-center">{previewZoom}%</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewZoom(z => Math.min(150, z + 25))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setPreviewZoom(75); setPreviewDevice('desktop'); }}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1 bg-muted/30 p-6">
            <div className="flex justify-center min-h-full">
              <div
                className="bg-background rounded-lg shadow-sm border overflow-hidden relative"
                style={{
                  width: deviceWidths[previewDevice],
                  transform: `scale(${previewZoom / 100})`,
                  transformOrigin: 'top center',
                  height: `${selectedPage.height}px`,
                  minWidth: previewDevice === 'desktop' ? '800px' : undefined,
                }}
              >
                {/* 设计稿占位内容 */}
                <div className="absolute inset-0 p-8 flex flex-col gap-6">
                  <div className="h-16 rounded-lg bg-gradient-to-r from-primary/20 to-primary/5 flex items-center px-6">
                    <div className="w-32 h-6 rounded bg-primary/30" />
                    <div className="flex-1" />
                    <div className="flex gap-4">
                      <div className="w-16 h-4 rounded bg-muted" />
                      <div className="w-16 h-4 rounded bg-muted" />
                      <div className="w-16 h-4 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-64 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 flex items-center justify-center">
                    <div className="text-center space-y-3">
                      <div className="w-24 h-24 rounded-full bg-primary/20 mx-auto flex items-center justify-center">
                        <ImageIcon className="w-10 h-10 text-primary/60" />
                      </div>
                      <p className="text-sm text-muted-foreground">设计稿预览占位</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="h-32 rounded-lg bg-muted/60" />
                    <div className="h-32 rounded-lg bg-muted/60" />
                    <div className="h-32 rounded-lg bg-muted/60" />
                  </div>
                  <div className="h-48 rounded-lg bg-muted/40" />
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      );
    }

    if (activeTab === 'components') {
      return (
        <div className="flex flex-col h-full">
          <div className="px-4 py-2 border-b bg-muted/20">
            <span className="text-sm font-medium">
              {COMPONENT_CATEGORIES.find(c => c.id === selectedComponentCategory)?.name}组件
            </span>
            <span className="text-xs text-muted-foreground ml-2">共 {filteredComponents.length} 个</span>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredComponents.map(component => (
                <Card key={component.id} className="overflow-hidden hover:shadow-md transition-shadow">
                  <div className="h-32 bg-muted/50 flex items-center justify-center border-b">
                    <LayoutGrid className="w-10 h-10 text-muted-foreground/40" />
                  </div>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-medium">{component.name}</h4>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{component.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <Badge variant="outline" className="text-xs font-normal">{component.variantCount} 变体</Badge>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2">查看</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      );
    }

    if (activeTab === 'specs') {
      return (
        <div className="flex flex-col h-full">
          <div className="px-4 py-2 border-b bg-muted/20">
            <span className="text-sm font-medium">{selectedSpec.name}</span>
            <span className="text-xs text-muted-foreground ml-2">{selectedSpec.category} · 更新于 {selectedSpec.updatedAt}</span>
          </div>
          <ScrollArea className="flex-1 p-6">
            <div className="max-w-3xl mx-auto prose prose-sm dark:prose-invert">
              {selectedSpec.content.split('\n').map((line, idx) => {
                if (line.startsWith('## ')) {
                  return <h2 key={idx} className="text-xl font-semibold mt-6 mb-3">{line.replace('## ', '')}</h2>;
                }
                if (line.startsWith('### ')) {
                  return <h3 key={idx} className="text-lg font-medium mt-4 mb-2">{line.replace('### ', '')}</h3>;
                }
                if (line.startsWith('- ')) {
                  return <li key={idx} className="ml-4">{line.replace('- ', '')}</li>;
                }
                if (line.startsWith('| ')) {
                  return <div key={idx} className="text-sm font-mono bg-muted/50 p-1 rounded my-1">{line}</div>;
                }
                if (line.trim() === '') {
                  return <div key={idx} className="h-2" />;
                }
                return <p key={idx} className="text-sm leading-relaxed">{line}</p>;
              })}
            </div>
          </ScrollArea>
        </div>
      );
    }

    // slices
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">切图资源</span>
            <span className="text-xs text-muted-foreground ml-2">共 {filteredSlices.length} 个</span>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3.5 h-3.5 mr-1" />
            批量下载
          </Button>
        </div>
        <ScrollArea className="flex-1 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSlices.map(asset => (
              <Card key={asset.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-28 bg-muted/50 flex items-center justify-center border-b">
                  {asset.format === 'SVG' ? <FileCode className="w-10 h-10 text-primary/50" /> :
                   asset.format === 'JPG' ? <FileImage className="w-10 h-10 text-orange-500/50" /> :
                   <ImageIcon className="w-10 h-10 text-blue-500/50" />}
                </div>
                <CardContent className="p-3">
                  <h4 className="text-sm font-medium truncate">{asset.name}</h4>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-xs font-normal">{asset.format}</Badge>
                    <span>{asset.resolution}</span>
                    <span>{asset.size}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="w-full mt-3 h-8 text-xs">
                    <Download className="w-3.5 h-3.5 mr-1" />
                    下载
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-3 w-full pb-8">
      {/* 顶部工具栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/50 p-2 rounded-xl">
        <div className="flex items-center gap-1">
          {tabs.map(tab => (
            <TabButton
              key={tab.key}
              active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              icon={tab.icon}
              label={tab.label}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <SelectValue placeholder="选择设计项目" />
            </SelectTrigger>
            <SelectContent>
              {PROJECTS.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedVersion} onValueChange={setSelectedVersion}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <SelectValue placeholder="选择版本" />
            </SelectTrigger>
            <SelectContent>
              {VERSIONS.map(v => <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 主工作区 */}
      <Card className="flex-1 overflow-hidden border-none shadow-sm flex flex-col relative">
        <div className="flex h-full">
          {/* 左侧资源区 */}
          <div className="w-64 border-r bg-muted/20 shrink-0 hidden md:flex flex-col">
            {renderLeftPanel()}
          </div>

          {/* 主内容区 */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderMainContent()}
          </div>
        </div>
      </Card>
    </div>
  );
};
