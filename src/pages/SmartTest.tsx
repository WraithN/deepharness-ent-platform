import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Play,
  Check,
  X,
  TerminalSquare,
  FileText,
  Code2,
  Bot,
  ChevronRight,
  Activity,
  ListTodo,
  Tag,
  Globe,
  Box,
  Sparkles,
  Settings2,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { CodeBlock } from '@/components/CodeBlock';

interface TestCase {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'untested';
  code: string;
  tags: string[];
  type: 'api' | 'ui';
}

interface Requirement {
  id: string;
  title: string;
  testCases: TestCase[];
}

// Mock Data
const MOCK_REQUIREMENTS: Requirement[] = [
  {
    id: 'req-1',
    title: '用户登录功能',
    testCases: [
      {
        id: 'tc-1-1',
        title: '正确输入用户名密码登录成功',
        status: 'pass',
        code: `import pytest
from app.auth import login

def test_login_success():
    """测试正确的用户名和密码登录成功"""
    user = login("admin", "123456")
    assert user is not None
    assert user.is_authenticated == True
`,
        tags: ['登录', '正向'],
        type: 'api',
      },
      {
        id: 'tc-1-2',
        title: '密码错误提示登录失败',
        status: 'fail',
        code: `import pytest
from app.auth import login, AuthException

def test_login_fail_wrong_password():
    """测试错误的密码导致登录失败"""
    with pytest.raises(AuthException) as excinfo:
        login("admin", "wrong_pass")

    assert "Invalid credentials" in str(excinfo.value)
`,
        tags: ['登录', '异常'],
        type: 'api',
      },
    ],
  },
  {
    id: 'req-2',
    title: '购物车结算功能',
    testCases: [
      {
        id: 'tc-2-1',
        title: '购物车正常结算并扣减库存',
        status: 'untested',
        code: `import pytest
from app.cart import Cart
from app.inventory import check_stock

def test_checkout_success(mock_inventory):
    """测试购物车正常结算"""
    cart = Cart(user_id=1)
    cart.add_item("item_001", 2)

    # 执行结算
    result = cart.checkout()

    assert result.status == "success"
    assert check_stock("item_001") == mock_inventory["item_001"] - 2
`,
        tags: ['结算', '库存'],
        type: 'api',
      },
      {
        id: 'tc-2-2',
        title: '库存不足时结算失败',
        status: 'untested',
        code: `# 尚未生成代码，点击由 AI 自动编写`,
        tags: ['结算', '异常'],
        type: 'api',
      },
    ],
  },
];

