import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Activity, CheckCircle2, MessageSquare, Cpu, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, Layers } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const mockGlobalData = {
  requirements: [
    { date: '11-01', count: 12 }, { date: '11-02', count: 18 }, { date: '11-03', count: 15 },
    { date: '11-04', count: 25 }, { date: '11-05', count: 20 }, { date: '11-06', count: 30 }, { date: '11-07', count: 28 },
  ],
  sessions: [
    { date: '11-01', count: 150 }, { date: '11-02', count: 210 }, { date: '11-03', count: 180 },
    { date: '11-04', count: 320 }, { date: '11-05', count: 280 }, { date: '11-06', count: 400 }, { date: '11-07', count: 380 },
  ],
  tokens: [
    { date: '11-01', count: 1500000 }, { date: '11-02', count: 2100000 }, { date: '11-03', count: 1800000 },
    { date: '11-04', count: 3200000 }, { date: '11-05', count: 2800000 }, { date: '11-06', count: 4000000 }, { date: '11-07', count: 3800000 },
  ],
  spacesReqDistribution: [
    { name: '前端空间', value: 45 }, { name: '后端空间', value: 55 }, { name: '测试空间', value: 20 }, { name: 'UI空间', value: 10 }
  ],
  sessionsSource: [
    { name: '云侧', value: 65 }, { name: '端侧', value: 35 }
  ],
  tokenUsageByType: [
    { name: '产品需求', value: 30 }, { name: '开发编码', value: 50 }, { name: '测试验证', value: 20 }
  ]
};

const COLORS = ['#1d4ed8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

export const AdminDashboard: React.FC = () => {
  return (
    <div className="flex-1 space-y-6 w-full pb-12">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="soft-shadow border-none bg-gradient-to-br from-card to-blue-50/50 dark:to-blue-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI 完成需求总量</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">148</div>
            <p className="text-xs text-muted-foreground mt-1">较上周增长 12%</p>
          </CardContent>
        </Card>
        
        <Card className="soft-shadow border-none bg-gradient-to-br from-card to-emerald-50/50 dark:to-emerald-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">会话总数</CardTitle>
            <MessageSquare className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">1,920</div>
            <p className="text-xs text-muted-foreground mt-1">较上周增长 24%</p>
          </CardContent>
        </Card>
        
        <Card className="soft-shadow border-none bg-gradient-to-br from-card to-purple-50/50 dark:to-purple-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Token 总消耗量</CardTitle>
            <Cpu className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">19.2M</div>
            <p className="text-xs text-muted-foreground mt-1">较上周增长 18%</p>
          </CardContent>
        </Card>

        <Card className="soft-shadow border-none bg-gradient-to-br from-card to-amber-50/50 dark:to-amber-950/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">活跃空间数</CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">12</div>
            <p className="text-xs text-muted-foreground mt-1">当前稳定运行</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="soft-shadow border-border/50 h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>AI 完成需求</CardTitle>
            <CardDescription>时间趋势及各空间的贡献分布</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <Tabs defaultValue="trend" className="w-full h-full flex flex-col">
              <TabsList className="mb-4 shrink-0 bg-muted/50 p-1 inline-flex w-fit">
                <TabsTrigger value="trend" className="text-xs px-3">时间趋势</TabsTrigger>
                <TabsTrigger value="distribution" className="text-xs px-3">空间分布</TabsTrigger>
              </TabsList>
              <TabsContent value="trend" className="flex-1 min-h-0 m-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockGlobalData.requirements}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-[#333]" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dx={-10} />
                    <Tooltip cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Line type="monotone" dataKey="count" name="完成需求数" stroke={COLORS[0]} strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>
              <TabsContent value="distribution" className="flex-1 min-h-0 m-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mockGlobalData.spacesReqDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                      {mockGlobalData.spacesReqDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="soft-shadow border-border/50 h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>会话情况总览</CardTitle>
            <CardDescription>会话数量趋势及云端分布</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <Tabs defaultValue="trend" className="w-full h-full flex flex-col">
              <TabsList className="mb-4 shrink-0 bg-muted/50 p-1 inline-flex w-fit">
                <TabsTrigger value="trend" className="text-xs px-3">数量趋势</TabsTrigger>
                <TabsTrigger value="distribution" className="text-xs px-3">端云分布</TabsTrigger>
              </TabsList>
              <TabsContent value="trend" className="flex-1 min-h-0 m-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mockGlobalData.sessions}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-[#333]" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dx={-10} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="count" name="会话总数" fill={COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </TabsContent>
              <TabsContent value="distribution" className="flex-1 min-h-0 m-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mockGlobalData.sessionsSource} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                      {mockGlobalData.sessionsSource.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="soft-shadow border-border/50 h-[400px] flex flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>Token 消耗量分析</CardTitle>
            <CardDescription>各业务角色使用成本趋势</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <Tabs defaultValue="trend" className="w-full h-full flex flex-col">
              <TabsList className="mb-4 shrink-0 bg-muted/50 p-1 inline-flex w-fit">
                <TabsTrigger value="trend" className="text-xs px-3">消耗趋势</TabsTrigger>
                <TabsTrigger value="distribution" className="text-xs px-3">场景分布</TabsTrigger>
              </TabsList>
              <TabsContent value="trend" className="flex-1 min-h-0 m-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockGlobalData.tokens}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-[#333]" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={val => `${val / 1000000}M`} dx={-10} />
                    <Tooltip formatter={(value: number) => `${(value / 1000).toFixed(1)}k tokens`} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Line type="monotone" dataKey="count" name="Token 消耗量" stroke={COLORS[3]} strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>
              <TabsContent value="distribution" className="flex-1 min-h-0 m-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mockGlobalData.tokenUsageByType} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                      {mockGlobalData.tokenUsageByType.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};