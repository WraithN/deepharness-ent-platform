import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { WorkItemDTO } from '@/lib/api-types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LayoutList, LayoutGrid, Plus, MoreHorizontal, RefreshCw } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

// 后端状态（下划线）与中文展示状态的映射
const API_STATUS_TO_UI: Record<string, string> = {
  backlog: '待处理',
  todo: '待处理',
  in_progress: '进行中',
  done: '已完成',
};

const UI_STATUS_TO_API: Record<string, string> = {
  '待处理': 'todo',
  '进行中': 'in_progress',
  '已完成': 'done',
};

const API_PRIORITY_TO_UI: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const STATUSES = ['待处理', '进行中', '已完成'];

interface ReqRow {
  id: string;
  title: string;
  status: string;
  owner: string;
  priority: string;
  createdAt: string;
}

export const Requirements: React.FC = () => {
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [requirements, setRequirements] = useState<ReqRow[]>([]);
  const [draggedReqId, setDraggedReqId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<WorkItemDTO[]>('/v1/workitems?type=requirement')
      .then(items => {
        setRequirements(items.map(item => ({
          id: item.id,
          title: item.title,
          status: API_STATUS_TO_UI[item.status] ?? '待处理',
          owner: item.assigneeId ?? item.reporter ?? '',
          priority: API_PRIORITY_TO_UI[item.priority] ?? '中',
          createdAt: item.createdAt.slice(0, 10),
        })));
      })
      .catch(() => toast.error('加载需求失败'));
  }, []);

  const handleNewRequirement = () => {
    navigate('/chat', { state: { initialInput: '#需求设计 @新需求 ' } });
  };

  const handleDragStart = (e: React.DragEvent, reqId: string) => {
    setDraggedReqId(reqId);
    e.dataTransfer.setData('text/plain', reqId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    const reqId = e.dataTransfer.getData('text/plain');
    if (!reqId || reqId === '') return;

    const req = requirements.find(r => r.id === reqId);
    if (!req || req.status === targetStatus) {
      setDraggedReqId(null);
      return;
    }

    api.patch<WorkItemDTO>(`/v1/workitems/${reqId}/status`, { status: UI_STATUS_TO_API[targetStatus] })
      .then(item => {
        setRequirements(prev => prev.map(r => r.id === reqId ? {
          ...r,
          status: API_STATUS_TO_UI[item.status] ?? targetStatus,
        } : r));
        toast.success(`需求 ${reqId} 状态已更新为 ${targetStatus}`);
      })
      .catch(() => toast.error('状态更新失败'));
    setDraggedReqId(null);
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case '已完成': return <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-green-200 shadow-none">已完成</Badge>;
      case '进行中': return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 shadow-none">进行中</Badge>;
      default: return <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border-zinc-200 shadow-none">待处理</Badge>;
    }
  };

  const renderPriorityBadge = (priority: string) => {
    switch (priority) {
      case '高': return <Badge variant="destructive" className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20 shadow-none">高</Badge>;
      case '中': return <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 border-orange-500/20 shadow-none">中</Badge>;
      case '低': return <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/20 border-zinc-500/20 shadow-none">低</Badge>;
      default: return <Badge variant="outline">{priority}</Badge>;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-8rem)] min-h-[500px] max-w-7xl mx-auto w-full pb-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/50 pb-4 mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">需求分析</h2>
          <p className="text-muted-foreground mt-1">管理和追踪项目需求状态，支持列表与看板视图切换。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-muted p-1 rounded-md flex items-center">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="h-8 px-2"
            >
              <LayoutList className="h-4 w-4 mr-2" />
              列表
            </Button>
            <Button
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('kanban')}
              className="h-8 px-2"
            >
              <LayoutGrid className="h-4 w-4 mr-2" />
              看板
            </Button>
          </div>
          <Button variant="outline" onClick={() => toast.success('已从Meego同步最新需求')}>
            <RefreshCw className="h-4 w-4 mr-2" />
            从需求源同步
          </Button>
          <Button onClick={handleNewRequirement}>
            <Plus className="h-4 w-4 mr-2" />
            新建需求
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {viewMode === 'list' ? (
          <Card className="h-full flex flex-col soft-shadow border border-border/50 overflow-hidden bg-card">
            <div className="w-full max-w-full overflow-x-auto flex-1">
              <Table className="min-w-max">
                <TableHeader className="bg-muted/5 border-b border-border/50">
                  <TableRow>
                    <TableHead className="w-[100px]">ID</TableHead>
                    <TableHead>需求标题</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>优先级</TableHead>
                    <TableHead>负责人</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requirements.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium text-muted-foreground whitespace-nowrap">{req.id}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{req.title}</TableCell>
                      <TableCell className="whitespace-nowrap">{renderStatusBadge(req.status)}</TableCell>
                      <TableCell className="whitespace-nowrap">{renderPriorityBadge(req.priority)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">
                            {req.owner.charAt(0)}
                          </div>
                          <span className="text-sm">{req.owner}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{req.createdAt}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" onClick={() => toast.success('打开操作菜单')}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        ) : (
          <div className="flex gap-4 h-full overflow-x-auto pb-4 items-start">
            {STATUSES.map(status => {
              const columnReqs = requirements.filter(r => r.status === status);
              return (
                <div 
                  key={status} 
                  className="w-80 shrink-0 flex flex-col max-h-full bg-muted/10 rounded-xl transition-colors border border-border/50 soft-shadow"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, status)}
                >
                  <div className="p-4 font-medium flex items-center justify-between shrink-0 border-b border-border/50 bg-background/50 rounded-t-xl">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{status}</span>
                      <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs bg-background shadow-sm">{columnReqs.length}</Badge>
                    </div>
                  </div>
                  <div className="p-3 flex-1 overflow-y-auto space-y-3 min-h-[150px]">
                    {columnReqs.map(req => (
                      <Card 
                        key={req.id} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, req.id)}
                        className={`cursor-pointer soft-shadow transition-all active:cursor-grabbing hover:border-primary/50 ${draggedReqId === req.id ? 'opacity-50 border-primary scale-95' : 'opacity-100 border-border/50'}`}
                      >
                        <CardHeader className="p-4 pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="text-sm font-medium leading-snug line-clamp-2">
                              {req.title}
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <div className="flex flex-col gap-3 mt-2">
                            <div className="text-xs text-muted-foreground flex items-center justify-between">
                              <span>{req.id}</span>
                              {renderPriorityBadge(req.priority)}
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px]">
                                  {req.owner.charAt(0)}
                                </div>
                                <span className="text-xs text-muted-foreground">{req.owner}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{req.createdAt}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {columnReqs.length === 0 && (
                      <div className="text-center p-4 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg bg-background/50">
                        拖拽需求到此处
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};