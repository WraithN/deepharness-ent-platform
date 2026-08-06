import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus, FileCode, RefreshCw, Search, ArrowRight, Link2, FileText,
  GitCompareArrows, Settings2, Code, GitBranch, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

// ── 常量 ──

/** 手工用例目录路径 */
const MANUAL_CASE_DIR = 'tests/manual/';
/** Pytest 脚本目录路径 */
const AUTO_SCRIPT_DIR = 'tests/auto/';
/** 用例绑定关系元文件路径 */
const CASE_MAPPING_FILE = '.aicoding/case-mapping.yaml';

/** 子视图配置 */
const SUB_VIEWS = [
  { key: 'bind' as const, label: '绑定关系', icon: Link2 },
  { key: 'source' as const, label: '源文件', icon: FileCode },
  { key: 'diff' as const, label: 'Diff预览', icon: GitCompareArrows },
  { key: 'meta' as const, label: '元文件', icon: Settings2 },
];

/** 执行状态配色 */
const EXEC_STATUS_STYLE: Record<string, { text: string; label: string }> = {
  pass: { text: 'text-green-500', label: '通过' },
  fail: { text: 'text-red-500', label: '失败' },
  pending: { text: 'text-orange-500', label: '待运行' },
};

/** Git 变更状态配色 */
const GIT_STATUS_STYLE: Record<string, { text: string; bg: string; label: string }> = {
  new: { text: 'text-green-500', bg: 'bg-green-100 text-green-700', label: 'new' },
  modified: { text: 'text-orange-500', bg: 'bg-orange-100 text-orange-700', label: 'modified' },
};

// ── 类型 ──

interface ManualCase {
  id: string;
  title: string;
  fileName: string;
  requirementId: string;
  requirementTitle: string;
  boundScriptCount: number;
  gitStatus: 'new' | 'modified' | null;
}

interface PytestScript {
  id: string;
  name: string;
  type: 'api' | 'ui';
  fileName: string;
  boundCaseId: string | null;
  execStatus: 'pass' | 'fail' | 'pending' | null;
  gitStatus: 'new' | 'modified' | null;
}

interface GitChange {
  status: 'new' | 'modified';
  filePath: string;
}

// ── Mock 数据（后续接入后端 API 替换） ──

const MOCK_MANUAL_CASES: ManualCase[] = [
  {
    id: 'TC-001',
    title: '角色权限页面新增角色校验',
    fileName: 'TC-001-角色权限新增校验.md',
    requirementId: '#1233232',
    requirementTitle: '角色与权限管理',
    boundScriptCount: 2,
    gitStatus: 'new',
  },
  {
    id: 'TC-002',
    title: '转化漏斗筛选条件校验',
    fileName: 'TC-002-转化漏斗筛选校验.md',
    requirementId: '#1233301',
    requirementTitle: '转化漏斗分析',
    boundScriptCount: 0,
    gitStatus: null,
  },
  {
    id: 'TC-003',
    title: 'A/B测试投放开关状态',
    fileName: 'TC-003-ab-switch.md',
    requirementId: '#1233400',
    requirementTitle: 'A/B测试投放',
    boundScriptCount: 1,
    gitStatus: 'modified',
  },
];

const MOCK_PYTEST_SCRIPTS: PytestScript[] = [
  {
    id: 'test_role_add',
    name: 'test_role_add.py',
    type: 'api',
    fileName: 'test_role_add.py',
    boundCaseId: 'TC-001',
    execStatus: 'pass',
    gitStatus: 'new',
  },
  {
    id: 'test_role_edit',
    name: 'test_role_edit.py',
    type: 'ui',
    fileName: 'test_role_edit.py',
    boundCaseId: 'TC-001',
    execStatus: 'pending',
    gitStatus: null,
  },
  {
    id: 'test_ab_switch',
    name: 'test_ab_switch.py',
    type: 'api',
    fileName: 'test_ab_switch.py',
    boundCaseId: 'TC-003',
    execStatus: 'fail',
    gitStatus: 'modified',
  },
  {
    id: 'test_funnel_filter',
    name: 'test_funnel_filter.py',
    type: 'api',
    fileName: 'test_funnel_filter.py',
    boundCaseId: null,
    execStatus: 'pending',
    gitStatus: null,
  },
];

