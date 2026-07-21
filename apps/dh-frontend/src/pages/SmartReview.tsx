import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { CheckCircle2, AlertTriangle, AlertCircle, GitPullRequest, GitMerge, Loader2, XCircle, Clock, Link as LinkIcon, Send, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { PaginationBar } from '@/components/admin/PaginationBar';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { api } from '@/lib/api';

interface PRRecord {
  id: string;
  title: string;
  author: string;
  repo: string;
  branch: string;
  status: 'passed' | 'failed' | 'pending';
  time: string;
  relatedRequirement?: {
    id: string;
    title: string;
  };
  issues: {
    errors: number;
    warnings: number;
    info: number;
  };
}

interface ReviewResult {
  id: string;
  repo: string;
  prId: number;
  title: string;
  summary: string;
  issues: Array<{ id: string; file: string; line: number; severity: string; message: string }>;
  createdAt: string;
}

const REVIEW_PAGE_SIZE = 10;

function mapSeverityCounts(issues: ReviewResult['issues']) {
  const counts = { errors: 0, warnings: 0, info: 0 };
  for (const issue of issues) {
    if (issue.severity === 'high') counts.errors++;
    else if (issue.severity === 'medium') counts.warnings++;
    else counts.info++;
  }
  return counts;
}

function deriveStatus(issues: ReviewResult['issues']): PRRecord['status'] {
  const hasHigh = issues.some(i => i.severity === 'high');
  const hasMedium = issues.some(i => i.severity === 'medium');
  if (hasHigh) return 'failed';
  if (hasMedium) return 'pending';
  return 'passed';
}

function formatReviewTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapReviewToPRRecord(r: ReviewResult): PRRecord {
  return {
    id: r.id,
    title: r.title,
    author: '—',
    repo: r.repo,
    branch: `pr-${r.prId}`,
    status: deriveStatus(r.issues),
    time: formatReviewTime(r.createdAt),
    issues: mapSeverityCounts(r.issues),
  };
}

export const SmartReview: React.FC = () => {
  const [selectedPR, setSelectedPR] = useState<PRRecord | null>(null);
  const [prList, setPrList] = useState<PRRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ReviewResult[]>('/v1/review/review')
      .then(data => {
        setPrList(data.map(mapReviewToPRRecord));
      })
      .catch(() => {
        toast.error('加载评审记录失败');
      })
      .finally(() => setLoading(false));
  }, []);

  const { currentPage, totalPages, onPageChange, startIndex, endIndex } = useClientPagination({
    pageSize: REVIEW_PAGE_SIZE,
    total: prList.length,
  });
  const paginatedPRs = prList.slice(startIndex, endIndex);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'passed': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" /> 评审通过</Badge>;
      case 'failed': return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" /> 需要修改</Badge>;
      case 'pending': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Clock className="w-3 h-3 mr-1" /> 评审中</Badge>;
      default: return null;
    }
  };

  return (
    <div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/50 pb-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">智能评审</h2>
          <p className="text-muted-foreground mt-1">基于空间编码规范的自动化代码评审。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => toast.success('已触发手动同步')}>手动同步</Button>
          <Button onClick={() => toast.success('全局评审设置已保存')}>评审设置</Button>
        </div>
      </div>

      <Card className="soft-shadow border-none overflow-hidden">
        <CardHeader>
          <CardTitle>PR 评审记录</CardTitle>
          <CardDescription>最近的合并请求评审状态</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto bg-card rounded-b-xl">
            <Table className="min-w-max">
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>PR 信息</TableHead>
                  <TableHead>提交人</TableHead>
                  <TableHead>仓库/分支</TableHead>
                  <TableHead>发现问题</TableHead>
                  <TableHead>评审状态</TableHead>
                  <TableHead className="text-right">时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : paginatedPRs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      暂无 PR 记录
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedPRs.map((pr) => (
                    <TableRow 
                      key={pr.id} 
                      className="hover:bg-muted/50"
                    >
                      <TableCell className="cursor-pointer" onClick={() => setSelectedPR(pr)}>
                        <div className="font-medium text-sm text-foreground mb-1">{pr.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <GitPullRequest className="w-3 h-3" />
                          {pr.id}
                        </div>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => setSelectedPR(pr)}>
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs">
                            {pr.author.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{pr.author}</span>
                        </div>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => setSelectedPR(pr)}>
                        <div className="text-sm">{pr.repo}</div>
                        <div className="text-xs text-muted-foreground flex items-center mt-1">
                          <GitMerge className="w-3 h-3 mr-1" />
                          {pr.branch}
                        </div>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => setSelectedPR(pr)}>
                        <div className="flex gap-2">
                          {pr.issues.errors > 0 && <span className="text-xs flex items-center text-destructive"><AlertCircle className="w-3 h-3 mr-1"/>{pr.issues.errors}</span>}
                          {pr.issues.warnings > 0 && <span className="text-xs flex items-center text-amber-500"><AlertTriangle className="w-3 h-3 mr-1"/>{pr.issues.warnings}</span>}
                          {pr.issues.info > 0 && <span className="text-xs flex items-center text-blue-500"><CheckCircle2 className="w-3 h-3 mr-1"/>{pr.issues.info}</span>}
                          {pr.issues.errors === 0 && pr.issues.warnings === 0 && pr.issues.info === 0 && <span className="text-xs text-muted-foreground">-</span>}
                        </div>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => setSelectedPR(pr)}>
                        {getStatusBadge(pr.status)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm cursor-pointer" onClick={() => setSelectedPR(pr)}>
                        {pr.time}
                      </TableCell>
                      <TableCell className="text-right">
                        {pr.status === 'passed' && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 shadow-none"
                            onClick={(e) => {
                              e.stopPropagation();
                              toast.success(`已提交测试: ${pr.id}`);
                            }}
                          >
                            <Rocket className="w-3.5 h-3.5 mr-1 text-primary" />
                            提测
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {prList.length > 0 && (
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          )}
        </CardContent>
      </Card>

      {/* Review Details Sheet */}
      <Sheet open={!!selectedPR} onOpenChange={(open) => !open && setSelectedPR(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl overflow-y-auto p-0 flex flex-col">
          {selectedPR && (
            <>
              <div className="p-6 border-b shrink-0 bg-muted/10 pr-12">
                <SheetHeader>
                  <SheetTitle className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xl font-bold mb-2 truncate">{selectedPR.title}</div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm font-normal text-muted-foreground">
                        <span className="flex items-center gap-1"><GitPullRequest className="w-4 h-4" /> {selectedPR.id}</span>
                        <span>·</span>
                        <span>{selectedPR.author} 提交于 {selectedPR.time}</span>
                      </div>
                      {selectedPR.relatedRequirement && (
                        <div className="mt-3 flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">关联需求：</span>
                          <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                            <LinkIcon className="w-3 h-3 mr-1" />
                            {selectedPR.relatedRequirement.id}: {selectedPR.relatedRequirement.title}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex flex-col items-end gap-3">
                      {getStatusBadge(selectedPR.status)}
                      <Button size="sm" onClick={() => toast.success(`已向测试环境发起提测：${selectedPR.branch}`)}>
                        <Send className="w-4 h-4 mr-2" />
                        提测
                      </Button>
                    </div>
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    代码合并请求详细评审结果
                  </SheetDescription>
                </SheetHeader>
              </div>
              
              <div className="flex-1 p-6 space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-destructive/5 border-destructive/20 soft-shadow">
                    <CardContent className="p-4 flex flex-col items-center justify-center">
                      <AlertCircle className="h-6 w-6 text-destructive mb-2" />
                      <div className="text-2xl font-bold text-destructive">{selectedPR.issues.errors}</div>
                      <div className="text-xs text-muted-foreground mt-1">阻断问题</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-amber-500/5 border-amber-500/20 soft-shadow">
                    <CardContent className="p-4 flex flex-col items-center justify-center">
                      <AlertTriangle className="h-6 w-6 text-amber-500 mb-2" />
                      <div className="text-2xl font-bold text-amber-500">{selectedPR.issues.warnings}</div>
                      <div className="text-xs text-muted-foreground mt-1">警告建议</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-blue-500/5 border-blue-500/20 soft-shadow">
                    <CardContent className="p-4 flex flex-col items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-blue-500 mb-2" />
                      <div className="text-2xl font-bold text-blue-500">{selectedPR.issues.info}</div>
                      <div className="text-xs text-muted-foreground mt-1">优化建议</div>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-4">评审详情</h3>
                  {selectedPR.status === 'pending' ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Clock className="h-12 w-12 mb-4 opacity-20 animate-pulse" />
                      <p>AI 正在全力评审中，请稍候...</p>
                    </div>
                  ) : selectedPR.issues.errors === 0 && selectedPR.issues.warnings === 0 && selectedPR.issues.info === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <CheckCircle2 className="h-12 w-12 mb-4 text-green-500/50" />
                      <p>代码质量优秀，未发现明显问题，符合规范。</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <CheckCircle2 className="h-12 w-12 mb-4 text-green-500/50" />
                      <p>代码质量优秀，未发现明显问题，符合规范。</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};