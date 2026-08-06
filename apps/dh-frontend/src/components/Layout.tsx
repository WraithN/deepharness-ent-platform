import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Store,
  MessageSquare,
  MessageCircle,
  Settings,
  Menu,
  X,
  Terminal,
  ChevronDown,
  ChevronRight,
  Code2,
  Sun,
  Moon,
  LogOut,
  Workflow,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NotificationCenter } from '@/components/NotificationCenter';
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
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/use-permissions';
import { getSubRoleLabel, SUB_ROLE, PLATFORM_ROLE } from '@/lib/role-constants';
import { workspaceApi } from '@/lib/workspace-api';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  perm?: 'canViewCode' | 'canViewDashboard' | 'canViewSettings';
}

const globalNavItems: NavItem[] = [
  { path: '/market/skills', label: '技能市场', icon: Store },
  { path: '/market/prompts', label: '提示词市场', icon: MessageSquare },
];

const tenantNavItems: NavItem[] = [
  { path: '/chat', label: '智能会话', icon: MessageCircle },
  { path: '/personal-space', label: '个人工作台', icon: User, perm: 'canViewCode' },
  { path: '/personal/flow', label: '流程追踪', icon: Workflow },
  { path: '/dashboard', label: '数据大盘', icon: LayoutDashboard, perm: 'canViewDashboard' },
  // 虾班智守功能暂时屏蔽，侧边栏不展示。
  { path: '/settings', label: '空间设置', icon: Settings, perm: 'canViewSettings' },
];

