import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Camera, Save, UserCircle, LogOut, X } from 'lucide-react';
import { mockCurrentUser } from '@/mock/data';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    nickname: mockCurrentUser.name,
    description: '热爱技术，专注全栈开发，享受将创意转化为代码的过程。',
    avatarUrl: '',
    sshKey: '',
  });

  const handleLogout = () => {
    localStorage.removeItem('userRole');
    toast.success('已退出登录');
    navigate('/login');
  };

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
                onClick={() => toast.info('头像上传功能将在后续版本支持')}
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
                {mockCurrentUser.role === 'admin' ? '管理员' : mockCurrentUser.role === 'pm' ? '产品经理' : mockCurrentUser.role === 'developer' ? '开发者' : mockCurrentUser.role === 'designer' ? '设计师' : '测试人员'}
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
              {mockCurrentUser.joinedAt}
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

          <Button onClick={() => toast.success('个人资料已保存')}>
            <Save className="mr-2 h-4 w-4" /> 保存资料
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
