import { BarChart3, Box, CheckSquare, Clock, Code2, FileText, LineChart as LineChartIcon, ListTodo, MessageSquare, PieChart as PieChartIcon, Wand2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { UserDTO } from '@/lib/api-types';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';

/** /v1/stats/summary 响应类型。 */
interface SummaryResponse {
  thisWeek: number;
  lastWeek: number;
  deltaPercent: number;
}

/** /v1/stats/trend 响应类型。 */
interface TrendResponse {
  data: { date: string; count: number }[];
}

/** /v1/stats/trails 响应类型。 */
interface TrailsResponse {
  data: SessionTrailDTO[];
}

/** 会话轨迹 DTO（来自后端 agent_sessions + agent_messages JOIN）。 */
interface SessionTrailDTO {
  id: string;
  userId: string;
  userName: string;
  title: string;
  agentType: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionTrail {
  id: string;
  user: UserDTO;
  time: string;
  title: string;
  type: string;
  duration: string;
  messageCount: number;
}

/** 将 ISO 时间戳转为相对时间描述（如"10分钟前"）。 */
function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/** 将创建时间到更新时间的间隔转为可读时长（如"15分钟"）。 */
function formatDuration(createdISO: string, updatedISO: string): string {
  const diff = new Date(updatedISO).getTime() - new Date(createdISO).getTime();
  if (diff < 0) return '—';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '<1分钟';
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
}

/** 将 YYYY-MM-DD 或 ISO 日期转为"X月X日"格式用于图表显示。 */
function formatDateShort(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export const Dashboard: React.FC = () => {
  const workspaceId = getCurrentWorkspaceId();
  const statsQuery = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const [selectedUserSession, setSelectedUserSession] = useState<any>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [sessionTrails, setSessionTrails] = useState<SessionTrail[]>([]);
  const [sessionTrend, setSessionTrend] = useState<{ date: string; count: number }[]>([]);
  const [summary, setSummary] = useState<SummaryResponse>({ thisWeek: 0, lastWeek: 0, deltaPercent: 0 });
  const [codeCommitTrend, setCodeCommitTrend] = useState<{ date: string; count: number }[]>([]);
  const sessionPageSize = 5;
  const totalSessionPages = Math.ceil(sessionTrails.length / sessionPageSize);
  const paginatedSessions = sessionTrails.slice((sessionPage - 1) * sessionPageSize, sessionPage * sessionPageSize);

  // 根据会话轨迹中的 userId，从已加载的成员列表中解析真实成员信息；
  // 若未找到匹配成员，则回退到后端返回的 userName 或"未知用户"。
  function resolveTrailUser(s: SessionTrailDTO, userMap: Map<string, UserDTO>): UserDTO {
    const user = userMap.get(s.userId);
    if (user) {
      return user;
    }
    return {
      id: s.userId || '',
      tenantId: '',
      email: '',
      name: s.userName || '未知用户',
      platformRole: 'user',
      createdAt: '',
    };
  }

  useEffect(() => {
    api.get<UserDTO[]>('/v1/identity/users')
      .then(users => {
        setUsers(users);
        return users;
      })
      .catch(() => [] as UserDTO[])
      .then(users => {
        const userMap = new Map(users.map(u => [u.id, u]));

        // 成员会话轨迹：最近的会话记录。
        api.get<TrailsResponse>(`/v1/stats/trails${statsQuery}`)
          .then(data => {
            const mapped: SessionTrail[] = data.data.map(s => ({
              id: s.id,
              user: resolveTrailUser(s, userMap),
              time: formatRelativeTime(s.updatedAt),
              title: s.title || '未命名会话',
              type: s.agentType || 'code',
              duration: formatDuration(s.createdAt, s.updatedAt),
              messageCount: s.messageCount,
            }));
            setSessionTrails(mapped);
          })
          .catch(err => {
            console.error('[Dashboard] fetch trails failed:', err);
            toast.error('加载会话轨迹失败');
          });
      });

    // 统计卡片：本周会话数 + 较上周变化。
    api.get<SummaryResponse>(`/v1/stats/summary${statsQuery}`)
      .then(setSummary)
      .catch(err => console.error('[Dashboard] fetch summary failed:', err));

    // AI 会话趋势：最近 7 天每天的会话数。
    api.get<TrendResponse>(`/v1/stats/trend${statsQuery}`)
      .then(data => {
        setSessionTrend(data.data.map(d => ({ date: formatDateShort(d.date), count: d.count })));
      })
      .catch(err => console.error('[Dashboard] fetch trend failed:', err));

    // 代码提交趋势：扫描工作空间 git 仓库，统计最近 7 天每天的提交数量。
    api.get<TrendResponse>(`/v1/stats/commits${statsQuery}`)
      .then(data => {
        setCodeCommitTrend(data.data.map(d => ({ date: formatDateShort(d.date), count: d.count })));
      })
      .catch(err => console.error('[Dashboard] fetch commit trend failed:', err));
  }, []);

  const totalCommits = codeCommitTrend.reduce((acc, curr) => acc + curr.count, 0);
  const totalReqs = 0;

  return (
    <div className="flex-1 space-y-6 w-full pb-12 overflow-x-hidden">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="soft-shadow border border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">近7天代码提交</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCommits} 次</div>
            <p className="text-xs text-muted-foreground mt-1">+12% 较上周</p>
          </CardContent>
        </Card>

        <Card className="soft-shadow border border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">近7天会话数量</CardTitle>
            <LineChartIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.thisWeek} 次</div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.deltaPercent > 0 && `+${summary.deltaPercent}% 较上周`}
              {summary.deltaPercent < 0 && `${summary.deltaPercent}% 较上周`}
              {summary.deltaPercent === 0 && `${summary.lastWeek} 次上周`}
            </p>
          </CardContent>
        </Card>

        <Card className="soft-shadow border border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">近7天需求完成</CardTitle>
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalReqs} 个</div>
            <p className="text-xs text-muted-foreground mt-1">+5% 较上周</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="col-span-1 h-full flex flex-col soft-shadow border border-border/50">
          <CardHeader>
            <CardTitle>代码提交趋势</CardTitle>
            <CardDescription>过去 7 天的代码提交次数</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-[300px]">
            <div className="w-full h-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={codeCommitTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 13 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 13 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 h-full flex flex-col soft-shadow border border-border/50">
          <CardHeader>
            <CardTitle>AI 会话趋势</CardTitle>
            <CardDescription>过去 7 天的 AI 辅助会话次数</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-[300px]">
            <div className="w-full h-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sessionTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 13 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 13 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-1 lg:col-span-2 soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
          <CardContent className="p-6">
            <div className="mb-5">
              <h3 className="text-xl font-semibold text-foreground">成员会话轨迹</h3>
              <p className="text-muted-foreground mt-1">团队成员近期在智能会话中的活动记录</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <Table className="min-w-max text-[15px]">
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">成员</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">会话主题</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">类型</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">消息数</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">会话时长</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        暂无会话记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSessions.map((trail) => (
                      <TableRow
                        key={trail.id}
                        className="cursor-pointer transition-colors hover:bg-primary/5"
                        onClick={() => setSelectedUserSession(trail)}
                      >
                        <TableCell className="px-4 py-5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center text-primary font-medium text-xs shrink-0">
                              {trail.user.name.charAt(0)}
                            </div>
                            <span className="font-medium">{trail.user.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap">
                          {trail.title}
                        </TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap">
                          {trail.type === 'ui' && <Badge variant="outline" className="rounded-md px-3 py-1 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/50"><Box className="w-3 h-3 mr-1"/> UI设计</Badge>}
                          {trail.type === 'code' && <Badge variant="outline" className="rounded-md px-3 py-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/50"><Code2 className="w-3 h-3 mr-1"/> 代码编写</Badge>}
                          {trail.type === 'requirement' && <Badge variant="outline" className="rounded-md px-3 py-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/50"><ListTodo className="w-3 h-3 mr-1"/> 需求分析</Badge>}
                          {(trail.type !== 'ui' && trail.type !== 'code' && trail.type !== 'requirement') && <Badge variant="outline" className="rounded-md px-3 py-1"><MessageSquare className="w-3 h-3 mr-1"/> 会话</Badge>}
                        </TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap">
                          {trail.messageCount} 条
                        </TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap">
                          {trail.duration}
                        </TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {trail.time}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <RecordPaginationBar
              total={sessionTrails.length}
              currentPage={sessionPage}
              totalPages={totalSessionPages}
              onPageChange={setSessionPage}
            />
          </CardContent>
        </Card>
      </div>

      {/* Member Session Detail Sheet */}
      <Sheet open={!!selectedUserSession} onOpenChange={(open) => !open && setSelectedUserSession(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl overflow-y-auto p-0 flex flex-col">
          {selectedUserSession && (
            <>
              <div className="p-6 border-b border-border/50 shrink-0 pr-12 bg-muted/10">
                <SheetHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <SheetTitle className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0 soft-shadow">
                        {selectedUserSession.user.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate">{selectedUserSession.user.name} 的会话轨迹</div>
                        <div className="text-sm font-normal text-muted-foreground mt-1 truncate">
                          会话时长: {selectedUserSession.duration} · {selectedUserSession.time} · {selectedUserSession.messageCount} 条消息
                        </div>
                      </div>
                    </SheetTitle>
                    <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                      <Button onClick={() => toast.success('已生成会话复盘报告')} variant="outline" size="sm" className="flex-1 sm:flex-none">
                        <FileText className="h-4 w-4 mr-2" />
                        会话复盘
                      </Button>
                      <Button onClick={() => toast.success('已总结为新技能')} size="sm" className="flex-1 sm:flex-none">
                        <Wand2 className="h-4 w-4 mr-2" />
                        总结技能
                      </Button>
                    </div>
                  </div>
                  <SheetDescription className="sr-only">
                    成员详细会话历史信息流
                  </SheetDescription>
                </SheetHeader>
              </div>

              <div className="flex-1 p-6 bg-muted/5">
                <h3 className="font-semibold mb-6 flex items-center">
                  <MessageSquare className="h-5 w-5 mr-2 text-primary" />
                  会话主题：{selectedUserSession.title}
                </h3>

                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-green-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow">
                      <CheckSquare className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl glass-card flex justify-center">
                      <span className="text-sm font-medium text-green-600 dark:text-green-500">会话记录 (历时 {selectedUserSession.duration}，共 {selectedUserSession.messageCount} 条消息)</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};