export const SmartTest: React.FC = () => {
  const [requirements, setRequirements] = useState<Requirement[]>(MOCK_REQUIREMENTS);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>('tc-1-1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Checked states
  const [checkedReqs, setCheckedReqs] = useState<string[]>([]);
  const [checkedTCs, setCheckedTCs] = useState<string[]>([]);

  // AI Generate dialog
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState('');

  // Terminal output
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Tag editing
  const [newTagInput, setNewTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);

  // Selected test case info
  const selectedInfo = useMemo(() => {
    for (const req of requirements) {
      const tc = req.testCases.find((t) => t.id === selectedTestCaseId);
      if (tc) return { req, tc };
    }
    return null;
  }, [requirements, selectedTestCaseId]);

  // All test case ids
  const allTCIds = useMemo(
    () => requirements.flatMap((r) => r.testCases.map((tc) => tc.id)),
    [requirements]
  );
  const allReqIds = useMemo(() => requirements.map((r) => r.id), [requirements]);

  // Check logic
  const toggleReq = (reqId: string) => {
    setCheckedReqs((prev) =>
      prev.includes(reqId) ? prev.filter((id) => id !== reqId) : [...prev, reqId]
    );
  };

  const toggleTC = (tcId: string) => {
    setCheckedTCs((prev) =>
      prev.includes(tcId) ? prev.filter((id) => id !== tcId) : [...prev, tcId]
    );
  };

  const isAllSelected =
    checkedReqs.length === allReqIds.length && checkedTCs.length === allTCIds.length;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setCheckedReqs([]);
      setCheckedTCs([]);
    } else {
      setCheckedReqs([...allReqIds]);
      setCheckedTCs([...allTCIds]);
    }
  };

  // Filter requirements and test cases by search query
  const filteredRequirements = useMemo(() => {
    if (!searchQuery.trim()) return requirements;
    const lowerQuery = searchQuery.toLowerCase();
    return requirements
      .map((req) => {
        const matchesReq = req.title.toLowerCase().includes(lowerQuery);
        const filteredTCs = req.testCases.filter(
          (tc) =>
            tc.title.toLowerCase().includes(lowerQuery) ||
            tc.tags.some((t) => t.toLowerCase().includes(lowerQuery)) ||
            tc.type.toLowerCase().includes(lowerQuery)
        );
        if (matchesReq) return req;
        if (filteredTCs.length > 0) return { ...req, testCases: filteredTCs };
        return null;
      })
      .filter((r): r is Requirement => r !== null);
  }, [requirements, searchQuery]);

  // Tag operations
  const handleAddTag = () => {
    const tag = newTagInput.trim();
    if (!tag || !selectedInfo) return;
    setRequirements((prev) =>
      prev.map((req) => ({
        ...req,
        testCases: req.testCases.map((tc) =>
          tc.id === selectedInfo.tc.id && !tc.tags.includes(tag)
            ? { ...tc, tags: [...tc.tags, tag] }
            : tc
        ),
      }))
    );
    setNewTagInput('');
    setShowTagInput(false);
  };

  const handleRemoveTag = (tag: string) => {
    if (!selectedInfo) return;
    setRequirements((prev) =>
      prev.map((req) => ({
        ...req,
        testCases: req.testCases.map((tc) =>
          tc.id === selectedInfo.tc.id
            ? { ...tc, tags: tc.tags.filter((t) => t !== tag) }
            : tc
        ),
      }))
    );
  };

  // Execute selected items
  const hasChecked = checkedReqs.length > 0 || checkedTCs.length > 0;

  const handleExecuteTop = () => {
    if (!hasChecked) return;
    setIsRunning(true);
    setTerminalOpen(true);
    setTimeout(() => {
      setRequirements((prev) =>
        prev.map((req) => ({
          ...req,
          testCases: req.testCases.map((tc) => {
            const inReq = checkedReqs.includes(req.id);
            const inTc = checkedTCs.includes(tc.id);
            if (inReq || inTc) {
              return { ...tc, status: Math.random() > 0.3 ? 'pass' : 'fail' };
            }
            return tc;
          }),
        }))
      );
      setIsRunning(false);
      toast.success('用例执行完毕');
    }, 2500);
  };

  // Execute current test case only
  const handleExecuteCurrent = () => {
    if (!selectedTestCaseId) return;
    setIsRunning(true);
    setTerminalOpen(true);
    setTimeout(() => {
      setRequirements((prev) =>
        prev.map((req) => ({
          ...req,
          testCases: req.testCases.map((tc) =>
            tc.id === selectedTestCaseId
              ? { ...tc, status: Math.random() > 0.3 ? 'pass' : 'fail' }
              : tc
          ),
        }))
      );
      setIsRunning(false);
      toast.success('当前用例执行完毕');
    }, 2000);
  };

  // AI Generate from dialog
  const handleGenerate = () => {
    if (!genPrompt.trim()) {
      toast.error('请输入生成提示词');
      return;
    }
    if (!selectedInfo) {
      toast.error('请先选择一个需求');
      return;
    }
    setGenDialogOpen(false);
    setIsGenerating(true);
    setTimeout(() => {
      const newTC: TestCase = {
        id: `tc-${Date.now()}`,
        title: `AI生成：${genPrompt.slice(0, 20)}${genPrompt.length > 20 ? '...' : ''}`,
        status: 'untested',
        code: `import pytest
from app.${selectedInfo.req.title.includes('登录') ? 'auth' : 'cart'} import *

def test_ai_generated_case():
    """AI 根据提示生成: ${genPrompt}"""
    # TODO: 实现测试逻辑
    assert True
`,
        tags: ['AI生成'],
        type: 'api',
      };
      setRequirements((prev) =>
        prev.map((req) =>
          req.id === selectedInfo.req.id
            ? { ...req, testCases: [...req.testCases, newTC] }
            : req
        )
      );
      setSelectedTestCaseId(newTC.id);
      setIsGenerating(false);
      setGenPrompt('');
      toast.success('AI 已成功生成测试用例');
    }, 1500);
  };

  // Update code
  const handleUpdateCode = (newCode: string) => {
    if (!selectedTestCaseId) return;
    setRequirements((prev) =>
      prev.map((req) => ({
        ...req,
        testCases: req.testCases.map((tc) =>
          tc.id === selectedTestCaseId ? { ...tc, code: newCode } : tc
        ),
      }))
    );
  };

  return (
    <div className="flex-1 space-y-4 md:space-y-6 max-w-7xl mx-auto w-full pb-12 flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border/50 pb-4 shrink-0">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">测试用例</h2>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            按需求分类管理测试用例，支持 AI 自动化编写并一键执行。
          </p>
        </div>

        {/* Top Executor Bar */}
        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
              checked={isAllSelected}
              onCheckedChange={toggleSelectAll}
            />
            <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
              全选
            </label>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground">
            已选 {checkedReqs.length} 需求 / {checkedTCs.length} 用例
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handleExecuteTop}
            disabled={!hasChecked || isRunning}
            variant={hasChecked ? 'default' : 'secondary'}
          >
            {isRunning ? (
              <Activity className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 mr-1.5" />
            )}
            执行需求用例
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-6 flex-1 min-h-0">
        {/* 左侧：需求与测试用例列表 */}
        <Card className="w-full lg:w-1/3 flex flex-col h-[400px] lg:h-full soft-shadow border-none overflow-hidden bg-card shrink-0 lg:shrink">
          <CardHeader className="py-4 border-b border-border/50 shrink-0 bg-muted/10 space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center">
                <ListTodo className="w-5 h-5 mr-2 text-primary" />
                测试用例
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setGenDialogOpen(true)}>
                <Sparkles className="w-3.5 h-3.5" />
                用例生成
              </Button>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索需求、用例或标签..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs bg-background/50 border-border/50"
              />
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
            <Accordion type="multiple" defaultValue={['req-1', 'req-2']} className="w-full">
              {filteredRequirements.map((req) => (
                <AccordionItem
                  value={req.id}
                  key={req.id}
                  className="border-b-0 border border-border/50 rounded-lg mb-3 px-3 overflow-hidden shadow-sm"
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center text-sm font-semibold text-left gap-2">
                      <Checkbox
                        checked={checkedReqs.includes(req.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleReq(req.id);
                        }}
                        className="border-muted-foreground/30 data-[state=checked]:bg-primary"
                      />
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{req.title}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-1 pb-3">
                    <div className="space-y-1.5 pl-6 border-l border-border/50 ml-2">
                      {req.testCases.map((tc) => (
                        <div
                          key={tc.id}
                          onClick={() => setSelectedTestCaseId(tc.id)}
                          className={`flex flex-col gap-1 p-2.5 rounded-md cursor-pointer transition-colors ${
                            selectedTestCaseId === tc.id
                              ? 'bg-primary/10 border-primary/30 border'
                              : 'hover:bg-muted border border-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={checkedTCs.includes(tc.id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTC(tc.id);
                              }}
                              className="mt-0.5 border-muted-foreground/30 data-[state=checked]:bg-primary"
                            />
                            <div className="flex flex-col flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-medium leading-tight truncate">
                                  {tc.title}
                                </span>
                                {tc.status === 'pass' && (
                                  <Badge
                                    variant="outline"
                                    className="bg-green-500/10 text-green-600 border-green-500/20 shrink-0 text-[10px]"
                                  >
                                    Pass
                                  </Badge>
                                )}
                                {tc.status === 'fail' && (
                                  <Badge
                                    variant="outline"
                                    className="bg-destructive/10 text-destructive border-destructive/20 shrink-0 text-[10px]"
                                  >
                                    Fail
                                  </Badge>
                                )}
                                {tc.status === 'untested' && (
                                  <Badge
                                    variant="outline"
                                    className="text-muted-foreground shrink-0 text-[10px]"
                                  >
                                    未测
                                  </Badge>
                                )}
                              </div>
                              {/* 第二行：标签和类型 */}
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                <Badge variant="outline" className="text-[10px] h-4 px-1 bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                                  {tc.type === 'api' ? 'API' : 'UI'}用例
                                </Badge>
                                {tc.tags.map((t) => (
                                  <Badge key={t} variant="secondary" className="text-[10px] h-4 px-1">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>

        {/* 右侧：代码编辑器与执行控制 */}
        <Card className="flex-1 flex flex-col soft-shadow border-none overflow-hidden">
          <CardHeader className="py-3 px-4 border-b border-border/50 bg-muted/10 shrink-0 flex flex-col gap-2 space-y-0">
            {/* 第一行：标题 + 按钮 */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {selectedInfo ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <Input
                      defaultValue={selectedInfo.tc.title}
                      className="h-7 text-sm font-medium bg-transparent border-transparent hover:border-input focus:border-input focus:bg-background px-1.5 w-auto min-w-[200px] max-w-[400px]"
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="编辑标题" onClick={() => toast.info('点击标题输入框即可直接编辑')}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">未选择测试用例</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" className="h-8" onClick={() => setGenDialogOpen(true)} disabled={isGenerating || !selectedInfo}>
                  {isGenerating ? (
                    <Activity className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  用例生成
                </Button>
                <Button size="sm" className="h-8" onClick={handleExecuteCurrent} disabled={isRunning || !selectedInfo}>
                  {isRunning ? (
                    <Activity className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  执行
                </Button>
              </div>
            </div>
            {/* 第二行：标签 */}
            {selectedInfo && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                  {selectedInfo.tc.type === 'api' ? 'API' : 'UI'}用例
                </Badge>
                {selectedInfo.tc.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] h-5 px-1.5 gap-1">
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                ))}
                {showTagInput ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTag();
                        if (e.key === 'Escape') {
                          setShowTagInput(false);
                          setNewTagInput('');
                        }
                      }}
                      placeholder="标签名"
                      className="h-5 w-20 text-[10px] px-1 py-0"
                    />
                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={handleAddTag}>
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => {
                        setShowTagInput(false);
                        setNewTagInput('');
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="icon" className="h-5 w-5 rounded-full hover:bg-muted" onClick={() => setShowTagInput(true)} title="添加标签">
                    <Plus className="w-3 h-3 text-muted-foreground" />
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 p-0 flex flex-col min-h-0 relative">
            {selectedInfo ? (
              <div className="w-full h-full overflow-auto bg-background p-4">
                <CodeBlock
                  content={selectedInfo.tc.code}
                  filename={`${selectedInfo.req.id}_${selectedInfo.tc.id}.py`}
                  language="python"
                  editable
                  onChange={handleUpdateCode}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground flex-col bg-background">
                <Code2 className="w-12 h-12 mb-4 opacity-20" />
                <p>请在左侧选择一个测试用例</p>
              </div>
            )}

            {/* Terminal Output */}
            {terminalOpen && (
              <div className="absolute bottom-0 left-0 right-0 h-56 bg-black text-zinc-50 font-mono text-xs p-4 overflow-y-auto border-t border-zinc-800 soft-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center text-zinc-400">
                    <TerminalSquare className="w-4 h-4 mr-2" /> 执行终端
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-zinc-500 hover:text-white hover:bg-zinc-800"
                    onClick={() => setTerminalOpen(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-1.5 opacity-90">
                  <p className="text-zinc-500">
                    $ deploying {selectedInfo?.req.title} to test environment...
                  </p>
                  <p className="text-zinc-500">$ setting up python virtual env...</p>
                  <p className="text-zinc-300">$ pip install pytest</p>
                  <p className="text-zinc-300">
                    $ pytest {selectedInfo?.req.id}_{selectedInfo?.tc.id}.py -v
                  </p>
                  <div className="mt-2 text-zinc-400">
                    <div>
                      ============================= test session starts
                      ==============================
                    </div>
                    <div className="mt-1 text-yellow-400 animate-pulse">collecting ...</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Generate Dialog */}
      <Dialog open={genDialogOpen} onOpenChange={setGenDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI 用例生成
            </DialogTitle>
            <DialogDescription>
              输入测试场景描述，AI 将为您自动生成对应的测试用例代码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="gen-prompt">生成提示词</Label>
              <Textarea
                id="gen-prompt"
                placeholder="例如：测试用户输入无效密码超过5次后账户被锁定..."
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                className="min-h-[120px] resize-none"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Settings2 className="w-3.5 h-3.5" />
              <span>当前关联需求：{selectedInfo?.req.title || '未选择'}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleGenerate} disabled={!genPrompt.trim()}>
              <Sparkles className="w-4 h-4 mr-1.5" />
              生成用例
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
