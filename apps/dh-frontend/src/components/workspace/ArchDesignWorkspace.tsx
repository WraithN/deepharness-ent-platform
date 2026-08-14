import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Graph } from '@antv/x6';
import { Download, Filter, GitBranch, Loader2, Maximize, Network, RefreshCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  archApi,
  type ArchEdgeKind,
  type ArchGraphResponse,
  type ArchNode,
  type ArchView,
  type ArchViewMode,
} from '@/lib/arch-api';
import { repositoryApi } from '@/lib/repository-api';

// ── 常量（配色对齐 DESIGN.md chart 色板）──

const NODE_COLORS: Record<ArchNode['kind'], string> = {
  repo: '#3B82F6',
  service: '#F59E0B',
  domain: '#10B981',
  infra: '#94A3B8',
};

const NODE_KIND_LABELS: Record<ArchNode['kind'], string> = {
  repo: '业务仓库',
  service: '微服务',
  domain: '业务领域',
  infra: '基础组件',
};

const EDGE_KIND_LABELS: Record<ArchEdgeKind, string> = {
  rpc: 'RPC调用',
  mq: 'MQ消息',
  db: 'DB共享',
};

const EDGE_KINDS: ArchEdgeKind[] = ['rpc', 'mq', 'db'];

const VIEW_MODE_OPTIONS: { value: ArchViewMode; label: string }[] = [
  { value: 'project', label: '工程全景（仓库维度）' },
  { value: 'service', label: '服务依赖视图（微服务）' },
  { value: 'ddd', label: '业务领域视图（DDD）' },
];

const ALL_BUSINESS_LINE = '__all__';

// 画布网格布局参数（X6 无自动布局，简单网格即可满足全局视图）。
const GRAPH_NODE_W = 160;
const GRAPH_NODE_H = 56;
const LAYOUT_COLS = 4;
const LAYOUT_GAP_X = 230;
const LAYOUT_GAP_Y = 140;
const LAYOUT_PAD = 40;

const SYNC_POLL_INTERVAL_MS = 2000;
const EXPORT_FILE_NAME = 'arch-graph.json';

// 「重新全局解析」预填到会话的指令：引导 agent 使用 arch-repo-analysis 技能解析全部工程仓库。
const buildParsePrompt = (repoName: string) =>
  `请阅读共享目录 shares/skills/arch-repo-analysis/SKILL.md 技能说明，按照其规范对 dev-jobs/ 目录下的全部工程仓库进行架构解析，` +
  `并将结果写入架构库 dev-jobs/${repoName}（domains/、services/、relations/、observed/ 等目录）。`;

type PageState = 'loading' | 'not-configured' | 'not-synced' | 'ready';

/** 架构设计工作台：以架构库（type=arch 的仓库）YAML 元数据为数据源的全局架构可视化。
 *
 * 状态机：loading → not-configured（未配置架构库）/ not-synced（架构库未同步到本地）/ ready。
 * 视图数据由后端 GET /v1/workspaces/{id}/arch/graph 聚合（工程全景/服务依赖/业务领域三视图）。
 */
