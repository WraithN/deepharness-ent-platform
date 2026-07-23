import { BarChart3, Bot, Box, Clock, Code2, Eye, LineChart as LineChartIcon, ListTodo, Loader2, MessageSquare, PieChart as PieChartIcon } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

/** 会话消息 DTO（来自后端 agent_messages，用于轨迹详情信息流）。 */
interface TrailMessageDTO {
  id: string;
  sessionId: string;
  role: string;
  type: string;
  content: string;
  metadata?: { originalText?: string } & Record<string, unknown>;
  timestamp: string;
}

/** 消息角色常量。 */
const ROLE_USER = 'user';
const ROLE_ASSISTANT = 'assistant';

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

/** 将 ISO 时间戳转为"MM-DD HH:mm"格式用于消息信息流时间显示。 */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 单条会话消息信息流卡片。用户消息展示原始输入，AI 消息以 Markdown 渲染。 */
const TrailMessageItem: React.FC<{ msg: TrailMessageDTO; user: UserDTO }> = ({ msg, user }) => {
  const isUser = msg.role === ROLE_USER;
  const content = isUser ? (msg.metadata?.originalText || msg.content) : msg.content;
  const displayName = isUser ? user.name : 'AI 助手';

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        {isUser ? (
          <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center text-primary font-medium text-xs shrink-0">
            {user.name.charAt(0)}
          </div>
        ) : (
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-primary" />
          </div>
        )}
        <span className="text-sm font-medium">{displayName}</span>
        {msg.timestamp && (
          <span className="text-xs text-muted-foreground">{formatMessageTime(msg.timestamp)}</span>
        )}
      </div>
      {isUser ? (
        <p className="text-sm whitespace-pre-wrap break-words">{content || '(空消息)'}</p>
      ) : (
        <div className="text-sm">
          {content ? <MarkdownView content={content} collapsible={false} /> : <span className="text-muted-foreground">(空消息)</span>}
        </div>
      )}
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const workspaceId = getCurrentWorkspaceId();
  const statsQuery = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const [selectedUserSession, setSelectedUserSession] = useState<any>(null);
  const [trailMessages, setTrailMessages] = useState<TrailMessageDTO[]>([]);
  const [trailMessagesLoading, setTrailMessagesLoading] = useState(false);
  const [sessionPage, setSessionPage] = useState(1);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [sessionTrails, setSessionTrails] = useState<SessionTrail[]>([]);
  const [sessionTrend, setSessionTrend] = useState<{ date: string; count: number }[]>([]);
  const [summary, setSummary] = useState<SummaryResponse>({ thisWeek: 0, lastWeek: 0, deltaPercent: 0 });
  const [reqSummary, setReqSummary] = useState<SummaryResponse>({ thisWeek: 0, lastWeek: 0, deltaPercent: 0 });
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

  /** 打开成员会话轨迹详情，并拉取该会话的历史消息渲染为信息流。 */
  function openTrailDetail(trail: SessionTrail) {
    setSelectedUserSession(trail);
    setTrailMessages([]);
    setTrailMessagesLoading(true);
    api.get<TrailMessageDTO[]>(`/v1/stats/trails/${trail.id}/messages${statsQuery}`)
      .then(msgs => setTrailMessages(msgs || []))
      .catch(err => {
        console.error('[Dashboard] fetch trail messages failed:', err);
        toast.error('加载会话消息失败');
      })
      .finally(() => setTrailMessagesLoading(false));
  }

  /** 关闭轨迹详情面板并清空已加载的消息。 */
  function closeTrailDetail() {
    setSelectedUserSession(null);
    setTrailMessages([]);
    setTrailMessagesLoading(false);
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

    // 需求完成统计：工作空间关联项目最近 7 天完成的需求数量及变化。
    api.get<SummaryResponse>(`/v1/stats/requirements${statsQuery}`)
      .then(setReqSummary)
      .catch(err => console.error('[Dashboard] fetch requirements failed:', err));
  }, []);

  const totalCommits = codeCommitTrend.reduce((acc, curr) => acc + curr.count, 0);

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
            <div className="text-2xl font-bold">{reqSummary.thisWeek} 个</div>
            <p className="text-xs text-muted-foreground mt-1">
              {reqSummary.deltaPercent > 0 && `+${reqSummary.deltaPercent}% 较上周`}
              {reqSummary.deltaPercent < 0 && `${reqSummary.deltaPercent}% 较上周`}
              {reqSummary.deltaPercent === 0 && `${reqSummary.lastWeek} 个上周`}
            </p>
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
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        暂无会话记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSessions.map((trail) => (
                      <TableRow
                        key={trail.id}
                        className="cursor-pointer transition-colors hover:bg-primary/5"
                        onClick={() => openTrailDetail(trail)}
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
                        <TableCell className="px-4 py-5 whitespace-nowrap text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-primary hover:bg-primary/10"
                            onClick={(e) => { e.stopPropagation(); openTrailDetail(trail); }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            查看
                          </Button>
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

      {/* Member Session Detail Dialog */}
      <Dialog open={!!selectedUserSession} onOpenChange={(open) => !open && closeTrailDetail()}>
        <DialogContent className="max-w-3xl w-full p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
          {selectedUserSession && (
            <>
              <div className="p-6 border-b border-border/50 shrink-0 bg-muted/10">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3 pr-10">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0 soft-shadow">
                      {selectedUserSession.user.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate">{selectedUserSession.user.name} 的会话轨迹</div>
                      <div className="text-sm font-normal text-muted-foreground mt-1 truncate">
                        会话时长: {selectedUserSession.duration} · {selectedUserSession.time} · {selectedUserSession.messageCount} 条消息
                      </div>
                    </div>
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    成员详细会话历史信息流
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="flex-1 p-6 bg-muted/5 overflow-y-auto">
                <h3 className="font-semibold mb-6 flex items-center">
                  <MessageSquare className="h-5 w-5 mr-2 text-primary" />
                  会话主题：{selectedUserSession.title}
                </h3>

                {trailMessagesLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    加载会话消息...
                  </div>
                ) : trailMessages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-12">
                    暂无消息记录
                  </div>
                ) : (
                  <div className="space-y-4">
                    {trailMessages.map(msg => (
                      <TrailMessageItem key={msg.id} msg={msg} user={selectedUserSession.user} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
