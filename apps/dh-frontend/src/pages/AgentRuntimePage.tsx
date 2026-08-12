import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Cpu, Eye, MemoryStick, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import MultiSelect from '@/components/ui/multi-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  agentRuntimeApi,
  DEFAULT_RUNTIME_PAGE_SIZE,
  type AgentRuntime,
  type AgentInstance,
  type RuntimeStatus,
  RUNTIME_STATUS_LABELS,
  AGENT_TYPE_LABELS,
} from '@/lib/agent-runtime-api';
import { tenantApi } from '@/lib/tenant-api';
import { workspaceApi } from '@/lib/workspace-api';
import { api } from '@/lib/api';
import type { UserDTO } from '@/lib/api-types';

interface FilterState {
  tenantId: string[];
  workspaceId: string[];
  userId: string[];
  agentType: string[];
}

const STATUS_VARIANTS: Record<RuntimeStatus, string> = {
  running: 'bg-emerald-500',
  error: 'bg-rose-500',
  stopped: 'bg-slate-400',
  'resource_warning': 'bg-amber-500',
};

const STATUS_BADGE_VARIANTS: Record<RuntimeStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  error: 'destructive',
  stopped: 'secondary',
  'resource_warning': 'outline',
};

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getAgentTypeClass(type: string): string {
  switch (type) {
    case 'opencode':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'codex':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
    case 'claude-code':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export const AgentRuntimePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runtimes, setRuntimes] = useState<AgentRuntime[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = DEFAULT_RUNTIME_PAGE_SIZE;
  const [selectedRuntime, setSelectedRuntime] = useState<AgentRuntime | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerAgentFilter, setDrawerAgentFilter] = useState<string>('all');

  const [filter, setFilter] = useState<FilterState>({
    tenantId: searchParams.getAll('tenantId'),
    workspaceId: searchParams.getAll('workspaceId'),
    userId: searchParams.getAll('userId'),
    agentType: searchParams.getAll('agentType'),
  });

  // 筛选项来源：从 dh-backend 数据库查询，而非上报数据
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<UserDTO[]>([]);

  useEffect(() => {
    tenantApi.list().then(setTenants).catch(() => {});
    workspaceApi.list('', 1, 100).then((res) => setWorkspaces(res.list ?? [])).catch(() => {});
    api.get<UserDTO[]>('/v1/identity/users').then(setUsers).catch(() => {});
  }, []);

  const loadRuntimes = async () => {
    setLoading(true);
    try {
      const result = await agentRuntimeApi.list({
        tenantId: filter.tenantId[0],
        workspaceId: filter.workspaceId[0],
        userId: filter.userId[0],
        agentType: filter.agentType[0],
        page,
        pageSize,
      });
      setRuntimes(result.list ?? []);
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载运行时列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRuntimes();
  }, [filter.tenantId[0], filter.workspaceId[0], filter.userId[0], filter.agentType[0], page]);

  // 筛选条件变化时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [filter.tenantId[0], filter.workspaceId[0], filter.userId[0], filter.agentType[0]]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter.tenantId[0]) params.set('tenantId', filter.tenantId[0]);
    if (filter.workspaceId[0]) params.set('workspaceId', filter.workspaceId[0]);
    if (filter.userId[0]) params.set('userId', filter.userId[0]);
    if (filter.agentType[0]) params.set('agentType', filter.agentType[0]);
    if (page > 1) params.set('page', String(page));
    setSearchParams(params, { replace: true });
  }, [filter, page]);

  const tenantOptions = useMemo(
    () => tenants.map((t) => ({ value: t.id, label: t.name || t.id })),
    [tenants],
  );

  const workspaceOptions = useMemo(
    () => workspaces.map((w) => ({ value: w.id, label: w.name || w.id })),
    [workspaces],
  );

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.name || u.id })),
    [users],
  );
  // 智能体类型选项使用固定列表（gatewayd 支持的三种类型），
  // 避免从当前页数据派生导致筛选后选项消失的问题。
  const agentTypeOptions = useMemo(
    () => Object.entries(AGENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  const handleReset = () => {
    setFilter({ tenantId: [], workspaceId: [], userId: [], agentType: [] });
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openDrawer = (rt: AgentRuntime) => {
    setSelectedRuntime(rt);
    setDrawerAgentFilter('all');
    setDrawerOpen(true);
  };

  const filteredDrawerAgents = useMemo(() => {
    if (!selectedRuntime) return [];
    if (drawerAgentFilter === 'all') return selectedRuntime.agents;
    return selectedRuntime.agents.filter((a) => a.type === drawerAgentFilter);
  }, [selectedRuntime, drawerAgentFilter]);

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <Card className="relative z-20 soft-shadow border border-border/50">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-2">所属租户</label>
              <MultiSelect
                options={tenantOptions}
                value={filter.tenantId}
                placeholder="全部租户"
                triggerClassName="h-9 px-3 py-0 text-sm"
                onChange={(value) => setFilter((prev) => ({ ...prev, tenantId: value.slice(0, 1) }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-2">工作空间</label>
              <MultiSelect
                options={workspaceOptions}
                value={filter.workspaceId}
                placeholder="全部空间"
                triggerClassName="h-9 px-3 py-0 text-sm"
                onChange={(value) => setFilter((prev) => ({ ...prev, workspaceId: value.slice(0, 1) }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-2">所属成员</label>
              <MultiSelect
                options={userOptions}
                value={filter.userId}
                placeholder="全部成员"
                triggerClassName="h-9 px-3 py-0 text-sm"
                onChange={(value) => setFilter((prev) => ({ ...prev, userId: value.slice(0, 1) }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-2">智能体类型</label>
              <MultiSelect
                options={agentTypeOptions}
                value={filter.agentType}
                placeholder="全部类型"
                triggerClassName="h-9 px-3 py-0 text-sm"
                onChange={(value) => setFilter((prev) => ({ ...prev, agentType: value.slice(0, 1) }))}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                className="flex-1 h-9 px-4 btn-primary-glow text-sm"
                onClick={loadRuntimes}
                disabled={loading}
              >
                {loading ? <RefreshCcw className="h-4 w-4 mr-2 animate-spin" /> : null}
                筛选
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-9 px-4 text-sm bg-muted text-foreground hover:bg-muted/80 hover:scale-[1.02] active:scale-[0.98] transition-transform"
                onClick={handleReset}
                disabled={loading}
              >
                重置
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 运行时列表 */}
      <Card className="soft-shadow border border-border/50 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              运行时列表 ({total})
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">点击行或智能体标签可下钻查看详情</p>
          </div>
          <Button variant="outline" size="sm" onClick={loadRuntimes} disabled={loading}>
            <RefreshCcw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            刷新
          </Button>
        </CardHeader>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="px-4">运行时ID</TableHead>
                <TableHead className="px-4">IP</TableHead>
                <TableHead className="px-4">所属成员</TableHead>
                <TableHead className="px-4">工作空间</TableHead>
                <TableHead className="px-4">所属租户</TableHead>
                <TableHead className="px-4">智能体</TableHead>
                <TableHead className="px-4">状态</TableHead>
                <TableHead className="px-4">运行时长</TableHead>
                <TableHead className="px-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && runtimes.length === 0 && (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9} className="px-4 py-6">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              )}
              {!loading && runtimes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    暂无运行时数据
                  </TableCell>
                </TableRow>
              )}
              {runtimes.map((rt) => (
                <TableRow
                  key={rt.runtimeId}
                  className="cursor-pointer"
                  onClick={() => openDrawer(rt)}
                >
                  <TableCell className="px-4 font-mono text-foreground/80">
                    <span className="inline-block max-w-[200px] truncate align-bottom" title={rt.runtimeId}>
                      {rt.runtimeId}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 font-mono text-xs text-muted-foreground">{rt.ip || '-'}</TableCell>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">
                        {(rt.userDisplayName || rt.userName || '?').charAt(0)}
                      </div>
                      <span>{rt.userDisplayName || rt.userName || rt.userId}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">{rt.workspaceName || rt.workspaceId}</TableCell>
                  <TableCell className="px-4 text-muted-foreground">{rt.tenantName || rt.tenantId}</TableCell>
                  <TableCell className="px-4">
                    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                      {(rt.installedAgents ?? []).map((type) => {
                        const isActive = rt.agents.some((a) => a.type === type && a.status === 'running');
                        return (
                          <button
                            key={`${rt.runtimeId}-${type}`}
                            title={isActive ? '运行中' : '已安装'}
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium transition-colors hover:opacity-80',
                              isActive ? getAgentTypeClass(type) : 'bg-slate-100 text-slate-400 dark:bg-slate-800/50 dark:text-slate-500',
                            )}
                            onClick={() => setFilter((prev) => ({ ...prev, agentType: [type] }))}
                          >
                            {type}
                          </button>
                        );
                      })}
                      {(rt.installedAgents ?? []).length === 0 && rt.agents.length > 0 && (
                        rt.agents.slice(0, 3).map((agent) => (
                          <button
                            key={`${rt.runtimeId}-${agent.name}`}
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium transition-colors hover:opacity-80',
                              getAgentTypeClass(agent.type),
                            )}
                            onClick={() => setFilter((prev) => ({ ...prev, agentType: [agent.type] }))}
                          >
                            {agent.type}
                          </button>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_VARIANTS[rt.status])} />
                      <Badge variant={STATUS_BADGE_VARIANTS[rt.status]} className="text-xs">
                        {RUNTIME_STATUS_LABELS[rt.status] || rt.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">{formatUptime(rt.uptimeSeconds)}</TableCell>
                  <TableCell className="px-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(rt);
                      }}
                    >
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <CardFooter className="px-6 py-4 border-t border-border/50">
          <RecordPaginationBar
            total={total}
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            className="w-full mt-0"
          />
        </CardFooter>
      </Card>

      {/* 详情弹窗 */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="w-full max-w-3xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
          {selectedRuntime && (
            <>
              <DialogHeader className="px-6 py-5 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <DialogTitle className="text-lg font-semibold">运行时详情</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground mt-0.5 font-mono">
                      {selectedRuntime.runtimeId}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
                {/* 基本信息 */}
                <section>
                  <h4 className="text-base font-medium text-foreground mb-4">基本信息</h4>
                  <div className="grid grid-cols-2 gap-x-10 gap-y-4 text-sm">
                    <InfoItem label="所属租户" value={selectedRuntime.tenantName || selectedRuntime.tenantId} />
                    <InfoItem label="工作空间" value={selectedRuntime.workspaceName || selectedRuntime.workspaceId} />
                    <InfoItem label="所属成员" value={selectedRuntime.userDisplayName || selectedRuntime.userName || selectedRuntime.userId} />
                    <InfoItem
                      label="运行状态"
                      value={
                        <div className="flex items-center gap-1.5">
                          <span className={cn('w-2 h-2 rounded-full', STATUS_VARIANTS[selectedRuntime.status])} />
                          <span>{RUNTIME_STATUS_LABELS[selectedRuntime.status] || selectedRuntime.status}</span>
                        </div>
                      }
                    />
                    <InfoItem label="沙箱规格" value={selectedRuntime.sandboxSpec || '-'} />
                    <InfoItem label="运行时长" value={formatUptime(selectedRuntime.uptimeSeconds)} />
                    <InfoItem label="IP 地址" value={selectedRuntime.ip || '-'} />
                    <InfoItem label="上报时间" value={selectedRuntime.reportedAt ? new Date(selectedRuntime.reportedAt).toLocaleString('zh-CN') : '-'} />
                    <InfoItem
                      label="已安装智能体"
                      value={
                        <div className="flex flex-wrap gap-1">
                          {(selectedRuntime.installedAgents ?? []).map((type) => (
                            <span key={type} className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', getAgentTypeClass(type))}>
                              {AGENT_TYPE_LABELS[type] || type}
                            </span>
                          ))}
                          {(selectedRuntime.installedAgents ?? []).length === 0 && <span className="text-muted-foreground">-</span>}
                        </div>
                      }
                    />
                    <InfoItem label="活跃实例数" value={String(selectedRuntime.agents.length)} />
                    <InfoItem label="近1日会话" value={String(selectedRuntime.sessions1d ?? 0)} />
                    <InfoItem label="近7日会话" value={String(selectedRuntime.sessions7d ?? 0)} />
                    <InfoItem label="最近活跃" value={selectedRuntime.lastActiveAt ? new Date(selectedRuntime.lastActiveAt).toLocaleString('zh-CN') : '-'} />
                  </div>
                </section>

                <div className="w-full h-px bg-border/50" />

                {/* 智能体实例 */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-base font-medium text-foreground">智能体实例</h4>
                    <div className="flex flex-wrap gap-2">
                      {['all', ...new Set(selectedRuntime.agents.map((a) => a.type))].map((type) => (
                        <button
                          key={type}
                          className={cn(
                            'inline-flex items-center px-3 py-1 rounded-md text-xs font-medium transition-colors',
                            drawerAgentFilter === type
                              ? 'bg-primary text-primary-foreground'
                              : 'border border-border/50 text-muted-foreground hover:bg-muted/50',
                          )}
                          onClick={() => setDrawerAgentFilter(type)}
                        >
                          {type === 'all' ? '全部' : AGENT_TYPE_LABELS[type] || type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredDrawerAgents.map((agent) => (
                      <AgentInstanceCard key={agent.name} agent={agent} />
                    ))}
                    {filteredDrawerAgents.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-6">暂无智能体实例</div>
                    )}
                  </div>
                </section>

                <div className="w-full h-px bg-border/50" />

                {/* 资源使用 */}
                <section>
                  <h4 className="text-base font-medium text-foreground mb-4">资源使用</h4>
                  <div className="space-y-5">
                    <ResourceBar icon={<Cpu className="h-4 w-4" />} label="CPU 使用率" value={selectedRuntime.cpuPercent} color="bg-blue-500" />
                    <ResourceBar icon={<MemoryStick className="h-4 w-4" />} label="内存使用率" value={selectedRuntime.memPercent} color="bg-purple-500" />
                  </div>
                </section>
              </div>

              <DialogFooter className="px-6 py-4 border-t border-border/50 flex justify-between items-center">
                <button className="text-sm text-muted-foreground hover:text-foreground transition-colors" onClick={() => setDrawerOpen(false)}>
                  返回
                </button>
                <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>关闭</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground block">{label}</span>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

function AgentInstanceCard({ agent }: { agent: AgentInstance }) {
  return (
    <div className="border border-border/50 rounded-lg p-3 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', getAgentTypeClass(agent.type))}>
            {agent.type}
          </span>
          <span className="font-medium text-foreground">{agent.name}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn('w-1.5 h-1.5 rounded-full', agent.status === 'running' ? 'bg-emerald-500' : agent.status === 'error' ? 'bg-rose-500' : 'bg-slate-400')} />
          <span className="text-muted-foreground">{agent.status}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div>今日调用 <span className="text-foreground">{agent.callsToday.toLocaleString()}</span></div>
        <div>版本 <span className="text-foreground">{agent.version || '-'}</span></div>
        <div>最后活跃 <span className="text-foreground">{agent.lastActive || '-'}</span></div>
      </div>
    </div>
  );
}

function ResourceBar({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground flex items-center gap-1.5">{icon}{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <div className={cn('h-2 rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default AgentRuntimePage;
