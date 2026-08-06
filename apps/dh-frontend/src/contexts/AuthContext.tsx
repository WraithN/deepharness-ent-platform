import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { UserDTO, MineWorkspaceDTO } from '@/lib/api-types';
import { PLATFORM_ROLE, SYSTEM_TENANT_ID, type PlatformRole, type SpaceRole, type SubRole } from '@/lib/role-constants';
import { AUTH_TOKEN_KEY, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '@/lib/constants';

/**
 * 认证上下文
 *
 * 身份保持机制（开发期）：
 * - 登录成功后，后端返回用户信息，前端将 user.id 存入 localStorage 作为 token。
 * - 同时写入 dh_auth cookie，使 iframe / <img> 等无法设置 Authorization 头的请求也能鉴权。
 * - api 客户端（lib/api.ts）自动附带 Authorization: Bearer <userId> 头。
 * - 后端 Auth 中间件解析该头（或 cookie / query param），将 userId 注入请求上下文。
 * - 生产环境应替换为 JWT。
 */

import { getCurrentWorkspaceIdOrNull, removeCurrentWorkspaceId, setCurrentWorkspaceId } from '@/lib/workspace-utils';

/** 将 token 写入 cookie，供 iframe 等浏览器原生请求自动携带。 */
function setAuthCookie(token: string) {
  document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; path=/; max-age=${AUTH_COOKIE_MAX_AGE}`;
}

/** 清除鉴权 cookie。 */
function clearAuthCookie() {
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0`;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  tenantId: string;
  createdAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  workspaceName: string;
  tenantName: string;
  spaceRole: SpaceRole;
  subRoles: SubRole[];
}

interface AuthContextType {
  user: AuthUser | null;
  membership: WorkspaceMembership | null;
  /** 当前用户加入的全部工作空间成员关系 */
  workspaces: WorkspaceMembership[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => void;
  /** 切换当前工作空间：更新 membership 与 localStorage，调用方负责刷新页面以重载空间数据 */
  switchWorkspace: (workspaceId: string) => void;
  /** 重新拉取当前用户的工作空间列表（创建新工作区后调用），返回最新列表 */
  refreshWorkspaces: () => Promise<WorkspaceMembership[]>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toMembership(dto: MineWorkspaceDTO): WorkspaceMembership {
  return {
    workspaceId: dto.id,
    workspaceName: dto.name,
    tenantName: dto.tenantName,
    spaceRole: dto.role,
    subRoles: dto.subRoles ?? [],
  };
}

function toAuthUser(dto: UserDTO): AuthUser {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    platformRole: dto.platformRole,
    tenantId: dto.tenantId,
    createdAt: dto.createdAt,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [loading, setLoading] = useState(true);

  // 启动时根据已存 token 恢复登录态
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    restoreSession(token);
  }, []);

  async function restoreSession(token: string) {
    try {
      const me = await api.get<UserDTO>('/v1/identity/users/me');
      const authUser = toAuthUser(me);
      setUser(authUser);
      // 恢复登录态时补写 cookie，确保 iframe 子资源请求也能鉴权
      setAuthCookie(token);
      // 超级管理员不绑定工作空间
      if (authUser.platformRole !== PLATFORM_ROLE.SUPER_ADMIN) {
        await loadMembership(authUser);
      }
    } catch {
      // token 失效，清理本地凭证
      localStorage.removeItem(AUTH_TOKEN_KEY);
      clearAuthCookie();
    } finally {
      setLoading(false);
    }
  }

  // 拉取当前用户的工作空间成员关系；优先恢复 localStorage 中保存的当前工作空间，否则取第一个
  async function loadMembership(authUser: AuthUser) {
    try {
      const mine = await api.get<MineWorkspaceDTO[]>('/v1/workspaces/mine');
      const list = mine.map(toMembership);
      setWorkspaces(list);
      const savedId = getCurrentWorkspaceIdOrNull();
      const current = list.find(m => m.workspaceId === savedId) ?? list[0];
      if (!current) return;
      setMembership(current);
      // 持久化 workspaceId 供非 React 代码（如 chat hooks）读取
      setCurrentWorkspaceId(current.workspaceId);
    } catch {
      // 无工作空间成员关系时保持 membership 为 null
    }
  }

  function switchWorkspace(workspaceId: string) {
    const target = workspaces.find(m => m.workspaceId === workspaceId);
    if (!target) return;
    setMembership(target);
    setCurrentWorkspaceId(target.workspaceId);
  }

  async function refreshWorkspaces(): Promise<WorkspaceMembership[]> {
    try {
      const mine = await api.get<MineWorkspaceDTO[]>('/v1/workspaces/mine');
      const list = mine.map(toMembership);
      setWorkspaces(list);
      return list;
    } catch {
      return workspaces;
    }
  }

  async function signIn(email: string, password: string): Promise<AuthUser> {
    const res = await api.post<{ code: number; data: UserDTO }>('/v1/identity/login', { email, password });
    const authUser = toAuthUser(res.data);
    // 开发期 token 即用户 ID，api 客户端会自动附带 Authorization 头
    localStorage.setItem(AUTH_TOKEN_KEY, authUser.id);
    setAuthCookie(authUser.id);
    setUser(authUser);
    if (authUser.platformRole !== PLATFORM_ROLE.SUPER_ADMIN) {
      await loadMembership(authUser);
    }
    return authUser;
  }

  function signOut() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    clearAuthCookie();
    removeCurrentWorkspaceId();
    setUser(null);
    setMembership(null);
    setWorkspaces([]);
  }

  return (
    <AuthContext.Provider value={{ user, membership, workspaces, loading, signIn, signOut, switchWorkspace, refreshWorkspaces }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// 供外部判断是否为系统租户
export function isSystemTenant(tenantId: string): boolean {
  return tenantId === SYSTEM_TENANT_ID;
}
