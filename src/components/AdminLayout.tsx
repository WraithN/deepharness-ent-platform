import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { 
  LayoutDashboard, 
  Settings as SettingsIcon,
  Server,
  Puzzle,
  MessageSquareQuote,
  FileText,
  Bot,
  LogOut,
  Terminal,
  Menu,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

const adminNavItems = [
  { path: '/admin/dashboard', label: '数据大盘', icon: LayoutDashboard },
  { path: '/admin/spaces', label: '空间管理', icon: SettingsIcon },
  { path: '/admin/skills', label: '技能管理', icon: Puzzle },
  { path: '/admin/prompts', label: '提示词管理', icon: MessageSquareQuote },
  { path: '/admin/config', label: '全局配置', icon: FileText },
];

export const AdminLayout: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('userRole');
    navigate('/login');
  };

  return (
    <div className="h-screen w-full bg-background flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Mobile Header */}
      <div className="md:hidden flex flex-col p-4 border-b border-border/50 bg-card z-20 relative gap-2">
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
            {adminNavItems.find(item => item.path === location.pathname)?.label || 'DeepHarness管理后台'}
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {location.pathname === '/admin/dashboard' && '查看平台全局统计数据与资源消耗'}
            {location.pathname === '/admin/spaces' && '管理所有的工作空间和对应权限'}
            {location.pathname === '/admin/skills' && '审核、上架或禁用系统内的技能'}
            {location.pathname === '/admin/prompts' && '审核、上架或禁用系统内的提示词'}
            {location.pathname === '/admin/config' && '管理全局的研发规范、智能体与CICD配置'}
          </span>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`
        ${mobileMenuOpen ? 'flex' : 'hidden'} 
        md:flex flex-col w-full md:w-64 border-r border-border/50 bg-card shrink-0
        absolute md:relative z-50 h-[calc(100vh-65px)] md:h-screen top-[65px] md:top-0
      `}>
        <div className="hidden md:flex items-center gap-2 font-bold text-xl p-6 border-b border-border/50 shrink-0">
          <Terminal className="h-6 w-6 text-primary" />
          <span>DeepHarness管理后台</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {adminNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border/50 p-3 bg-background flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center gap-2 rounded-xl p-2 bg-muted/30 hover:bg-muted/50 transition-colors group">
            <div
              className="flex items-center gap-3 flex-1 overflow-hidden cursor-pointer"
              onClick={() => navigate('/profile')}
            >
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

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认退出登录？</AlertDialogTitle>
            <AlertDialogDescription>
              退出后需要重新登录才能访问管理后台。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">确认退出</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-background relative flex flex-col min-w-0 h-[calc(100vh-65px)] md:h-screen">
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
          <div className="px-4 md:px-8 py-4 shrink-0 border-b border-border/50 bg-muted/30 backdrop-blur-sm sticky top-0 z-10 hidden md:block shadow-sm">
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-foreground truncate tracking-tight">
                {adminNavItems.find(item => item.path === location.pathname)?.label || 'DeepHarness管理后台'}
              </h1>
              <p className="text-sm text-muted-foreground truncate mt-1">
                {location.pathname === '/admin/dashboard' && '查看平台全局统计数据与资源消耗'}
                {location.pathname === '/admin/spaces' && '管理所有的工作空间和对应权限'}
                {location.pathname === '/admin/skills' && '审核、上架或禁用系统内的技能'}
                {location.pathname === '/admin/prompts' && '审核、上架或禁用系统内的提示词'}
                {location.pathname === '/admin/config' && '管理全局的研发规范、智能体与CICD配置'}
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
