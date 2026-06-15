import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

// 本地 User 类型，避免依赖 Supabase 的 User 类型。
// 后续后端用户接口稳定后，可迁移至 packages/api-types 共享类型。
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface Profile {
  id: string;
  userId: string;
  name: string;
  avatar?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signInWithUsername: (username: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithUsername: (username: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider 为占位实现。
 *
 * 说明：
 * - 原实现依赖 Supabase（PostgreSQL 后端即服务），在迁移到 MySQL 自托管架构后，
 *   移除 Supabase 依赖，改为基于后端 API 的占位实现。
 * - 当前默认未登录，登录/注册/登出均为空实现，确保 UI 可正常编译运行。
 * - 后续接入 identity-service 后，应替换为真实的 /api/v1/auth/* 调用。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }

    // 占位：后续替换为 GET /api/v1/users/me
    setProfile({
      id: user.id,
      userId: user.id,
      name: user.name,
    });
  };

  useEffect(() => {
    // 占位：后续替换为 GET /api/v1/auth/session
    const timer = setTimeout(() => {
      setLoading(false);
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  const signInWithUsername = async (_username: string, _password: string) => {
    try {
      // 占位：后续替换为 POST /api/v1/auth/signin
      toast.info('登录功能尚未接入后端，当前为占位实现');
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUpWithUsername = async (_username: string, _password: string) => {
    try {
      // 占位：后续替换为 POST /api/v1/auth/signup
      toast.info('注册功能尚未接入后端，当前为占位实现');
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    // 占位：后续替换为 POST /api/v1/auth/signout
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithUsername, signUpWithUsername, signOut, refreshProfile }}>
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
