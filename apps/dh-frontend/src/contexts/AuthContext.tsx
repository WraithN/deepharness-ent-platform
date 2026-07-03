import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { UserDTO, MineWorkspaceDTO } from '@/lib/api-types';
import { PLATFORM_ROLE, SYSTEM_TENANT_ID, type PlatformRole, type SpaceRole, type SubRole } from '@/lib/role-constants';

/**
 * 认证上下文
 *
 * 身份保持机制（开发期）：
 * - 登录成功后，后端返回用户信息，前端将 user.id 存入 localStorage 作为 token。
 * - api 客户端（lib/api.ts）自动附带 Authorization: Bearer <userId> 头。
 * - 后端 Auth 中间件解析该头，将 userId 注入请求上下文。
 * - 生产环境应替换为 JWT。
 */

const TOKEN_STORAGE_KEY = 'token';
const CURRENT_WORKSPACE_ID_KEY = 'currentWorkspaceId';

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
  spaceRole: SpaceRole;
  subRole: SubRole;
}

interface AuthContextType {
  user: AuthUser | null;
  membership: WorkspaceMembership | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
  const [loading, setLoading] = useState(true);

  // 启动时根据已存 token 恢复登录态
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
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
      // 超级管理员不绑定工作空间
      if (authUser.platformRole !== PLATFORM_ROLE.SUPER_ADMIN) {
        await loadMembership(authUser);
      }
    } catch {
      // token 失效，清理本地凭证
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }

  // 拉取当前用户的工作空间成员关系，取第一个作为默认工作空间
  async function loadMembership(authUser: AuthUser) {
    try {
      const mine = await api.get<MineWorkspaceDTO[]>('/v1/workspaces/mine');
      const first = mine[0];
      if (!first) return;
      const m: WorkspaceMembership = {
        workspaceId: first.id,
        workspaceName: first.name,
        spaceRole: first.role,
        subRole: first.subRole,
      };
      setMembership(m);
      // 持久化 workspaceId 供非 React 代码（如 chat hooks）读取
      localStorage.setItem(CURRENT_WORKSPACE_ID_KEY, first.id);
    } catch {
      // 无工作空间成员关系时保持 membership 为 null
    }
  }

  async function signIn(email: string, password: string): Promise<AuthUser> {
    const res = await api.post<{ code: number; data: UserDTO }>('/v1/identity/login', { email, password });
    const authUser = toAuthUser(res.data);
    // 开发期 token 即用户 ID，api 客户端会自动附带 Authorization 头
    localStorage.setItem(TOKEN_STORAGE_KEY, authUser.id);
    setUser(authUser);
    if (authUser.platformRole !== PLATFORM_ROLE.SUPER_ADMIN) {
      await loadMembership(authUser);
    }
    return authUser;
  }

  function signOut() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(CURRENT_WORKSPACE_ID_KEY);
    setUser(null);
    setMembership(null);
  }

  return (
    <AuthContext.Provider value={{ user, membership, loading, signIn, signOut }}>
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