export const ArchDesignWorkspace: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [graphData, setGraphData] = useState<ArchGraphResponse | null>(null);
  const [viewMode, setViewMode] = useState<ArchViewMode>('project');
  const [edgeKindFilter, setEdgeKindFilter] = useState<Record<ArchEdgeKind, boolean>>({ rpc: true, mq: true, db: true });
  const [businessLine, setBusinessLine] = useState<string>(ALL_BUSINESS_LINE);
  const [selectedNode, setSelectedNode] = useState<ArchNode | null>(null);
  const [syncing, setSyncing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  // 加载架构图数据并按响应进入对应状态。
  const loadGraph = useCallback(() => {
    if (!workspaceId) return;
    archApi.graph(workspaceId)
      .then(res => {
        setGraphData(res);
        if (!res.configured) setPageState('not-configured');
        else if (!res.cloned) setPageState('not-synced');
        else setPageState('ready');
      })
      .catch(err => {
        console.error('[ArchDesign] load graph failed:', err);
        toast.error('加载架构图失败');
      });
  }, [workspaceId]);

  useEffect(loadGraph, [loadGraph]);

  // 当前视图经筛选后的节点与边：业务线过滤节点，依赖类型过滤边，悬空边剔除。
  const filteredView = useMemo<ArchView>(() => {
    const view = graphData?.views?.[viewMode];
    if (!view) return { nodes: [], edges: [] };
    // 后端空仓库场景下 buildArchGraph 返回的 nodes/edges 可能为 null，需防御。
    const allNodes = view.nodes ?? [];
    const nodes = businessLine === ALL_BUSINESS_LINE
      ? allNodes
      : allNodes.filter(n => n.businessLine === businessLine);
    const nodeIds = new Set(nodes.map(n => n.id));
    const allEdges = view.edges ?? [];
    const edges = allEdges.filter(e => edgeKindFilter[e.kind] && nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes, edges };
  }, [graphData, viewMode, businessLine, edgeKindFilter]);

  // 渲染 X6 画布：节点网格布局 + 依赖边；数据或筛选变化时整体重渲染。
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
    graph.on('node:click', ({ node }) => setSelectedNode(node.getData<ArchNode>()));
    filteredView.nodes.forEach((n, idx) => {
      graph.addNode({
        id: n.id,
        x: LAYOUT_PAD + (idx % LAYOUT_COLS) * LAYOUT_GAP_X,
        y: LAYOUT_PAD + Math.floor(idx / LAYOUT_COLS) * LAYOUT_GAP_Y,
        width: GRAPH_NODE_W,
        height: GRAPH_NODE_H,
        shape: 'rect',
        label: n.label,
        attrs: {
          body: { fill: NODE_COLORS[n.kind], rx: 6, ry: 6 },
          text: { fill: '#ffffff', fontSize: 12 },
        },
        data: n,
      });
    });
    filteredView.edges.forEach(e => {
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
  }, [pageState, filteredView]);

  const SYNC_POLL_TIMEOUT_MS = 300000;

  const handlePollTick = (
    poll: ReturnType<typeof setInterval>,
    timeout: ReturnType<typeof setTimeout>,
  ) => {
    repositoryApi.listUserRepos(workspaceId)
      .then(statuses => {
        const status = statuses.find(s => s.repositoryId === graphData!.repoId);
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
    if (!graphData?.repoId) return;
    setSyncing(true);
    repositoryApi.syncUserRepo(workspaceId, graphData.repoId)
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
          handlePollTick(poll, timeout);
        }, SYNC_POLL_INTERVAL_MS);
      })
      .catch(err => {
        setSyncing(false);
        toast.error('同步架构库失败：' + (err instanceof Error ? err.message : '未知错误'));
      });
  };

  // 重新全局解析：跳转会话并预填指令，由 agent 执行 arch-repo-analysis 技能写回架构库。
  const handleReparse = () => {
    navigate('/chat', { state: { initialInput: buildParsePrompt(graphData?.repoName ?? 'arch-repo') } });
  };

  // 导出架构报告：当前三视图数据下载为 JSON。
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(graphData?.views ?? {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILE_NAME;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 图例仅展示当前视图实际出现的节点类型。
  const legendKinds = useMemo(
    () => [...new Set(filteredView.nodes.map(n => n.kind))],
    [filteredView],
  );

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
          在空间设置中添加一个类型为「架构库」的代码仓库后，即可对所有工程仓库进行全局架构解析与可视化。
        </p>
        <Button size="sm" onClick={() => navigate('/settings')}>前往空间设置</Button>
      </div>
    );
  }

  if (pageState === 'not-synced') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">架构库「{graphData?.repoName}」尚未同步到本地</p>
        <p className="text-xs text-muted-foreground">同步后即可查看全局架构图。</p>
        <Button size="sm" disabled={syncing} onClick={handleSync}>
          {syncing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}同步架构库
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-0 relative">
      {/* 左侧筛选面板 */}
      <aside className="w-64 shrink-0 border-r border-border bg-card p-4 overflow-y-auto">
        <div className="font-medium mb-4 flex justify-between items-center text-sm">
          <span>全局架构筛选</span>
          <Filter className="h-4 w-4 text-primary" />
        </div>

        <div className="mb-5">
          <div className="text-xs text-muted-foreground mb-2">视图模式</div>
          <RadioGroup value={viewMode} onValueChange={v => setViewMode(v as ArchViewMode)} className="space-y-2">
            {VIEW_MODE_OPTIONS.map(opt => (
              <div key={opt.value} className="flex items-center gap-2">
                <RadioGroupItem value={opt.value} id={`view-${opt.value}`} />
                <Label htmlFor={`view-${opt.value}`} className="text-sm font-normal cursor-pointer">{opt.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="mb-5">
          <div className="text-xs text-muted-foreground mb-2">依赖过滤</div>
          <div className="space-y-1.5">
            {EDGE_KINDS.map(kind => (
              <div key={kind} className="flex items-center gap-2">
                <Checkbox
                  id={`edge-${kind}`}
                  checked={edgeKindFilter[kind]}
                  onCheckedChange={checked => setEdgeKindFilter(prev => ({ ...prev, [kind]: checked === true }))}
                />
                <Label htmlFor={`edge-${kind}`} className="text-sm font-normal cursor-pointer">{EDGE_KIND_LABELS[kind]}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <div className="text-xs text-muted-foreground mb-2">业务线筛选</div>
          <Select value={businessLine} onValueChange={setBusinessLine}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BUSINESS_LINE}>全部业务线</SelectItem>
              {(graphData?.domains ?? []).map(d => (
                <SelectItem key={d.key} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-5">
          <div className="text-xs text-muted-foreground mb-2">图例</div>
          <div className="space-y-2 text-xs">
            {legendKinds.map(kind => (
              <div key={kind} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: NODE_COLORS[kind] }} />
                <span>{NODE_KIND_LABELS[kind]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 mt-6">
          <Button size="sm" className="w-full" onClick={handleReparse}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />重新全局解析
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" />导出架构报告
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => graphRef.current?.zoomToFit({ padding: LAYOUT_PAD })}>
            <Maximize className="h-3.5 w-3.5 mr-1" />重置画布视图
          </Button>
        </div>
      </aside>

      {/* 右侧画布区域 */}
      <section className="flex-1 relative min-w-0">
        <div className="absolute top-3 left-3 z-10 bg-popover border shadow-md rounded-md px-3 py-1.5 flex gap-4 items-center text-muted-foreground">
          <ZoomIn className="h-4 w-4 cursor-pointer hover:text-primary" onClick={() => graphRef.current?.zoom(1.1)} />
          <ZoomOut className="h-4 w-4 cursor-pointer hover:text-primary" onClick={() => graphRef.current?.zoom(0.9)} />
          <Maximize className="h-4 w-4 cursor-pointer hover:text-primary" onClick={() => graphRef.current?.zoomToFit({ padding: LAYOUT_PAD })} />
        </div>
        {filteredView.nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Network className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm">架构库暂无架构元数据</p>
            <p className="text-xs">点击左侧「重新全局解析」，由 agent 解析全部工程仓库并生成。</p>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full bg-muted/20" />

        {/* 节点详情抽屉 */}
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
                  <div className="flex-1">{NODE_KIND_LABELS[selectedNode.kind]}</div>
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