export const Layout: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed] = useState(true);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const { user: currentUser, membership, workspaces, signOut, switchWorkspace, refreshWorkspaces } = useAuth();
  const perms = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const isSuperAdmin = currentUser?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;

  // 导航项按权限过滤：无 perm 字段的始终展示，有 perm 字段的按权限判定
  // 个人工作台（/personal-space）统一渲染为单一 NavLink，角色切换在工作台内通过 Tab 完成。
  const personalSubRoles = membership?.subRoles?.length ? membership.subRoles : [SUB_ROLE.DEVELOPER];
  const baseNavItems = tenantNavItems
    .filter(item => item.path !== '/personal-space')
    .filter(item => !item.perm || perms[item.perm]);
  const firstNavItem = baseNavItems[0];
  const otherNavItems = baseNavItems.slice(1);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const closeSidebar = () => setSidebarOpen(false);

  const renderNavItem = (item: NavItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      onClick={() => {
        closeSidebar();
      }}
      title={isCollapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center rounded-lg text-sm font-medium transition-all duration-250 ease-smooth overflow-hidden ${
          isCollapsed ? 'justify-center mx-auto w-9 h-9' : 'gap-3 px-3 py-2.5'
        } ${
          isActive
            ? 'bg-primary/10 text-primary shadow-glow border border-primary/20'
            : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground hover:shadow-glow'
        }`
      }
    >
      <item.icon className={`h-5 w-5 shrink-0 transition-colors ${location.pathname.startsWith(item.path) ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className={`whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>{item.label}</span>
    </NavLink>
  );

  const [logoutOpen, setLogoutOpen] = useState(false);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  // 切换工作空间：更新上下文与 localStorage 后整页刷新，确保各页面重新加载空间数据
  const handleSwitchWorkspace = (workspaceId: string) => {
    if (!workspaceId || workspaceId === membership?.workspaceId) return;
    const target = workspaces.find(m => m.workspaceId === workspaceId);
    if (!target) return;
    switchWorkspace(target.workspaceId);
    window.location.reload();
  };

  const handleCreateWorkspace = async () => {
    if (!workspaceName.trim()) {
      toast.error('请输入工作区名称');
      return;
    }
    if (!currentUser) {
      toast.error('请先登录');
      return;
    }
    try {
      const created = await workspaceApi.create({
        tenantId: currentUser.tenantId,
        name: workspaceName.trim(),
        ownerUserId: currentUser.id,
        subRoles: personalSubRoles,
        sourceWorkspaceId: getCurrentWorkspaceId(),
      });
      setCreateWorkspaceOpen(false);
      setWorkspaceName('');
      // 创建后立即刷新工作区列表并切换到新工作区
      await refreshWorkspaces();
      handleSwitchWorkspace(created.id);
    } catch {
      toast.error('创建工作区失败');
    }
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
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-background transition-all duration-300 ease-in-out lg:static lg:translate-x-0 relative group ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'w-14' : 'w-[246px]'}`}
      >
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {isCollapsed ? (
                  <div
                    className="flex items-center justify-center mx-auto w-9 h-9 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer"
                    title={membership?.workspaceName ?? ''}
                  >
                    <span className="text-sm font-bold text-primary">{(membership?.workspaceName ?? '?').charAt(0)}</span>
                  </div>
                ) : (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 rounded-xl p-2 glass-card click-card justify-between cursor-pointer">
                          <div className="flex items-center gap-2 overflow-hidden w-full">
                            <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                              {(membership?.workspaceName ?? '?').charAt(0)}
                            </div>
                            <div className="flex flex-col flex-1 overflow-hidden">
                              {membership?.tenantName && (
                                <span className="text-xs text-muted-foreground truncate">{membership.tenantName}</span>
                              )}
                              <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{membership?.workspaceName ?? '未加入工作空间'}</span>
                              <span className="text-xs text-muted-foreground truncate">{membership?.subRoles?.map(getSubRoleLabel).join('、') ?? ''}</span>
                            </div>
                          </div>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="max-w-xs">
                        <div className="flex flex-col gap-0.5">
                          {membership?.tenantName && (
                            <span className="text-xs text-primary-foreground/80">租户：{membership.tenantName}</span>
                          )}
                          <span className="font-medium">空间：{membership?.workspaceName ?? '未加入工作空间'}</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isCollapsed ? 'right' : 'bottom'} align="start" className="w-64">
                <DropdownMenuLabel>当前工作空间</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {workspaces.map(ws => {
                  const active = ws.workspaceId === membership?.workspaceId;
                  return (
                    <DropdownMenuItem
                      key={ws.workspaceId}
                      onClick={() => handleSwitchWorkspace(ws.workspaceId)}
                      title={ws.workspaceName}
                      className={active ? 'font-medium bg-primary/10 text-primary focus:bg-primary/15 focus:text-primary' : ''}
                    >
                      <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center mr-2 text-xs shrink-0">
                        {(ws.workspaceName ?? '?').charAt(0)}
                      </div>
                      <span className="truncate flex-1 min-w-0">{ws.workspaceName}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <nav className="px-3 space-y-1 mb-8 mt-6 overflow-x-hidden">
            <p className={`px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 transition-all duration-300 whitespace-nowrap ${isCollapsed ? 'h-0 w-0 opacity-0 overflow-hidden' : 'opacity-100'}`}>
              空间功能
            </p>
            {firstNavItem && renderNavItem(firstNavItem)}
            <NavLink
              to="/personal-space"
              onClick={() => closeSidebar()}
              title={isCollapsed ? '个人工作台' : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-lg text-sm font-medium transition-all duration-250 ease-smooth overflow-hidden ${
                  isCollapsed ? 'justify-center mx-auto w-9 h-9' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-primary/10 text-primary shadow-glow border border-primary/20'
                    : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground hover:shadow-glow'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <User className={`h-5 w-5 shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>个人工作台</span>
                </>
              )}
            </NavLink>
            {otherNavItems.map(renderNavItem)}
          </nav>
        </div>
        
        <div className="shrink-0 border-t border-border p-3 bg-background flex flex-col gap-2 overflow-hidden">
          {isSuperAdmin ? (
            <div className="flex justify-center">
              <Button variant="ghost" size="icon" className="mx-auto w-9 h-9 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setLogoutOpen(true)} title="退出登录">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : isCollapsed ? (
            <div className="flex flex-col gap-3">
              <div
                className="flex items-center justify-center mx-auto w-9 h-9 rounded-full bg-primary/10 hover:bg-primary/20 cursor-pointer transition-colors"
                title={currentUser?.name ?? ''}
                onClick={() => navigate('/profile')}
              >
                <span className="text-sm font-semibold text-primary">{currentUser?.name?.charAt(0) ?? ''}</span>
              </div>
              <Button variant="ghost" size="icon" className="mx-auto w-9 h-9 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setLogoutOpen(true)} title="退出登录">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl p-2 glass-card transition-all duration-250 ease-smooth group hover:border-primary/20">
              <div
                className="flex items-center gap-3 flex-1 overflow-hidden cursor-pointer"
                onClick={() => navigate('/profile')}
              >
                <div className="h-9 w-9 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                  {currentUser?.name?.charAt(0) ?? ''}
                </div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <span className="text-sm font-medium truncate">{currentUser?.name ?? ''}</span>
                  <span className="text-xs text-muted-foreground truncate">{membership?.subRoles?.map(getSubRoleLabel).join('、') ?? ''}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-60 group-hover:opacity-100 transition-opacity" onClick={() => setLogoutOpen(true)} title="退出登录">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>确认退出登录？</DialogTitle>
            <DialogDescription>
              退出后需要重新登录才能访问您的工作区和项目代码。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogoutOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleLogout}>确认退出</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0 bg-background">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-4 lg:px-6 sticky top-0 z-10">
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
                    `flex items-center gap-2 text-sm font-medium transition-all duration-250 ease-smooth rounded-md px-2 py-1.5 ${
                      isActive
                        ? 'text-primary bg-primary/5 shadow-glow'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 hover:shadow-glow'
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

              <NotificationCenter />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden md:flex w-44 justify-between">
                    <div className="flex items-center gap-1 overflow-hidden">
                      {membership?.tenantName && (
                        <>
                          <span className="truncate text-xs text-muted-foreground">{membership.tenantName}</span>
                          <span className="text-muted-foreground text-xs">/</span>
                        </>
                      )}
                      <span className="truncate">{membership?.workspaceName ?? '未选择'}</span>
                    </div>
                    <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>当前工作空间</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {workspaces.map(ws => {
                    const active = ws.workspaceId === membership?.workspaceId;
                    return (
                      <DropdownMenuItem
                        key={ws.workspaceId}
                        onClick={() => handleSwitchWorkspace(ws.workspaceId)}
                        title={ws.workspaceName}
                        className={active ? 'font-medium bg-primary/10 text-primary focus:bg-primary/15 focus:text-primary' : ''}
                      >
                        <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center mr-2 text-xs shrink-0">
                          {(ws.workspaceName ?? '?').charAt(0)}
                        </div>
                        <span className="truncate flex-1 min-w-0">{ws.workspaceName}</span>
                      </DropdownMenuItem>
                    );
                  })}
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
          <div className="px-4 md:px-6 lg:px-8 py-4 shrink-0 border-b border-border/50 bg-panel/50 backdrop-blur-xl sticky top-0 z-10">
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-foreground truncate tracking-tight">
                {location.pathname === '/market/skills' && '技能市场'}
                {location.pathname === '/market/prompts' && '提示词市场'}
                {location.pathname === '/chat' && '智能会话'}
                {location.pathname === '/personal-space' && '个人工作台'}
                {location.pathname === '/personal/flow' && '流程追踪'}
                {location.pathname === '/dashboard' && '数据大盘'}
                {location.pathname.startsWith('/personal-assistant') && '虾班智守'}
                {location.pathname === '/settings' && '空间设置'}
                {location.pathname === '/profile' && '个人资料'}
              </h1>
              <p className="text-sm text-muted-foreground truncate mt-1">
                {location.pathname === '/market/skills' && '发现和使用团队沉淀的各类AI技能'}
                {location.pathname === '/market/prompts' && '发现和使用团队沉淀的优质提示词'}
                {location.pathname === '/chat' && 'AI 驱动的多轮对话与问题解决辅助'}
                {location.pathname === '/personal-space' && '需求追踪与角色工作台'}
                {location.pathname === '/personal/flow' && 'AI 开发流程的阶段追踪与看板视图'}
                {location.pathname === '/dashboard' && '查看团队在当前工作空间的统计数据与研发效率'}
                {location.pathname.startsWith('/personal-assistant') && '代码守护与自动审查助手'}
                {location.pathname === '/settings' && '管理当前工作空间的成员与智能体规约等配置'}
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
                placeholder="例如：研发中心"
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