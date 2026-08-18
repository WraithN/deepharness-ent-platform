import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Graph, type Node } from '@antv/x6';
import { ChevronRight, Download, GitBranch, Loader2, Maximize, Network, ScanSearch, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { archApi, type ArchDrillLevel, type ArchEdge, type ArchNode, type ArchOverview } from '@/lib/arch-api';
import { repositoryApi } from '@/lib/repository-api';

// ── 常量（配色对齐 DESIGN.md chart 色板）──

const NODE_COLORS: Record<string, string> = {
  library: '#3B82F6',
  module: '#10B981',
  class: '#F59E0B',
  function: '#8B5CF6',
  file: '#94A3B8',
};
const DEFAULT_NODE_COLOR = '#64748B';

const NODE_KIND_LABELS: Record<string, string> = {
  library: '开发库',
  module: '模块',
  class: '类',
  function: '函数',
  file: '文件',
};

const BREADCRUMB_ROOT_LABEL = '架构总览';

// 画布网格布局参数（X6 无自动布局，简单网格即可满足层级视图）。
const GRAPH_NODE_W = 160;
const GRAPH_NODE_H = 56;
const LAYOUT_COLS = 4;
const LAYOUT_GAP_X = 230;
const LAYOUT_GAP_Y = 140;
const LAYOUT_PAD = 40;

// L1 节点小菜单相对节点底部的垂直偏移。
const LIB_MENU_OFFSET_Y = 8;

const SYNC_POLL_INTERVAL_MS = 2000;
const SYNC_POLL_TIMEOUT_MS = 300000;
const PARSE_POLL_INTERVAL_MS = 3000;
const PARSE_POLL_TIMEOUT_MS = 600000;

const EXPORT_FILE_NAME_PREFIX = 'arch-graph';

type PageState = 'loading' | 'not-configured' | 'not-synced' | 'not-parsed' | 'parsing' | 'ready';

/** L1 节点点击弹出的小菜单状态：记录目标开发库节点与菜单在画布容器内的坐标。 */
interface LibMenuState {
  node: ArchNode;
  left: number;
  top: number;
}

/** 架构设计工作台：开发库（L1）/ 模块（L2）/ 类（L3）三层下钻架构可视化。
 *
 * 状态机：loading → not-configured（未配置架构库）/ not-synced（架构库未同步到本地）
 *   / not-parsed（已同步且确认未解析）→ parsing（解析中）→ ready。
 * L1 无节点时需先查 parseStatus 三分：进行中则恢复轮询、已解析则 ready 空态、否则 not-parsed。
 * 数据由后端 GET /v1/workspaces/{id}/arch/graph 按层级聚合，面包屑驱动层级切换，
 * 解析由 POST /arch/parse 触发、GET /arch/parse/status 轮询进度。
 */
export const ArchDesignWorkspace: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [drillLevel, setDrillLevel] = useState<ArchDrillLevel>('libraries');
  const [selectedLib, setSelectedLib] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [nodes, setNodes] = useState<ArchNode[]>([]);
  const [edges, setEdges] = useState<ArchEdge[]>([]);
  const [overview, setOverview] = useState<ArchOverview | null>(null);
  const [showOverview, setShowOverview] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<ArchNode | null>(null);
  const [libMenu, setLibMenu] = useState<LibMenuState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [repoId, setRepoId] = useState('');
  const [repoName, setRepoName] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  // 解析轮询的定时器句柄，集中存放以便组件卸载时统一清理。
  const parseTimersRef = useRef<{ poll?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout> }>({});
  // 组件挂载标记：异步回调（解析状态查询/恢复轮询）落地前检查，避免卸载后 setState 或遗留轮询。
  const mountedRef = useRef(true);

  // 加载当前层级的架构图数据，并按响应推进页面状态机。
  const loadGraph = useCallback(() => {
    if (!workspaceId) return;
    archApi.graph(workspaceId, { level: drillLevel, lib: selectedLib, module: selectedModule })
      .then(res => {
        if (res.repoId) setRepoId(res.repoId);
        if (res.repoName) setRepoName(res.repoName);
        if (!res.configured) { setPageState('not-configured'); return; }
        if (!res.cloned) { setPageState('not-synced'); return; }
        // 后端 nodes/edges/warnings 无 omitempty，空时序列化为 null，需防御。
        const resNodes = res.nodes ?? [];
        const warnings = res.warnings ?? [];
        // L1 总览无节点且无警告时，不能直接判定 not-parsed：
        // 可能是解析中途离开本页再返回（后台仍在解析），也可能是已解析但 0 个开发库，
        // 需先查一次 parseStatus 三分（见 resolveEmptyLibraries）。
        if (drillLevel === 'libraries' && resNodes.length === 0 && warnings.length === 0) {
          // 先清空旧层级数据，避免状态确认期间画布残留上一层的节点。
          setNodes([]);
          setEdges([]);
          resolveEmptyLibraries();
          return;
        }
        setNodes(resNodes);
        setEdges(res.edges ?? []);
        // 解析警告不阻断出图，逐条提示用户。
        warnings.forEach(w => toast.warning(w));
        setPageState('ready');
      })
      .catch(err => {
        console.error('[ArchDesign] load graph failed:', err);
        toast.error('加载架构图失败');
      });
  }, [workspaceId, drillLevel, selectedLib, selectedModule]);

  useEffect(loadGraph, [loadGraph]);

  // ── 下钻与面包屑 ──

  // 下钻到模块层（L1 开发库 → L2 模块）。
  const drillToModules = (libKey: string) => {
    setSelectedLib(libKey);
    setDrillLevel('modules');
    setSelectedModule('');
    setLibMenu(null);
    setShowOverview(false);
  };

  // 下钻到类层（L2 模块 → L3 类）。
  const drillToClasses = useCallback((moduleKey: string) => {
    setSelectedModule(moduleKey);
    setDrillLevel('classes');
  }, []);

  // 面包屑回退：回 L1 时清空开发库与模块选择，回 L2 时仅清空模块选择。
  const drillBack = (to: ArchDrillLevel) => {
    setDrillLevel(to);
    if (to === 'libraries') { setSelectedLib(''); setSelectedModule(''); }
    if (to === 'modules') setSelectedModule('');
    setSelectedNode(null);
    setLibMenu(null);
    setShowOverview(false);
  };

  // ── 开发库介绍抽屉 ──

  const openOverview = (libKey: string) => {
    if (!workspaceId) return;
    setLibMenu(null);
    archApi.overview(workspaceId, libKey)
      .then(ov => { setOverview(ov); setShowOverview(true); })
      .catch(() => toast.error('加载介绍失败'));
  };

  // ── 解析触发（not-parsed → parsing → ready/not-parsed）──

  const clearParseTimers = () => {
    if (parseTimersRef.current.poll) clearInterval(parseTimersRef.current.poll);
    if (parseTimersRef.current.timeout) clearTimeout(parseTimersRef.current.timeout);
    parseTimersRef.current = {};
  };

  // 组件卸载时复位挂载标记并清理解析轮询定时器，避免卸载后的 setState 与定时器泄漏。
  useEffect(() => () => {
    mountedRef.current = false;
    clearParseTimers();
  }, []);

  // 结束解析流程：成功则回 L1 重新出图；失败/超时则退回 not-parsed 并提示。
  const stopParsing = (result: 'success' | 'failed' | 'timeout', detail?: string) => {
    clearParseTimers();
    setParsing(false);
    if (result === 'success') {
      setDrillLevel('libraries');
      setSelectedLib('');
      setSelectedModule('');
      loadGraph();
      return;
    }
    setPageState('not-parsed');
    if (result === 'timeout') {
      toast.warning('解析超时，请稍后重试或检查 agent 状态');
      return;
    }
    toast.error('解析失败：' + (detail ?? '未知错误'));
  };

  // 轮询解析状态：parsed=true 完成；锁已清（parsing=false）但未 parsed，说明解析进程异常结束。
  const pollParseStatus = () => {
    if (!workspaceId) return;
    archApi.parseStatus(workspaceId)
      .then(st => {
        if (st.parsed) { stopParsing('success'); return; }
        if (!st.parsing) {
          const warnings = st.warnings ?? [];
          stopParsing('failed', warnings.length ? warnings.join('; ') : undefined);
        }
      })
      .catch(() => { /* 轮询失败下一轮重试 */ });
  };

  // 启动解析轮询：先清理旧定时器再启动，天然幂等，重复调用不会产生重复轮询。
  // handleParse（手动触发）与 resolveEmptyLibraries（恢复进行中的解析）共用。
  const startParsePolling = () => {
    if (!mountedRef.current) return;
    clearParseTimers();
    parseTimersRef.current.poll = setInterval(pollParseStatus, PARSE_POLL_INTERVAL_MS);
    parseTimersRef.current.timeout = setTimeout(() => stopParsing('timeout'), PARSE_POLL_TIMEOUT_MS);
  };

  // L1 空节点时查询一次解析状态做三分（修复 I-1 / ⚠️-1）：
  // - parsing=true：后台解析仍在进行（如解析中途离开本页再返回），恢复 parsing 态并重启轮询；
  // - parsed=true：已解析但暂无可展示的开发库，进入 ready 空态，避免误判 not-parsed 造成死循环；
  // - 其余：确认为未解析，展示「解析开发库」入口。
  const resolveEmptyLibraries = () => {
    if (!workspaceId) return;
    archApi.parseStatus(workspaceId)
      .then(st => {
        if (!mountedRef.current) return;
        if (st.parsing) {
          setParsing(true);
          setPageState('parsing');
          startParsePolling();
          return;
        }
        if (st.parsed) { setPageState('ready'); return; }
        setPageState('not-parsed');
      })
      // 状态查询失败时保守落入 not-parsed，用户可手动触发解析重试。
      .catch(() => { if (mountedRef.current) setPageState('not-parsed'); });
  };

  const handleParse = () => {
    if (!workspaceId || parsing) return;
    setParsing(true);
    setPageState('parsing');
    archApi.parse(workspaceId)
      .then(startParsePolling)
      .catch(err => {
        setParsing(false);
        setPageState('not-parsed');
        toast.error('解析失败：' + (err instanceof Error ? err.message : '未知错误'));
      });
  };

  // ── 架构库同步（not-synced）──

  const handleSyncPollTick = (
    poll: ReturnType<typeof setInterval>,
    timeout: ReturnType<typeof setTimeout>,
  ) => {
    repositoryApi.listUserRepos(workspaceId)
      .then(statuses => {
        const status = statuses.find(s => s.repositoryId === repoId);
        if (!status) return;
        if (status.synced) {
          clearInterval(poll);
          clearTimeout(timeout);
          setSyncing(false);
          setPageState('loading');
          loadGraph();
          return;
        }
        if (status.syncStatus === 'failed') {
          clearInterval(poll);
          clearTimeout(timeout);
          setSyncing(false);
          toast.error('同步架构库失败：' + (status.errorMessage ?? '未知错误'));
        }
      })
      .catch(() => { /* 轮询失败下一轮重试 */ });
  };

  // 同步架构库到本地后自动重新加载。
  const handleSync = () => {
    if (!repoId) return;
    setSyncing(true);
    repositoryApi.syncUserRepo(workspaceId, repoId)
      .then(() => {
        let poll: ReturnType<typeof setInterval>;
        const timeout = setTimeout(() => {
          clearInterval(poll);
          setSyncing(false);
          // 同步超时：可能 clone 卡住（如 SSH 认证挂起）或后端状态未及时更新。
          // 重新加载一次确认最终状态，避免用户停留在"同步中"假死。
          toast.warning('同步架构库超时，正在确认最终状态...');
          setPageState('loading');
          loadGraph();
        }, SYNC_POLL_TIMEOUT_MS);
        poll = setInterval(() => {
          handleSyncPollTick(poll, timeout);
        }, SYNC_POLL_INTERVAL_MS);
      })
      .catch(err => {
        setSyncing(false);
        toast.error('同步架构库失败：' + (err instanceof Error ? err.message : '未知错误'));
      });
  };

  // ── 节点点击交互（按层级分发）──

  // L1 开发库节点点击：在节点下方弹出小菜单（查看介绍 / 下钻模块）。
  // 菜单坐标 = 节点画布坐标经缩放/平移变换（localToClient）后换算为画布容器内偏移。
  const openLibMenu = useCallback((data: ArchNode, node: Node, graph: Graph) => {
    if (!sectionRef.current) return;
    const { x, y } = node.getPosition();
    const client = graph.localToClient(x, y + GRAPH_NODE_H);
    const rect = sectionRef.current.getBoundingClientRect();
    setLibMenu({ node: data, left: client.x - rect.left, top: client.y - rect.top + LIB_MENU_OFFSET_Y });
  }, []);

  const handleNodeClick = useCallback((node: Node, graph: Graph) => {
    const data = node.getData<ArchNode>();
    if (!data) return;
    setLibMenu(null);
    setSelectedNode(null);
    if (drillLevel === 'libraries') { openLibMenu(data, node, graph); return; }
    if (drillLevel === 'modules') { drillToClasses(data.id); return; }
    // L3 类节点：右侧详情抽屉。
    setSelectedNode(data);
  }, [drillLevel, openLibMenu, drillToClasses]);

  // 渲染 X6 画布：节点网格布局 + 依赖边；层级数据变化时整体重渲染。
  useEffect(() => {
    if (pageState !== 'ready' || !containerRef.current) return;
    // 容器隐藏时不创建 Graph，避免渲染尺寸为 0 导致坐标计算错误（同 FlowGraph）。
    if (containerRef.current.offsetWidth === 0 || containerRef.current.offsetHeight === 0) return;
    graphRef.current?.dispose();
    const graph = new Graph({
      container: containerRef.current,
      panning: true,
      mousewheel: { enabled: true, modifiers: 'ctrl', factor: 1.1 },
      grid: { size: 12, visible: true },
    });
    graph.on('node:click', ({ node }) => handleNodeClick(node, graph));
    // 点击画布空白处关闭 L1 小菜单。
    graph.on('blank:click', () => setLibMenu(null));
    nodes.forEach((n, idx) => {
      graph.addNode({
        id: n.id,
        x: LAYOUT_PAD + (idx % LAYOUT_COLS) * LAYOUT_GAP_X,
        y: LAYOUT_PAD + Math.floor(idx / LAYOUT_COLS) * LAYOUT_GAP_Y,
        width: GRAPH_NODE_W,
        height: GRAPH_NODE_H,
        shape: 'rect',
        label: n.label,
        attrs: {
          body: { fill: NODE_COLORS[n.kind] ?? DEFAULT_NODE_COLOR, rx: 6, ry: 6 },
          text: { fill: '#ffffff', fontSize: 12 },
        },
        data: n,
      });
    });
    edges.forEach(e => {
      graph.addEdge({
        source: e.source,
        target: e.target,
        label: e.label,
        attrs: {
          line: { stroke: '#94A3B8', strokeWidth: 1.5 },
          label: { fill: '#64748B', fontSize: 11 },
        },
      });
    });
    graph.zoomToFit({ padding: LAYOUT_PAD });
    graphRef.current = graph;
    return () => graph.dispose();
  }, [pageState, nodes, edges, handleNodeClick]);

  // 导出当前层级的节点与边为 JSON。
  const handleExport = () => {
    const payload = { drillLevel, lib: selectedLib || undefined, module: selectedModule || undefined, nodes, edges };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${EXPORT_FILE_NAME_PREFIX}-${drillLevel}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetCanvasView = () => graphRef.current?.zoomToFit({ padding: LAYOUT_PAD });

  if (pageState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">正在加载架构图...</span>
      </div>
    );
  }

  if (pageState === 'not-configured') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <Network className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">未配置架构库</p>
        <p className="text-xs text-muted-foreground max-w-md">
          在空间设置中添加一个类型为「架构库」的代码仓库后，即可对所有开发库进行架构解析与可视化。
        </p>
        <Button size="sm" onClick={() => navigate('/settings')}>前往空间设置</Button>
      </div>
    );
  }

  if (pageState === 'not-synced') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">架构库「{repoName}」尚未同步到本地</p>
        <p className="text-xs text-muted-foreground">同步后即可进行架构解析与可视化。</p>
        <Button size="sm" disabled={syncing} onClick={handleSync}>
          {syncing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}同步架构库
        </Button>
      </div>
    );
  }

  if (pageState === 'not-parsed') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <ScanSearch className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">架构库「{repoName}」尚未解析</p>
        <p className="text-xs text-muted-foreground max-w-md">
          解析开发库后，即可按「开发库 → 模块 → 类」三层查看全局架构。
        </p>
        <Button size="sm" disabled={parsing} onClick={handleParse}>
          {parsing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}解析开发库
        </Button>
      </div>
    );
  }

  if (pageState === 'parsing') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm font-medium text-foreground">解析中...</p>
        <p className="text-xs">正在解析开发库架构，可能需要几分钟，请稍候。</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {/* 顶部面包屑与操作栏 */}
      <header className="h-11 shrink-0 border-b border-border bg-card flex items-center px-4 gap-2 text-sm">
        <nav className="flex items-center gap-1 min-w-0">
          {drillLevel === 'libraries' ? (
            <span className="font-medium text-foreground">{BREADCRUMB_ROOT_LABEL}</span>
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:text-primary cursor-pointer"
              onClick={() => drillBack('libraries')}
            >
              {BREADCRUMB_ROOT_LABEL}
            </button>
          )}
          {drillLevel !== 'libraries' && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              {drillLevel === 'modules' ? (
                <span className="font-medium text-foreground truncate">{selectedLib}</span>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-primary cursor-pointer truncate"
                  onClick={() => drillBack('modules')}
                >
                  {selectedLib}
                </button>
              )}
            </>
          )}
          {drillLevel === 'classes' && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="font-medium text-foreground truncate">{selectedModule}</span>
            </>
          )}
        </nav>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-8" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1" />导出当前层
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={resetCanvasView}>
          <Maximize className="h-3.5 w-3.5 mr-1" />重置画布
        </Button>
      </header>

      {/* 画布区域 */}
      <section ref={sectionRef} className="flex-1 relative min-w-0 min-h-0">
        <div className="absolute top-3 left-3 z-10 bg-popover border shadow-md rounded-md px-3 py-1.5 flex gap-4 items-center text-muted-foreground">
          <ZoomIn className="h-4 w-4 cursor-pointer hover:text-primary" onClick={() => graphRef.current?.zoom(1.1)} />
          <ZoomOut className="h-4 w-4 cursor-pointer hover:text-primary" onClick={() => graphRef.current?.zoom(0.9)} />
          <Maximize className="h-4 w-4 cursor-pointer hover:text-primary" onClick={resetCanvasView} />
        </div>
        {nodes.length === 0 && drillLevel === 'libraries' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Network className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm">架构库已解析，暂无可展示的开发库</p>
            <p className="text-xs">请确认工程目录下存在开发库后重新解析。</p>
          </div>
        )}
        {nodes.length === 0 && drillLevel !== 'libraries' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Network className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm">当前层级暂无架构数据</p>
            <p className="text-xs">可回退上一层级查看，或联系管理员确认解析结果。</p>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full bg-muted/20" />

        {/* L1 开发库节点小菜单：查看介绍 / 下钻模块 */}
        {libMenu && (
          <div
            className="absolute z-30 bg-popover border shadow-lg rounded-md p-1.5 w-32 space-y-0.5"
            style={{ left: libMenu.left, top: libMenu.top }}
          >
            <div className="px-2 py-1 text-xs font-medium text-foreground truncate">{libMenu.node.label}</div>
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => openOverview(libMenu.node.id)}
            >
              查看介绍
            </button>
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => drillToModules(libMenu.node.id)}
            >
              下钻模块
            </button>
          </div>
        )}

        {/* 开发库介绍抽屉 */}
        {showOverview && overview && (
          <div className="absolute inset-0 z-20">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowOverview(false)} />
            <div className="absolute right-0 top-0 bottom-0 w-96 bg-popover border-l shadow-xl p-4 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-base text-foreground">{overview.name || overview.key}</h3>
                <X className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setShowOverview(false)} />
              </div>
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">定位</div>
                  <p className="leading-relaxed">{overview.positioning || '-'}</p>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">架构</div>
                  <p className="leading-relaxed whitespace-pre-wrap">{overview.architecture || '-'}</p>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">技术栈</div>
                  {/* 后端 techStack/coreModules 无 omitempty，空时可能序列化为 null，需防御。 */}
                  {(overview.techStack ?? []).length === 0 ? (
                    <p className="text-muted-foreground">-</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(overview.techStack ?? []).map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-sm bg-secondary text-secondary-foreground text-xs">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">核心模块</div>
                  {(overview.coreModules ?? []).length === 0 ? (
                    <p className="text-muted-foreground">-</p>
                  ) : (
                    <div className="space-y-1">
                      {(overview.coreModules ?? []).map(m => (
                        <div key={m.key} className="flex py-1.5 border-b border-border">
                          <div className="w-32 shrink-0 font-medium truncate">{m.key}</div>
                          <div className="flex-1 text-muted-foreground break-all">{m.role || '-'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* L3 节点详情抽屉 */}
        {selectedNode && (
          <div className="absolute inset-0 z-20">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedNode(null)} />
            <div className="absolute right-0 top-0 bottom-0 w-80 bg-popover border-l shadow-xl p-4 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-base text-foreground">{selectedNode.label}</h3>
                <X className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setSelectedNode(null)} />
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex py-1.5 border-b border-border">
                  <div className="w-20 text-muted-foreground shrink-0">节点类型</div>
                  <div className="flex-1">{NODE_KIND_LABELS[selectedNode.kind] ?? selectedNode.kind}</div>
                </div>
                {Object.entries(selectedNode.meta ?? {}).map(([k, v]) => (
                  <div key={k} className="flex py-1.5 border-b border-border">
                    <div className="w-20 text-muted-foreground shrink-0">{k}</div>
                    <div className="flex-1 break-all">{v || '-'}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <Button className="w-full" onClick={() => navigate('/personal-space?tab=code')}>跳转至工程仓库</Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
