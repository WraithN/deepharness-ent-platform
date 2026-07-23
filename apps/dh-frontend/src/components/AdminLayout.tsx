import React, { useMemo, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  LayoutDashboard,
  Building2,
  Puzzle,
  MessageSquareQuote,
  LayoutTemplate,
  LogOut,
  Terminal,
  Menu,
  X,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const adminNavGroups: NavGroup[] = [
  {
    title: '运营概览',
    items: [
      { path: '/admin/dashboard', label: '数据大盘', icon: LayoutDashboard, description: '查看平台全局统计数据与资源消耗' },
    ],
  },
  {
    title: '资源管理',
    items: [
      { path: '/admin/tenants', label: '租户管理', icon: Building2, description: '管理所有租户、智能体策略与租户管理员' },
    ],
  },
  {
    title: '运行管控',
    items: [
      { path: '/admin/agent-runtimes', label: 'Agent 运行时', icon: Bot, description: '管理全平台运行时实例，支持按租户、空间、智能体类型多维度筛选' },
    ],
  },
  {
    title: '能力配置',
    items: [
      { path: '/admin/skills', label: '技能管理', icon: Puzzle, description: '审核、上架或禁用系统内的技能' },
      { path: '/admin/prompts', label: '提示词管理', icon: MessageSquareQuote, description: '审核、上架或禁用系统内的提示词' },
      { path: '/admin/commands', label: '指令管理', icon: Terminal, description: '查看系统指令、所属分类及对应的提示词模板' },
      { path: '/admin/templates', label: '模板管理', icon: LayoutTemplate, description: '管理平台级需求、设计、研发规范模板' },
    ],
  },
];

export const AdminLayout: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const flatNavItems = useMemo(() => adminNavGroups.flatMap((g) => g.items), []);
  const activeItem = useMemo(
    () => flatNavItems.find((item) => item.path === location.pathname),
    [flatNavItems, location.pathname],
  );

  const handleLogout = () => {
    signOut();
    toast.success('已退出登录');
    navigate('/login');
  };

  return (
    <div className="h-screen w-full bg-background flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Mobile Header */}
      <div className="md:hidden flex flex-col p-4 border-b border-border bg-background z-20 relative gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Terminal className="h-5 w-5 text-primary" />
            <span>DeepHarness管理后台</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        <div className="flex flex-col min-w-0">
          <div className="text-xs font-semibold text-foreground truncate">
            {activeItem?.label || 'DeepHarness管理后台'}
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {activeItem?.description || ''}
          </span>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`
        ${mobileMenuOpen ? 'flex' : 'hidden'} 
        md:flex flex-col w-full md:w-64 border-r border-border bg-background shrink-0
        absolute md:relative z-50 h-[calc(100vh-65px)] md:h-screen top-[65px] md:top-0
      `}>
        <div className="hidden md:flex items-center gap-2 font-bold text-xl p-6 border-b border-border shrink-0">
          <Terminal className="h-6 w-6 text-primary" />
          <span>DeepHarness管理后台</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {adminNavGroups.map((group) => (
            <div key={group.title}>
              <div className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-250 ease-smooth ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-glow'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-glow'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-3 bg-background flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center gap-2 rounded-xl p-2 glass-card transition-all duration-250 ease-smooth group hover:border-primary/20">
            <div className="flex items-center gap-3 flex-1 overflow-hidden">
              <div className="h-9 w-9 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                A
              </div>
              <div className="flex flex-col flex-1 overflow-hidden">
                <span className="text-sm font-medium truncate">Admin</span>
                <span className="text-xs text-muted-foreground capitalize truncate">Super Admin</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-60 group-hover:opacity-100 transition-opacity" onClick={() => setLogoutOpen(true)} title="退出登录">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>确认退出登录？</DialogTitle>
            <DialogDescription>
              退出后需要重新登录才能访问管理后台。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogoutOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleLogout}>确认退出</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-background relative flex flex-col min-w-0 h-[calc(100vh-65px)] md:h-screen">
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
          <div className="px-4 md:px-8 py-4 shrink-0 border-b border-border/50 bg-panel/50 backdrop-blur-xl sticky top-0 z-10 hidden md:block">
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-foreground truncate tracking-tight">
                {activeItem?.label || 'DeepHarness管理后台'}
              </h1>
              <p className="text-sm text-muted-foreground truncate mt-1">
                {activeItem?.description || ''}
              </p>
            </div>
          </div>
          <div className="flex-1 p-4 md:p-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};
