import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { 
  LayoutDashboard, 
  Store, 
  MessageSquare, 
  MessageCircle,
  Settings, 
  Users, 
  Menu, 
  X, 
  Terminal,
  ChevronDown,
  Code2,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  Sun,
  Moon,
  LogOut
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mockCurrentUser } from '@/mock/data';

const globalNavItems = [
  { path: '/market/skills', label: '技能市场', icon: Store },
  { path: '/market/prompts', label: '提示词市场', icon: MessageSquare },
];

const tenantNavItems = [
  { path: '/chat', label: '智能会话', icon: MessageCircle },
  { path: '/code', label: '工程代码', icon: Code2 },
  { path: '/dashboard', label: '数据大盘', icon: LayoutDashboard },
  { path: '/lobster', label: '虾班智守', icon: Bot },
  { path: '/settings', label: '空间设置', icon: Settings },
];

export const Layout: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const closeSidebar = () => setSidebarOpen(false);

  const [logoutOpen, setLogoutOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('userRole');
    navigate('/login');
    toast.success('已退出登录');
  };

  const handleCreateWorkspace = () => {
    if (!workspaceName.trim()) {
      toast.error('请输入工作区名称');
      return;
    }
    toast.success('工作区创建成功');
    setCreateWorkspaceOpen(false);
    setWorkspaceName('');
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden" 
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300 ease-in-out lg:static lg:translate-x-0 soft-shadow lg:shadow-none relative group ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'w-14' : 'w-[246px]'}`}
      >
        {/* Collapse Toggle Button */}
        <Button
          variant="outline"
          size="icon"
          className="absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-border/80 bg-background shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 hidden lg:flex items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? "展开侧边栏" : "收缩侧边栏"}
        >
          {isCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </Button>

        <div className="flex h-16 shrink-0 items-center justify-between px-4 border-b overflow-hidden">
          <div className={`flex items-center gap-2 font-bold text-lg text-primary overflow-hidden ${isCollapsed ? 'w-full justify-center px-0' : 'w-full px-2'}`}>
            <Terminal className="h-6 w-6 shrink-0 transition-all duration-300" />
            <span className={`whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>DeepHarness</span>
          </div>
          {!isCollapsed && (
            <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={closeSidebar}>
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-4 scrollbar-none hover:scrollbar-thin overflow-x-hidden">
          <div className="px-3 mb-2">
            <p className={`text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 pl-2 transition-all duration-300 whitespace-nowrap ${isCollapsed ? 'h-0 w-0 opacity-0 overflow-hidden' : 'opacity-100'}`}>
              当前工作空间
            </p>
            {isCollapsed ? (
              <div
                className="flex items-center justify-center mx-auto w-9 h-9 rounded-lg bg-primary/10 hover:bg-primary/20 cursor-pointer transition-colors"
                onClick={() => setCreateWorkspaceOpen(true)}
                title="Meego 研发中心"
              >
                <span className="text-sm font-bold text-primary">M</span>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 rounded-xl border border-border/50 p-2 bg-card hover:bg-muted/50 cursor-pointer soft-shadow justify-between"
                onClick={() => setCreateWorkspaceOpen(true)}
              >
                <div className="flex items-center gap-2 overflow-hidden w-full">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                    M
                  </div>
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">Meego 研发中心</span>
                    <span className="text-xs text-muted-foreground truncate">免费版</span>
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            )}
          </div>

          <nav className="px-3 space-y-1 mb-8 mt-6 overflow-x-hidden">
            <p className={`px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 transition-all duration-300 whitespace-nowrap ${isCollapsed ? 'h-0 w-0 opacity-0 overflow-hidden' : 'opacity-100'}`}>
              空间功能
            </p>
            {tenantNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={closeSidebar}
                title={isCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg text-sm font-medium transition-all duration-300 overflow-hidden ${
                    isCollapsed ? 'justify-center mx-auto w-9 h-9' : 'gap-3 px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-primary/10 text-primary shadow-sm'
                      : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
                  }`
                }
              >
                <item.icon className={`h-5 w-5 shrink-0 transition-colors ${location.pathname.startsWith(item.path) ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        
        <div className="shrink-0 border-t border-border/50 p-3 bg-background flex flex-col gap-2 overflow-hidden">
          {isCollapsed ? (
            <div className="flex flex-col gap-3">
              <div
                className="flex items-center justify-center mx-auto w-9 h-9 rounded-full bg-primary/10 hover:bg-primary/20 cursor-pointer transition-colors"
                title={mockCurrentUser.name}
                onClick={() => navigate('/profile')}
              >
                <span className="text-sm font-semibold text-primary">{mockCurrentUser.name.charAt(0)}</span>
              </div>
              <Button variant="ghost" size="icon" className="mx-auto w-9 h-9 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setLogoutOpen(true)} title="退出登录">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl p-2 bg-muted/30 hover:bg-muted/50 transition-colors group">
              <div
                className="flex items-center gap-3 flex-1 overflow-hidden cursor-pointer"
                onClick={() => navigate('/profile')}
              >
                <div className="h-9 w-9 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                  {mockCurrentUser.name.charAt(0)}
                </div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <span className="text-sm font-medium truncate">{mockCurrentUser.name}</span>
                  <span className="text-xs text-muted-foreground capitalize truncate">{mockCurrentUser.role}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-60 group-hover:opacity-100 transition-opacity" onClick={() => setLogoutOpen(true)} title="退出登录">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认退出登录？</AlertDialogTitle>
            <AlertDialogDescription>
              退出后需要重新登录才能访问您的工作区和项目代码。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">确认退出</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:bg-background">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/50 bg-background/95 backdrop-blur-xl px-4 lg:px-6 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-4 min-w-0">
            <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={toggleSidebar}>
              <Menu className="h-5 w-5" />
            </Button>
            
            <nav className="flex items-center gap-2 sm:gap-4 overflow-x-auto whitespace-nowrap scrollbar-none">
              {globalNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-2 text-sm font-medium transition-colors rounded-md px-2 py-1.5 ${
                      isActive
                        ? 'text-primary bg-primary/5'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          
          <div className="flex items-center gap-2 shrink-0 ml-4">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full w-8 h-8"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden md:flex">
                    <span className="truncate max-w-[120px]">Meego 研发中心</span>
                    <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>我的工作区</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="font-medium bg-primary/10 text-primary">
                    <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center mr-2 text-xs">M</div>
                    Meego 研发中心
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <div className="h-5 w-5 rounded bg-blue-100 flex items-center justify-center mr-2 text-xs text-blue-700">D</div>
                    DeepHarness Platform
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <div className="h-5 w-5 rounded bg-green-100 flex items-center justify-center mr-2 text-xs text-green-700">T</div>
                    Team Workspace
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setCreateWorkspaceOpen(true)}>
                    <Terminal className="mr-2 h-4 w-4" />
                    创建新工作区
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 bg-transparent flex flex-col">
          <div className="px-4 md:px-6 lg:px-8 py-4 shrink-0 border-b border-border/50 bg-muted/30 backdrop-blur-sm sticky top-0 z-10">
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-foreground truncate tracking-tight">
                {location.pathname === '/market/skills' && '技能市场'}
                {location.pathname === '/market/prompts' && '提示词市场'}
                {location.pathname === '/chat' && '智能会话'}
                {location.pathname === '/code' && '工程代码'}
                {location.pathname === '/dashboard' && '数据大盘'}
                {location.pathname.startsWith('/lobster') && '虾班智守'}
                {location.pathname === '/settings' && '空间设置'}
                {location.pathname === '/profile' && '个人资料'}
              </h1>
              <p className="text-sm text-muted-foreground truncate mt-1">
                {location.pathname === '/market/skills' && '发现和使用团队沉淀的各类AI技能'}
                {location.pathname === '/market/prompts' && '发现和使用团队沉淀的优质提示词'}
                {location.pathname === '/chat' && 'AI 驱动的多轮对话与问题解决辅助'}
                {location.pathname === '/code' && '查看和管理您的代码仓库文件'}
                {location.pathname === '/dashboard' && '查看团队在当前工作空间的统计数据与研发效率'}
                {location.pathname.startsWith('/lobster') && '代码守护与自动审查助手'}
                {location.pathname === '/settings' && '管理当前工作空间的成员与研发规范等配置'}
                {location.pathname === '/profile' && '管理您的个人头像、昵称与简介信息'}
              </p>
            </div>
          </div>
          <div className="flex-1 p-4 md:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      <Dialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>创建新工作区</DialogTitle>
            <DialogDescription>
              工作区是团队协作和资源共享的基础单元。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">工作区名称</Label>
              <Input 
                id="name" 
                placeholder="例如：Meego 研发中心" 
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">描述 (可选)</Label>
              <Textarea 
                id="desc" 
                placeholder="简单描述这个工作区的用途..." 
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateWorkspaceOpen(false)}>取消</Button>
            <Button onClick={handleCreateWorkspace}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};