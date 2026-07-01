import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { mockDashboardStats } from '@/mock/data';
import { api } from '@/lib/api';
import type { UserDTO, AgentSessionDTO } from '@/lib/api-types';
import { GitCommit, MessageSquare, CheckSquare, Clock, Box, Code2, ListTodo, Bot, User, Wand2, FileText, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from 'lucide-react';
import { toast } from 'sonner';

interface SessionTrail {
  id: string;
  user: UserDTO;
  time: string;
  title: string;
  type: string;
  duration: string;
}

import { AdminDashboard } from './AdminDashboard';

export const Dashboard: React.FC = () => {
  const [selectedUserSession, setSelectedUserSession] = useState<any>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [sessionTrails, setSessionTrails] = useState<SessionTrail[]>([]);
  const sessionPageSize = 5;
  const totalSessionPages = Math.ceil(sessionTrails.length / sessionPageSize);
  const paginatedSessions = sessionTrails.slice((sessionPage - 1) * sessionPageSize, sessionPage * sessionPageSize);

  useEffect(() => {
    api.get<UserDTO[]>('/v1/identity/users').then(setUsers).catch(() => {});
    api.get<AgentSessionDTO[]>('/v1/orchestrator/sessions')
      .then(sessions => {
        const times = ['10分钟前', '1小时前', '3小时前', '昨天 15:30', '昨天 11:15'];
        const durations = ['15分钟', '45分钟', '30分钟', '1小时20分钟', '25分钟'];
        const types = ['ui', 'requirement', 'code', 'code', 'requirement'];
        const mapped: SessionTrail[] = sessions.map((s, i) => ({
          id: s.id,
          user: { id: `u${(i % 4) + 1}`, tenantId: 't1', email: '', name: ['开发者小明', '产品小红', '设计小李', '测试小刚'][i % 4], role: 'user', createdAt: '' },
          time: times[i % times.length],
          title: s.title,
          type: types[i % types.length],
          duration: durations[i % durations.length],
        }));
        setSessionTrails(mapped);
      })
      .catch(() => {});
  }, []);

  const userRole = localStorage.getItem('userRole');
  if (userRole === 'superadmin') {
    return <AdminDashboard />;
  }

  const totalCommits = mockDashboardStats.codeCommits.reduce((acc, curr) => acc + curr.count, 0);
  const totalSessions = mockDashboardStats.sessions.reduce((acc, curr) => acc + curr.count, 0);
  const totalReqs = mockDashboardStats.requirementsCompleted.reduce((acc, curr) => acc + curr.count, 0);

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
            <div className="text-2xl font-bold">{totalSessions} 次</div>
            <p className="text-xs text-muted-foreground mt-1">+24% 较上周</p>
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
                <LineChart data={mockDashboardStats.codeCommits}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
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
                <BarChart data={mockDashboardStats.sessions}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-1 lg:col-span-2 soft-shadow border border-border/50 overflow-hidden">
          <CardHeader className="bg-muted/10 border-b border-border/50">
            <CardTitle>成员会话轨迹</CardTitle>
            <CardDescription>团队成员近期在智能会话中的活动记录</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full max-w-full overflow-x-auto bg-card rounded-b-xl">
              <Table className="min-w-max">
                <TableHeader className="bg-muted/10">
                  <TableRow>
                    <TableHead>成员</TableHead>
                    <TableHead>会话主题</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>会话时长</TableHead>
                    <TableHead className="text-right">时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSessions.map((trail) => (
                    <TableRow 
                      key={trail.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedUserSession(trail)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs">
                            {trail.user.name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{trail.user.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {trail.title}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {trail.type === 'ui' && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Box className="w-3 h-3 mr-1"/> UI设计</Badge>}
                        {trail.type === 'code' && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><Code2 className="w-3 h-3 mr-1"/> 代码编写</Badge>}
                        {trail.type === 'requirement' && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><ListTodo className="w-3 h-3 mr-1"/> 需求分析</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {trail.duration}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                        <div className="flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" />
                          {trail.time}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                共 {sessionTrails.length} 条记录，第 {sessionPage}/{totalSessionPages} 页
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={sessionPage <= 1}
                  onClick={() => setSessionPage(p => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                {Array.from({ length: totalSessionPages }, (_, i) => i + 1).map(p => (
                  <Button
                    key={p}
                    variant={sessionPage === p ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setSessionPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={sessionPage >= totalSessionPages}
                  onClick={() => setSessionPage(p => Math.min(totalSessionPages, p + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
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
                          会话时长: {selectedUserSession.duration} · {selectedUserSession.time}
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
                  {/* Mock Activity Feed Items */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-primary text-primary-foreground shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 soft-shadow">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border/50 bg-card soft-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">用户提问</span>
                        <span className="text-xs text-muted-foreground">10:00 AM</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        帮我实现一个登录页面的UI设计，需要包含账号密码输入框和第三方登录按钮。
                      </p>
                    </div>
                  </div>

                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-secondary text-secondary-foreground shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 soft-shadow">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border/50 bg-card soft-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">AI 助手响应</span>
                        <span className="text-xs text-muted-foreground">10:01 AM</span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        好的，我将为您设计登录页面。已经生成了基础结构的UI代码，请查看右侧预览面板。
                      </p>
                      <div className="p-3 bg-muted/50 rounded-lg flex items-center gap-3 border">
                        <Box className="h-5 w-5 text-blue-500" />
                        <div>
                          <p className="text-sm font-medium">Login_Page_Design.tsx</p>
                          <p className="text-xs text-muted-foreground">UI设计文件</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-primary text-primary-foreground shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 soft-shadow">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border/50 bg-card soft-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">用户修改需求</span>
                        <span className="text-xs text-muted-foreground">10:05 AM</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        主色调希望能改成深蓝色（#1890ff），并且添加一个"记住我"的选项。
                      </p>
                    </div>
                  </div>

                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-secondary text-secondary-foreground shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 soft-shadow">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border/50 bg-card soft-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">AI 助手更新</span>
                        <span className="text-xs text-muted-foreground">10:06 AM</span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        没问题，我已经将按钮、高亮链接的主色调更新为了深蓝色（#1890ff），并在密码框下方添加了"记住我"勾选框。
                      </p>
                      <div className="p-3 bg-muted/50 rounded-lg flex items-center gap-3 border">
                        <Box className="h-5 w-5 text-blue-500" />
                        <div>
                          <p className="text-sm font-medium">Login_Page_Design_v2.tsx</p>
                          <p className="text-xs text-muted-foreground">UI设计文件 (已更新)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-green-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow">
                      <CheckSquare className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border bg-card shadow-sm flex justify-center">
                      <span className="text-sm font-medium text-green-600 dark:text-green-500">会话结束 (历时 {selectedUserSession.duration})</span>
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