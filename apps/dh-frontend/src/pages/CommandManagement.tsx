import { Eye, Loader2, MoreHorizontal, Terminal } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import {
  type CommandConfig,
  COMMAND_CATEGORIES,
  COMMAND_CATEGORY_LABELS,
  COMMAND_CATEGORY_ORDER,
  COMMAND_CATEGORY_OTHER_LABEL,
} from '@/lib/commands';

const COMMAND_MANAGEMENT_DESC = '查看系统指令、所属分类及对应的提示词模板';
const FILTER_ALL = 'all';
const FILTER_ALL_LABEL = '全部';
const OTHER_CATEGORY_KEY = 'other';

/** 返回指令所属分类 key（未配置分类归为 other）。 */
function getCommandCategoryKey(cmd: string): string {
  return COMMAND_CATEGORIES[cmd] ?? OTHER_CATEGORY_KEY;
}

/** 返回指令所属分类展示标签。 */
function getCommandCategoryLabelByKey(key: string): string {
  if (key === OTHER_CATEGORY_KEY) return COMMAND_CATEGORY_OTHER_LABEL;
  const cat = key as keyof typeof COMMAND_CATEGORY_LABELS;
  return COMMAND_CATEGORY_LABELS[cat] ?? COMMAND_CATEGORY_OTHER_LABEL;
}

/** 指令约束徽章：代码库/任务相关约束的可视化展示。 */
const ConstraintBadges: React.FC<{ cmd: CommandConfig }> = ({ cmd }) => {
  const badges: { label: string; variant: 'default' | 'outline' }[] = [];
  if (cmd.requireRepos) {
    badges.push({ label: '需代码库', variant: 'default' });
  } else if (cmd.allowRepos) {
    badges.push({ label: '支持代码库', variant: 'outline' });
  }
  if (cmd.allowTask) {
    badges.push({ label: '支持任务', variant: 'outline' });
  }
  if (cmd.maxRepos > 0) {
    badges.push({ label: `最多 ${cmd.maxRepos} 个`, variant: 'outline' });
  }
  if (badges.length === 0) {
    return <span className="text-xs text-muted-foreground">无</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map(b => (
        <Badge key={b.label} variant={b.variant} className="rounded-md px-2 py-0.5 text-xs font-normal">
          {b.label}
        </Badge>
      ))}
    </div>
  );
};

export const CommandManagement: React.FC = () => {
  const [commands, setCommands] = useState<CommandConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewCmd, setPreviewCmd] = useState<CommandConfig | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(FILTER_ALL);

  useEffect(() => {
    api.get<CommandConfig[]>('/v1/commands')
      .then(data => setCommands(data || []))
      .catch(err => {
        console.error('[CommandManagement] load commands failed:', err);
        toast.error('加载指令失败');
      })
      .finally(() => setLoading(false));
  }, []);

  // 仅展示实际存在指令的分类筛选项（始终包含「全部」）。
  const filterOptions = useMemo(() => {
    const usedKeys = new Set(commands.map(c => getCommandCategoryKey(c.cmd)));
    const options: { key: string; label: string }[] = [{ key: FILTER_ALL, label: FILTER_ALL_LABEL }];
    for (const cat of COMMAND_CATEGORY_ORDER) {
      if (usedKeys.has(cat)) {
        options.push({ key: cat, label: COMMAND_CATEGORY_LABELS[cat] });
      }
    }
    if (usedKeys.has(OTHER_CATEGORY_KEY)) {
      options.push({ key: OTHER_CATEGORY_KEY, label: COMMAND_CATEGORY_OTHER_LABEL });
    }
    return options;
  }, [commands]);

  const filteredCommands = useMemo(() => {
    if (activeCategory === FILTER_ALL) return commands;
    return commands.filter(c => getCommandCategoryKey(c.cmd) === activeCategory);
  }, [commands, activeCategory]);

  // 分类筛选变化时重置到第 1 页。
  const pagination = useClientPagination({ total: filteredCommands.length, resetDeps: [activeCategory] });
  const paginatedCommands = filteredCommands.slice(pagination.startIndex, pagination.endIndex);

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h4 className="text-xl font-semibold text-foreground">指令管理</h4>
        <p className="text-muted-foreground mt-1 text-sm">{COMMAND_MANAGEMENT_DESC}</p>
      </div>

      <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            指令列表
            <span className="text-sm font-normal text-muted-foreground">({filteredCommands.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {/* 分类筛选 */}
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <span className="text-sm text-muted-foreground">分类：</span>
            {filterOptions.map(opt => (
              <Button
                key={opt.key}
                variant={activeCategory === opt.key ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setActiveCategory(opt.key)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              加载指令...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <Table className="min-w-max text-[15px]">
                  <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">指令</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">分类</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">描述</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">约束</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCommands.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          暂无指令
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedCommands.map(cmd => {
                        const catKey = getCommandCategoryKey(cmd.cmd);
                        return (
                          <TableRow key={cmd.cmd} className="transition-colors hover:bg-primary/5">
                            <TableCell
                              className="px-4 py-5 whitespace-nowrap cursor-pointer hover:underline"
                              onClick={() => setPreviewCmd(cmd)}
                            >
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-primary font-medium">{cmd.cmd}</span>
                                <span className="text-xs text-muted-foreground">{cmd.label}</span>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-5 whitespace-nowrap">
                              <Badge variant="outline" className="rounded-md px-3 py-1 text-xs">
                                {getCommandCategoryLabelByKey(catKey)}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-5 max-w-xs">
                              <span className="text-muted-foreground">{cmd.desc || '-'}</span>
                            </TableCell>
                            <TableCell className="px-4 py-5">
                              <ConstraintBadges cmd={cmd} />
                            </TableCell>
                            <TableCell className="px-4 py-5 text-right whitespace-nowrap">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setPreviewCmd(cmd)}>
                                    <Eye className="h-4 w-4" /> 查看
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              <RecordPaginationBar
                total={filteredCommands.length}
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                onPageChange={pagination.onPageChange}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* 提示词模板预览弹窗 */}
      <Dialog open={!!previewCmd} onOpenChange={(open) => !open && setPreviewCmd(null)}>
        <DialogContent className="max-w-3xl w-full p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
          {previewCmd && (
            <>
              <div className="p-6 border-b border-border/50 shrink-0 bg-muted/10">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 pr-10">
                    <span className="font-mono text-primary">{previewCmd.cmd}</span>
                    <span className="text-sm font-normal text-muted-foreground">{previewCmd.label}</span>
                  </DialogTitle>
                  <DialogDescription className="sr-only">指令提示词模板</DialogDescription>
                </DialogHeader>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <p className="text-xs text-muted-foreground mb-3">
                  运行时会用用户输入填充 <code className="font-mono">{'{ARGS}'}</code>、用工作空间目录填充 <code className="font-mono">{'{WORKSPACE_PATH}'}</code>，并在前面拼接通用规则。
                </p>
                <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono bg-muted/40 rounded-lg p-4 border border-border/50">
                  {previewCmd.template || '（未配置提示词模板）'}
                </pre>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
