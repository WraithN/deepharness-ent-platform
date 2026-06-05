import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Terminal, Github, Mail, ArrowRight, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState('admin');
  const [currentSlide, setCurrentSlide] = useState(0);

  const slogans = [
    { title: "全栈协同，多端智研", desc: "智能会话、需求分析、代码评审、自动化测试。一站式 AI 研发协作平台，让开发更高效。" },
    { title: "规范统驭，提质增效", desc: "统一团队编码规范和设计规范，自动化检查，减少代码坏味道，提升软件交付质量。" },
    { title: "虾班智守，下班无忧", desc: "全天候监控应用状态与问题，智能告警与分析定位，让您下班后也能高枕无忧。" }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slogans.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slogans.length]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Mock login based on username
    let role = 'user';
    if (username === 'superadmin') role = 'superadmin';
    else if (username === 'admin') role = 'admin';

    setTimeout(() => {
      setIsLoading(false);
      localStorage.setItem('userRole', role);
      toast.success('登录成功', { description: `欢迎回到 DeepHarness Platform (${role}模式)` });
      if (role === 'superadmin') {
        navigate('/admin/dashboard');
      } else {
        navigate('/chat');
      }
    }, 800);
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left section - Branding/Hero */}
      <div className="hidden lg:flex flex-col flex-1 bg-zinc-950 p-12 text-white relative overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-30">
          <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full bg-primary blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600 blur-[120px]" />
        </div>
        
        <div className="relative z-10 flex items-center gap-2 font-bold text-2xl mb-12">
          <Terminal className="h-8 w-8 text-primary" />
          <span>DeepHarness Platform</span>
        </div>
        
        <div className="relative z-10 my-auto max-w-lg transition-opacity duration-500">
          <h1 className="text-5xl font-extrabold tracking-tight mb-6 leading-tight">
            {slogans[currentSlide].title.split('，').map((t, i) => <React.Fragment key={i}>{t}<br/></React.Fragment>)}
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed mb-8 h-20">
            {slogans[currentSlide].desc}
          </p>
          
          <div className="flex items-center gap-4 text-sm text-zinc-300 mb-8">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-400" />
              <span>智能编码助手</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-zinc-700" />
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-400" />
              <span>自动化 PR 评审</span>
            </div>
          </div>
          
          <div className="flex gap-2">
            {slogans.map((_, i) => (
              <button 
                key={i} 
                onClick={() => setCurrentSlide(i)}
                className={`h-1.5 rounded-full transition-all ${i === currentSlide ? 'w-8 bg-primary' : 'w-4 bg-zinc-700 hover:bg-zinc-500'}`}
              />
            ))}
          </div>
        </div>
        
        <div className="relative z-10 text-sm text-zinc-500 mt-auto">
          &copy; 2026 DeepHarness Platform. All rights reserved.
        </div>
      </div>

      {/* Right section - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12 relative">
        <div className="w-full max-w-[400px] space-y-8">
          <div className="text-center lg:text-left">
            <div className="flex items-center justify-center lg:justify-start gap-2 font-bold text-2xl mb-6 lg:hidden">
              <Terminal className="h-8 w-8 text-primary" />
              <span>DeepHarness Platform</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">欢迎回来</h2>
            <p className="text-muted-foreground mt-2">请输入用户名 (superadmin/admin/user)</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input 
                  id="username" 
                  type="text" 
                  placeholder="superadmin, admin, user" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required 
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">密码</Label>
                  <a href="#" className="text-sm text-primary hover:underline font-medium">忘记密码？</a>
                </div>
                <Input 
                  id="password" 
                  type="password" 
                  defaultValue="password123"
                  required 
                  className="h-11"
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={isLoading}>
              {isLoading ? '登录中...' : '登录'}
              {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/50" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                其他登录方式
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Button variant="outline" className="h-11 bg-background hover:bg-muted/50 border-border/50" type="button" onClick={handleLogin}>
              <Github className="mr-2 h-4 w-4" />
              Github
            </Button>
            <Button variant="outline" className="h-11 bg-background hover:bg-muted/50 border-border/50" type="button" onClick={handleLogin}>
              <Mail className="mr-2 h-4 w-4" />
              SSO 登录
            </Button>
          </div>
          
          <p className="text-center text-sm text-muted-foreground mt-8">
            还未拥有账号？{' '}
            <a href="#" className="text-primary hover:underline font-medium">
              联系管理员开通
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};