const MOCK_GIT_CHANGES: GitChange[] = [
  { status: 'new', filePath: 'tests/manual/TC-001-角色权限新增校验.md' },
  { status: 'new', filePath: 'tests/auto/test_role_add.py' },
  { status: 'new', filePath: 'tests/auto/test_role_edit.py' },
  { status: 'modified', filePath: '.aicoding/case-mapping.yaml' },
];

/** 模拟元文件内容 */
const MOCK_META_CONTENT = `case_mappings:
  TC-001:
    manual: tests/manual/TC-001-角色权限新增校验.md
    auto:
      - tests/auto/test_role_add.py
      - tests/auto/test_role_edit.py
  TC-003:
    manual: tests/manual/TC-003-ab-switch.md
    auto:
      - tests/auto/test_ab_switch.py`;

/** 模拟源文件内容 */
const MOCK_SOURCE_CONTENT = `# TC-001 角色权限页面新增角色校验

## 测试场景
- 新增角色，校验权限赋值、保存、回显
- 接口：/api/role/create

## 前置条件
1. 已登录管理员账号
2. 进入角色管理页面

## 测试步骤
1. 点击"新增角色"按钮
2. 填写角色名称和描述
3. 勾选权限项
4. 点击保存
5. 验证角色列表新增一行
6. 验证权限回显正确`;

/** 模拟 Diff 内容 */
const MOCK_DIFF_LINES = [
  { type: 'add', text: '+ 新增绑定 TC-001 <-> test_role_add.py' },
  { type: 'add', text: '+ 新增绑定 TC-001 <-> test_role_edit.py' },
  { type: 'del', text: '- 旧绑定（无）' },
];

// ── 标签组件 ──

