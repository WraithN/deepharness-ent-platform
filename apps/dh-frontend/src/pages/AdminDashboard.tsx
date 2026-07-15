import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Activity,
  CheckCircle2,
  MessageSquare,
  Cpu,
  Puzzle,
  MessageSquareQuote,
  BarChart3,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { teamApi } from '@/lib/team-api';
import type { SkillStats, PromptStats } from '@/types';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4'];

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

const renderEmpty = () => (
  <div className="p-6 text-center text-sm text-muted-foreground">暂无数据</div>
);

export const AdminDashboard: React.FC = () => {
  const [skillStats, setSkillStats] = useState<SkillStats | null>(null);
  const [promptStats, setPromptStats] = useState<PromptStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    setStatsLoading(true);
    Promise.all([teamApi.getSkillStats(), teamApi.getPromptStats()])
      .then(([skills, prompts]) => {
        setSkillStats(skills);
        setPromptStats(prompts);
      })
      .catch(() => {
        toast.error('加载大盘数据失败');
      })
      .finally(() => setStatsLoading(false));
  }, []);

  return (
    <div className="flex-1 space-y-6 w-full pb-12">
      <Tabs defaultValue="overview">
        <TabsList className="aurora-tab-bar level-1 mb-4">
          <TabsTrigger value="overview" className="aurora-tab-item level-1">平台概览</TabsTrigger>
          <TabsTrigger value="skills" className="aurora-tab-item level-1">技能大盘</TabsTrigger>
          <TabsTrigger value="prompts" className="aurora-tab-item level-1">提示词大盘</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
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
                  <TabsList className="aurora-tab-bar level-2 mb-4 shrink-0">
                    <TabsTrigger value="trend" className="aurora-tab-item level-2">时间趋势</TabsTrigger>
                    <TabsTrigger value="distribution" className="aurora-tab-item level-2">空间分布</TabsTrigger>
                  </TabsList>
                  <TabsContent value="trend" className="flex-1 min-h-0 m-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mockGlobalData.requirements}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} dx={-10} />
                        <Tooltip cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Line type="monotone" dataKey="count" name="完成需求数" stroke={COLORS[0]} strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </TabsContent>
                  <TabsContent value="distribution" className="flex-1 min-h-0 m-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={mockGlobalData.spacesReqDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                          {mockGlobalData.spacesReqDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: '13px' }} />
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
                  <TabsList className="aurora-tab-bar level-2 mb-4 shrink-0">
                    <TabsTrigger value="trend" className="aurora-tab-item level-2">数量趋势</TabsTrigger>
                    <TabsTrigger value="distribution" className="aurora-tab-item level-2">端云分布</TabsTrigger>
                  </TabsList>
                  <TabsContent value="trend" className="flex-1 min-h-0 m-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mockGlobalData.sessions}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} dx={-10} />
                        <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Bar dataKey="count" name="会话总数" fill={COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </TabsContent>
                  <TabsContent value="distribution" className="flex-1 min-h-0 m-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={mockGlobalData.sessionsSource} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                          {mockGlobalData.sessionsSource.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: '13px' }} />
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
                  <TabsList className="aurora-tab-bar level-2 mb-4 shrink-0">
                    <TabsTrigger value="trend" className="aurora-tab-item level-2">消耗趋势</TabsTrigger>
                    <TabsTrigger value="distribution" className="aurora-tab-item level-2">场景分布</TabsTrigger>
                  </TabsList>
                  <TabsContent value="trend" className="flex-1 min-h-0 m-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mockGlobalData.tokens}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={val => `${val / 1000000}M`} dx={-10} />
                        <Tooltip formatter={(value: number) => `${(value / 1000).toFixed(1)}k tokens`} cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Line type="monotone" dataKey="count" name="Token 消耗量" stroke={COLORS[3]} strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </TabsContent>
                  <TabsContent value="distribution" className="flex-1 min-h-0 m-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={mockGlobalData.tokenUsageByType} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                          {mockGlobalData.tokenUsageByType.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: '13px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="skills" className="space-y-6">
          {statsLoading || !skillStats ? (
            <div className="p-6 text-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">技能总数</div>
                    <div className="text-2xl font-semibold">{skillStats.total}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">已上架</div>
                    <div className="text-2xl font-semibold">{skillStats.installedCount}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">上架率</div>
                    <div className="text-2xl font-semibold">
                      {skillStats.total > 0 ? Math.round((skillStats.installedCount / skillStats.total) * 100) : 0}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">分类分布</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[300px]">
                    {skillStats.categoryDistribution.length === 0 ? (
                      renderEmpty()
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={skillStats.categoryDistribution}
                            dataKey="count"
                            nameKey="category"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label
                          >
                            {skillStats.categoryDistribution.map((_, idx) => (
                              <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">TOP10 下载技能</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[300px]">
                    {skillStats.topSkills.length === 0 ? (
                      renderEmpty()
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={skillStats.topSkills} layout="vertical" margin={{ left: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" />
                          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Bar dataKey="downloads" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="prompts" className="space-y-6">
          {statsLoading || !promptStats ? (
            <div className="p-6 text-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">提示词总数</div>
                    <div className="text-2xl font-semibold">{promptStats.total}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">已上架</div>
                    <div className="text-2xl font-semibold">{promptStats.onShelfCount}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">上架率</div>
                    <div className="text-2xl font-semibold">
                      {promptStats.total > 0 ? Math.round((promptStats.onShelfCount / promptStats.total) * 100) : 0}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">分类分布</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[300px]">
                    {promptStats.categoryDistribution.length === 0 ? (
                      renderEmpty()
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={promptStats.categoryDistribution}
                            dataKey="count"
                            nameKey="category"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label
                          >
                            {promptStats.categoryDistribution.map((_, idx) => (
                              <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">状态分布</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[300px]">
                    {promptStats.statusDistribution.length === 0 ? (
                      renderEmpty()
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={promptStats.statusDistribution}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="status" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="count" fill={COLORS[1]} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">TOP10 使用提示词</CardTitle>
                </CardHeader>
                <CardContent className="h-[300px]">
                  {promptStats.topPrompts.length === 0 ? (
                    renderEmpty()
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={promptStats.topPrompts} layout="vertical" margin={{ left: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="usageCount" fill={COLORS[3]} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
