import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/use-permissions';
import type { Permissions } from '@/hooks/use-permissions';

const LOGIN_PATH = '/login';
const CHAT_PATH = '/chat';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';

/**
 * RequireAuth：未登录时重定向到登录页。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to={LOGIN_PATH} replace />;
  return <>{children}</>;
}

/**
 * RequireSuperAdmin：仅超级管理员可访问，其余重定向到智能会话。
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to={LOGIN_PATH} replace />;
  if (user.platformRole !== 'super_admin') return <Navigate to={CHAT_PATH} replace />;
  return <>{children}</>;
}

/**
 * RequireWorkspace：仅工作空间用户（非超管）可访问。
 */
export function RequireWorkspace({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to={LOGIN_PATH} replace />;
  // 超级管理员不进工作空间，重定向到超管后台
  if (user.platformRole === 'super_admin') return <Navigate to={ADMIN_DASHBOARD_PATH} replace />;
  return <>{children}</>;
}

/**
 * PermissionRoute：按权限键守卫受限页面，无权限时重定向到智能会话。
 */
export function PermissionRoute({ perm, children }: { perm: keyof Permissions; children: ReactNode }) {
  const { loading } = useAuth();
  const perms = usePermissions();
  if (loading) return null;
  if (!perms[perm]) return <Navigate to={CHAT_PATH} replace />;
  return <>{children}</>;
}