/** 脚本类型标签 */
function ScriptTypeTag({ type }: { type: 'api' | 'ui' }) {
  const config = type === 'api'
    ? { label: '接口用例', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' }
    : { label: 'UI用例', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' };
  return (
    <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium', config.className)}>
      {config.label}
    </span>
  );
}

/** Git 状态标签 */
function GitStatusTag({ status }: { status: 'new' | 'modified' | null }) {
  if (!status) return null;
  const config = GIT_STATUS_STYLE[status];
  return (
    <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-mono', config.bg)}>
      {config.label}
    </span>
  );
}

/** 执行状态文本 */
function ExecStatusText({ status }: { status: 'pass' | 'fail' | 'pending' | null }) {
  if (!status) return null;
  const config = EXEC_STATUS_STYLE[status];
  return (
    <span className={cn('text-[11px]', config.text)}>
      {config.label}
    </span>
  );
}

// ── 主组件 ──

/**
 * 用例设计工作台。
 *
 * 三栏布局：
 * - 左栏（3/12）：手工用例列表（.md 文件）
 * - 中栏（2/12）：Pytest 自动化脚本列表（.py 文件）
 * - 右栏（7/12）：视图面板（绑定关系 / 源文件 / Diff / 元文件）+ Git 工作区提交面板
 *
 * 文件结构约定：
 * - tests/manual/*.md     手工用例
 * - tests/auto/*.py       pytest 脚本
 * - .aicoding/case-mapping.yaml  用例绑定关系元文件
 */
export const TestCaseDesign: React.FC = () => {
  const [activeView, setActiveView] = useState<typeof SUB_VIEWS[number]['key']>('bind');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(MOCK_MANUAL_CASES[0].id);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [detailCase, setDetailCase] = useState<ManualCase | null>(null);

  const selectedCase = useMemo(
    () => MOCK_MANUAL_CASES.find(c => c.id === selectedCaseId) ?? null,
    [selectedCaseId],
  );

  const boundScripts = useMemo(
    () => selectedCase ? MOCK_PYTEST_SCRIPTS.filter(s => s.boundCaseId === selectedCase.id) : [],
    [selectedCase],
  );

  const filteredCases = useMemo(
    () => MOCK_MANUAL_CASES.filter(c =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()),
    ),
    [searchQuery],
  );

  const filteredScripts = useMemo(
    () => MOCK_PYTEST_SCRIPTS.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ),
    [searchQuery],
  );

  /** 点击列表项：仅高亮选中 + 切换右栏视图，不弹窗 */
  const handleSelectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setSelectedScriptId(null);
    const tc = MOCK_MANUAL_CASES.find(c => c.id === caseId);
    if (tc) {
      setActiveView(tc.boundScriptCount > 0 ? 'bind' : 'source');
    }
  };

  /** 点击"查看详情"按钮：打开弹窗查看关联脚本 */
  const handleViewCaseDetail = (tc: ManualCase) => {
    setDetailCase(tc);
  };

  /** 选中 Pytest 脚本时，自动切换到源文件或 Diff 视图 */
  const handleSelectScript = (scriptId: string) => {
    setSelectedScriptId(scriptId);
    const script = MOCK_PYTEST_SCRIPTS.find(s => s.id === scriptId);
    if (script?.gitStatus === 'modified') {
      setActiveView('diff');
    } else {
      setActiveView('source');
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* 操作工具栏 */}
      <div className="flex items-center gap-2 shrink-0 pt-1 px-1">
        <Button variant="outline" size="icon" className="h-8 w-8" title="新建手工用例">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" title="新建Pytest脚本">
          <FileCode className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" title="同步远端Git">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <div className="ml-auto flex items-center gap-2 pr-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索用例/脚本名称"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 h-8 w-52 text-xs"
            />
          </div>
        </div>
      </div>

      {/* 三栏布局 */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* 左栏：手工用例列表（窄） */}
        <Card className="col-span-3 flex flex-col overflow-hidden border-border/50">
          <div className="px-3 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-blue-500">
                手工用例
              </span>
              <span className="text-sm font-medium text-foreground">{MOCK_MANUAL_CASES.length}</span>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">{MANUAL_CASE_DIR}</span>
          </div>
          <ScrollArea className="flex-1 p-2">
            <div className="space-y-1">
              {filteredCases.map(tc => {
                const isActive = selectedCaseId === tc.id;
                return (
                  <div
                    key={tc.id}
                    className={cn(
                      'p-2 rounded-md border cursor-pointer transition-all',
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300/50 dark:border-blue-700/50'
                        : 'border-transparent hover:bg-muted/50 hover:border-border/50',
                    )}
                    onClick={() => handleSelectCase(tc.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs font-medium flex-1 truncate', isActive && 'text-primary')}>
                        {tc.id}
                      </span>
                      <GitStatusTag status={tc.gitStatus} />
                      <button
                        className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="查看详情"
                        onClick={e => { e.stopPropagation(); handleViewCaseDetail(tc); }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-xs text-foreground/80 truncate mt-0.5">{tc.title}</div>
                    {tc.boundScriptCount > 0 ? (
                      <span className="inline-block mt-1 px-1 py-0.5 rounded text-[9px] font-medium text-white bg-green-500">
                        {tc.boundScriptCount}脚本
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/50 mt-0.5 inline-block">无绑定</span>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Card>

        {/* 中栏：Pytest 脚本列表（窄） */}
        <Card className="col-span-2 flex flex-col overflow-hidden border-border/50">
          <div className="px-3 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-green-500">
                Pytest
              </span>
              <span className="text-sm font-medium text-foreground">{MOCK_PYTEST_SCRIPTS.length}</span>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">{AUTO_SCRIPT_DIR}</span>
          </div>
          <ScrollArea className="flex-1 p-2">
            <div className="space-y-1">
              {filteredScripts.map(script => {
                const isActive = selectedScriptId === script.id;
                return (
                  <div
                    key={script.id}
                    className={cn(
                      'p-2 rounded-md border cursor-pointer transition-all',
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300/50 dark:border-blue-700/50'
                        : 'border-transparent hover:bg-muted/50 hover:border-border/50',
                    )}
                    onClick={() => handleSelectScript(script.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs font-medium flex-1 truncate', isActive && 'text-primary')}>
                        {script.name}
                      </span>
                      <GitStatusTag status={script.gitStatus} />
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <ScriptTypeTag type={script.type} />
                      {script.boundCaseId ? (
                        <span className="text-[10px] text-muted-foreground">← {script.boundCaseId}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50">未绑定</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">执行：</span>
                      <ExecStatusText status={script.execStatus} />
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Card>

        {/* 右栏：视图面板 + Git 工作区 */}
        <Card className="col-span-7 flex flex-col overflow-hidden border-border/50">
          {/* 子视图 Tab */}
          <div className="px-4 pt-3 shrink-0">
            <Tabs value={activeView} onValueChange={v => setActiveView(v as typeof activeView)}>
              <TabsList className="aurora-tab-bar level-2 mb-0">
                {SUB_VIEWS.map(view => {
                  const Icon = view.icon;
                  return (
                    <TabsTrigger key={view.key} value={view.key} className="aurora-tab-item level-2">
                      <Icon className="h-3.5 w-3.5" />
                      {view.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>

          {/* 视图内容 */}
          <div className="flex-1 overflow-auto p-4 min-h-0">
            {/* 绑定关系视图 */}
            {activeView === 'bind' && (
              <BindView case={selectedCase} scripts={boundScripts} />
            )}
            {/* 源文件视图 */}
            {activeView === 'source' && <SourceView />}
            {/* Diff 预览视图 */}
            {activeView === 'diff' && <DiffView />}
            {/* 元文件视图 */}
            {activeView === 'meta' && <MetaView />}
          </div>

          {/* Git 工作区提交面板（底部常驻） */}
          <GitWorkspacePanel />
        </Card>
      </div>

      {/* 手工用例详情弹窗 */}
      <CaseDetailDialog
        caseData={detailCase}
        scripts={detailCase ? MOCK_PYTEST_SCRIPTS.filter(s => s.boundCaseId === detailCase.id) : []}
        onClose={() => setDetailCase(null)}
      />
    </div>
  );
};

// ── 子视图组件 ──

/** 手工用例详情弹窗：展示用例信息 + 关联的自动化脚本 */
const CaseDetailDialog: React.FC<{
  caseData: ManualCase | null;
  scripts: PytestScript[];
  onClose: () => void;
}> = ({ caseData: tc, scripts, onClose }) => {
  if (!tc) return null;

  return (
    <Dialog open={!!tc} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-blue-500">
              {tc.id}
            </span>
            <span className="text-base">{tc.title}</span>
            <GitStatusTag status={tc.gitStatus} />
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {MANUAL_CASE_DIR}{tc.fileName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 px-1">
          {/* 关联需求 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">关联需求：</span>
            <span className="font-medium text-primary">{tc.requirementId}</span>
            <span className="text-foreground">{tc.requirementTitle}</span>
          </div>

          {/* 绑定脚本 */}
          <div>
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              关联的自动化脚本
              <span className="text-xs text-muted-foreground">({scripts.length})</span>
            </div>
            {scripts.length > 0 ? (
              <div className="space-y-2">
                {scripts.map(s => (
                  <div
                    key={s.id}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg border',
                      s.type === 'api'
                        ? 'bg-teal-50 dark:bg-teal-900/15 border-teal-200/50 dark:border-teal-800/50'
                        : 'bg-purple-50 dark:bg-purple-900/15 border-purple-200/50 dark:border-purple-800/50',
                    )}
                  >
                    <ScriptTypeTag type={s.type} />
                    <span className="text-sm font-medium flex-1 truncate">{s.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{AUTO_SCRIPT_DIR}{s.fileName}</span>
                    <ExecStatusText status={s.execStatus} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg border border-dashed border-border/50 text-center text-sm text-muted-foreground">
                暂无关联的自动化脚本
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** 绑定关系视图：展示手工用例与自动化脚本的绑定关系图 */
const BindView: React.FC<{ case: ManualCase | null; scripts: PytestScript[] }> = ({ case: tc, scripts }) => {
  if (!tc) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        请从左侧选择手工用例
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h4 className="font-medium text-sm">{tc.id} 手工用例绑定关系</h4>
      <div className="flex items-center justify-center gap-6">
        {/* 左侧：手工用例卡片 */}
        <div className="w-44 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-300/50 dark:border-blue-700/50">
          <div className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-blue-500 mb-2">
            手工用例 {tc.id}
          </div>
          <div className="text-sm font-medium">{tc.title}</div>
          <div className="text-[11px] text-muted-foreground font-mono mt-2 break-all">
            {MANUAL_CASE_DIR}{tc.fileName}
          </div>
        </div>
        {/* 箭头 */}
        <ArrowRight className="h-5 w-5 text-muted-foreground/40 shrink-0" />
        {/* 右侧：绑定的自动化脚本列表 */}
        <div className="flex flex-col gap-2 w-44">
          {scripts.length > 0 ? scripts.map(s => (
            <div
              key={s.id}
              className={cn(
                'p-3 rounded-lg border',
                s.type === 'api'
                  ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300/50 dark:border-teal-700/50'
                  : 'bg-purple-50 dark:bg-purple-900/20 border-purple-300/50 dark:border-purple-700/50',
              )}
            >
              <ScriptTypeTag type={s.type} />
              <div className="text-sm mt-1">{s.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono mt-1 break-all">
                {AUTO_SCRIPT_DIR}{s.fileName}
              </div>
            </div>
          )) : (
            <div className="p-4 rounded-lg border border-dashed border-border/50 text-center text-xs text-muted-foreground">
              暂无绑定的自动化脚本
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** 源文件视图：展示手工用例 Markdown 内容 */
const SourceView: React.FC = () => (
  <div className="flex flex-col h-full">
    <h4 className="font-medium text-sm mb-3">源文件编辑</h4>
    <div className="border border-border/50 rounded-lg flex-1 bg-muted/30 p-4 font-mono text-sm overflow-auto whitespace-pre-wrap min-h-0">
      {MOCK_SOURCE_CONTENT}
    </div>
  </div>
);

/** Diff 预览视图：展示绑定关系变更 Diff */
const DiffView: React.FC = () => (
  <div className="flex flex-col h-full">
    <h4 className="font-medium text-sm mb-3">Diff 预览</h4>
    <div className="border border-border/50 rounded-lg flex-1 bg-muted/30 p-4 font-mono text-xs overflow-auto whitespace-pre min-h-0">
      {MOCK_DIFF_LINES.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            line.type === 'add' && 'text-green-600 dark:text-green-400',
            line.type === 'del' && 'text-red-600 dark:text-red-400',
          )}
        >
          {line.text}
        </div>
      ))}
    </div>
  </div>
);

/** 元文件视图：展示 case-mapping.yaml 内容 */
const MetaView: React.FC = () => (
  <div className="flex flex-col h-full">
    <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
      <FileText className="h-4 w-4 text-primary" />
      元文件 <span className="font-mono text-xs text-muted-foreground">{CASE_MAPPING_FILE}</span>
    </h4>
    <div className="border border-border/50 rounded-lg flex-1 bg-muted/30 p-4 font-mono text-xs overflow-auto whitespace-pre min-h-0">
      {MOCK_META_CONTENT}
    </div>
  </div>
);

/** Git 工作区提交面板（右栏底部常驻） */
const GitWorkspacePanel: React.FC = () => {
  const [commitMessage, setCommitMessage] = useState('');

  return (
    <div className="border-t border-border/30 p-4 shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-sm flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          Git 工作区待提交变更
        </h4>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs">查看全部 Diff</Button>
        </div>
      </div>
      <Input
        placeholder="Commit message：例如 [AI生成] 角色权限场景用例"
        value={commitMessage}
        onChange={e => setCommitMessage(e.target.value)}
        className="h-8 text-xs mb-3"
      />
      <div className="max-h-24 overflow-y-auto space-y-1.5 text-xs font-mono">
        {MOCK_GIT_CHANGES.map((change, idx) => {
          const config = GIT_STATUS_STYLE[change.status];
          return (
            <div key={idx} className="flex items-center gap-2">
              <span className={cn('inline-block w-14 text-center px-1 py-0.5 rounded text-[10px]', config.bg)}>
                {config.label}
              </span>
              <span className="text-muted-foreground break-all">{change.filePath}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
