import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
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
  Code2,
  Briefcase,
  Palette,
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
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/use-permissions';
import { getSubRoleLabel, SUB_ROLE } from '@/lib/role-constants';
import type { SubRole } from '@/lib/role-constants';
import { workspaceApi } from '@/lib/workspace-api';
import type { LucideIcon } from 'lucide-react';

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
  { path: '/personal-space', label: '研发空间', icon: Code2, perm: 'canViewCode' },
  { path: '/dashboard', label: '数据大盘', icon: LayoutDashboard, perm: 'canViewDashboard' },
  { path: '/personal-assistant', label: '虾班智守', icon: Bot },
  { path: '/settings', label: '空间设置', icon: Settings, perm: 'canViewSettings' },
];

/**
 * 根据职能子角色返回代码空间的展示名称。
 * - designer → 设计空间
 * - pm → 产品空间
 * - 其他（developer/tester/space_admin/未设置）→ 研发空间
 */
function getCodeSpaceLabel(subRole: SubRole | string | undefined): string {
  if (subRole === SUB_ROLE.DESIGNER) return '设计空间';
  if (subRole === SUB_ROLE.PM) return '产品空间';
  return '研发空间';
}

/**
 * 根据职能子角色返回代码空间的图标。
 * - designer → Palette（调色板）
 * - pm → Briefcase（产品工作台）
 * - 其他 → Code2（代码）
 */
function getCodeSpaceIcon(subRole: SubRole | string | undefined): LucideIcon {
  if (subRole === SUB_ROLE.DESIGNER) return Palette;
  if (subRole === SUB_ROLE.PM) return Briefcase;
  return Code2;
}

export const Layout: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed] = useState(true);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const { user: currentUser, membership, signOut } = useAuth();
  const perms = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();

  // 导航项按权限过滤：无 perm 字段的始终展示，有 perm 字段的按权限判定
  // 同时根据当前用户的职能子角色动态替换个人空间的展示文案与图标。
  const codeSpaceLabel = getCodeSpaceLabel(membership?.subRole);
  const codeSpaceIcon = getCodeSpaceIcon(membership?.subRole);
  const visibleNavItems = tenantNavItems.map(item =>
    item.path === '/personal-space' ? { ...item, label: codeSpaceLabel, icon: codeSpaceIcon } : item
  ).filter(item => !item.perm || perms[item.perm]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const closeSidebar = () => setSidebarOpen(false);

  const [logoutOpen, setLogoutOpen] = useState(false);

  const handleLogout = () => {
    signOut();
    navigate('/login');
    toast.success('已退出登录');
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
      await workspaceApi.create({
        tenantId: currentUser.tenantId,
        name: workspaceName.trim(),
        ownerUserId: currentUser.id,
      });
      toast.success('工作区创建成功');
      setCreateWorkspaceOpen(false);
      setWorkspaceName('');
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
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300 ease-in-out lg:static lg:translate-x-0 soft-shadow lg:shadow-none relative group ${
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
            {isCollapsed ? (
              <div
                className="flex items-center justify-center mx-auto w-9 h-9 rounded-lg bg-primary/10 hover:bg-primary/20 cursor-pointer transition-colors"
                onClick={() => setCreateWorkspaceOpen(true)}
                title={membership?.workspaceName ?? ''}
              >
                <span className="text-sm font-bold text-primary">{(membership?.workspaceName ?? '?').charAt(0)}</span>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 rounded-xl border border-border/50 p-2 bg-card hover:bg-muted/50 cursor-pointer soft-shadow justify-between"
                onClick={() => setCreateWorkspaceOpen(true)}
              >
                <div className="flex items-center gap-2 overflow-hidden w-full">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                    {(membership?.workspaceName ?? '?').charAt(0)}
                  </div>
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{membership?.workspaceName ?? '未加入工作空间'}</span>
                    <span className="text-xs text-muted-foreground truncate">{membership ? getSubRoleLabel(membership.subRole) : ''}</span>
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
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => {
                  closeSidebar();
                }}
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
            <div className="flex items-center gap-2 rounded-xl p-2 bg-muted/30 hover:bg-muted/50 transition-colors group">
              <div
                className="flex items-center gap-3 flex-1 overflow-hidden cursor-pointer"
                onClick={() => navigate('/profile')}
              >
                <div className="h-9 w-9 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                  {currentUser?.name?.charAt(0) ?? ''}
                </div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <span className="text-sm font-medium truncate">{currentUser?.name ?? ''}</span>
                  <span className="text-xs text-muted-foreground truncate">{getSubRoleLabel(membership?.subRole)}</span>
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
                    <span className="truncate max-w-[120px]">{membership?.workspaceName ?? '未选择'}</span>
                    <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>当前工作空间</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="font-medium bg-primary/10 text-primary">
                    <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center mr-2 text-xs">{(membership?.workspaceName ?? '?').charAt(0)}</div>
                    {membership?.workspaceName ?? '未加入工作空间'}
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
                {location.pathname === '/personal-space' && codeSpaceLabel}
                {location.pathname === '/dashboard' && '数据大盘'}
                {location.pathname.startsWith('/personal-assistant') && '虾班智守'}
                {location.pathname === '/settings' && '空间设置'}
                {location.pathname === '/profile' && '个人资料'}
              </h1>
              <p className="text-sm text-muted-foreground truncate mt-1">
                {location.pathname === '/market/skills' && '发现和使用团队沉淀的各类AI技能'}
                {location.pathname === '/market/prompts' && '发现和使用团队沉淀的优质提示词'}
                {location.pathname === '/chat' && 'AI 驱动的多轮对话与问题解决辅助'}
                {location.pathname === '/personal-space' && '按角色组织的个人工作台'}
                {location.pathname === '/dashboard' && '查看团队在当前工作空间的统计数据与研发效率'}
                {location.pathname.startsWith('/personal-assistant') && '代码守护与自动审查助手'}
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