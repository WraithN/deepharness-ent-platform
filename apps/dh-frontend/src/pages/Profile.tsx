import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Camera, Save, UserCircle, LogOut, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getSubRoleLabel, PLATFORM_ROLE } from '@/lib/role-constants';
import { formatDateTime } from '@/lib/utils';
import { profileApi } from '@/lib/profile-api';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { user, membership, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({
    nickname: user?.name ?? '',
    description: '',
    avatarUrl: '',
    sshKey: '',
  });

  // 超级管理员不允许设置个人信息，直接重定向到租户管理
  useEffect(() => {
    if (user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN) {
      navigate('/admin/tenants', { replace: true });
    }
  }, [user, navigate]);

  // 从后端加载个人信息
  useEffect(() => {
    let cancelled = false;
    profileApi.get()
      .then(data => {
        if (cancelled) return;
        setProfile({
          nickname: user?.name ?? '',
          description: data.description || '',
          avatarUrl: data.avatarUrl || '',
          sshKey: data.sshKey || '',
        });
      })
      .catch(() => { /* 加载失败时保留空值 */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.name]);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await profileApi.save({
        name: profile.nickname,
        avatarUrl: profile.avatarUrl,
        description: profile.description,
        sshKey: profile.sshKey,
      });
    } catch {
      toast.error('保存个人资料失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="flex-1 space-y-6 max-w-4xl mx-auto w-full pb-12">
      <div className="flex items-center justify-between pb-2">
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate(-1)}>
          <X className="h-4 w-4 mr-2" />
          关闭
        </Button>
        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 hidden sm:flex" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-2" />
          退出登录
        </Button>
      </div>

      <Card className="soft-shadow border-none">
        <CardContent className="space-y-8 pt-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center sm:flex-row sm:items-start gap-6">
            <div className="relative group">
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold border-2 border-border overflow-hidden shrink-0">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <UserCircle className="h-10 w-10 text-primary" />
                )}
              </div>
              <button
                className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                onClick={() => {}}
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2 flex-1 w-full">
              <Label>头像链接</Label>
              <Input
                placeholder="输入头像图片 URL..."
                value={profile.avatarUrl}
                onChange={e => setProfile({ ...profile, avatarUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">支持 JPG、PNG、GIF 格式，建议尺寸 200x200 像素</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="nickname">昵称</Label>
              <Input
                id="nickname"
                placeholder="请输入昵称"
                value={profile.nickname}
                onChange={e => setProfile({ ...profile, nickname: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">角色</Label>
              <div className="h-9 px-3 rounded-md border border-input bg-muted/30 flex items-center text-sm text-muted-foreground">
                {membership?.subRoles?.map(getSubRoleLabel).join('、') || '成员'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">个人描述</Label>
            <Textarea
              id="description"
              placeholder="简单介绍一下自己..."
              value={profile.description}
              onChange={e => setProfile({ ...profile, description: e.target.value })}
              className="min-h-[100px] resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label>加入时间</Label>
            <div className="h-9 px-3 rounded-md border border-input bg-muted/30 flex items-center text-sm text-muted-foreground">
              {user?.createdAt ? formatDateTime(user.createdAt) : '-'}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sshKey">Git SSH Key</Label>
            <Textarea
              id="sshKey"
              value={profile.sshKey}
              onChange={(e) => setProfile({ ...profile, sshKey: e.target.value })}
              placeholder="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC..."
              className="resize-none h-24 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">配置您的 Git SSH Key，用于代码库的授权访问。</p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" /> {saving ? '保存中...' : '保存资料'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
