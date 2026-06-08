import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, MessageSquare, Loader2, Sparkles, Wand2, User, ChevronRight, ChevronLeft, Briefcase } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

// Mock lobsters data
const MOCK_LOBSTERS = [
  { id: 'lob-1', name: '大钳子', role: '测试虾', desc: '专注寻找代码中的 Bug，不放过任何一个角落', creator: 'Meego', isMine: true },
  { id: 'lob-2', name: '小红须', role: '开发虾', desc: '精通多语言的高效编码助手，擅长快速实现功能', creator: '张三', isMine: false }
];

const AVAILABLE_ROLES = [
  { id: '测试虾', title: '测试虾', desc: '专注寻找代码中的 Bug，编写自动化测试用例', icon: '🐞' },
  { id: '运维虾', title: '运维虾', desc: '监控系统状态，配置 CI/CD 流水线，保障系统稳定', icon: '🔧' },
  { id: '设计虾', title: '设计虾', desc: 'UI/UX 设计专家，提供绝佳的交互体验方案', icon: '🎨' },
  { id: '开发虾', title: '开发虾', desc: '精通前端/后端的高效编码助手，快速实现复杂业务', icon: '💻' },
  { id: '产品虾', title: '产品虾', desc: '需求分析与产品规划，绘制 PRD 和原型设计', icon: '📝' },
  { id: '运营虾', title: '运营虾', desc: '数据分析与活动策划，提升用户活跃度与留存', icon: '📊' },
];

export const LobsterAssistant: React.FC = () => {
  const navigate = useNavigate();
  const [lobsters, setLobsters] = useState(MOCK_LOBSTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Create Wizard State
  const [step, setStep] = useState(1);
  const [newLobsterName, setNewLobsterName] = useState('');
  const [newLobsterDesc, setNewLobsterDesc] = useState('');
  const [newLobsterRole, setNewLobsterRole] = useState('');

  const openCreateModal = () => {
    setStep(1);
    setNewLobsterName('');
    setNewLobsterDesc('');
    setNewLobsterRole('');
    setCreateOpen(true);
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (!newLobsterName.trim()) {
        toast.error('请输入虾班智守的名称');
        return;
      }
      setStep(2);
    }
  };

  const handleCreate = (selectedRole: string) => {
    setNewLobsterRole(selectedRole);
    setStep(3);
    setIsLoading(true);
    
    // Simulate summoning delay
    setTimeout(() => {
      const newLobster = {
        id: `lob-${Date.now()}`,
        name: newLobsterName,
        role: selectedRole,
        desc: newLobsterDesc || `您的专属${selectedRole}，随时准备为您效劳！`,
        creator: 'Meego',
        isMine: true
      };
      
      setLobsters([...lobsters, newLobster]);
      setIsLoading(false);
      setCreateOpen(false);
      toast.success('虾班智守召唤成功！');
    }, 2500);
  };

  const roleColors: Record<string, string> = {
    '测试虾': 'bg-red-500/10 text-red-500 border-red-500/20',
    '运维虾': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    '设计虾': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    '开发虾': 'bg-green-500/10 text-green-500 border-green-500/20',
    '产品虾': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    '运营虾': 'bg-pink-500/10 text-pink-500 border-pink-500/20',
  };

  return (
    <div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12">
      {/* Banner */}
      <div className="relative w-full rounded-2xl overflow-hidden soft-shadow group bg-[#4a72d4]/20">
        <img 
          src="https://miaoda-conversation-file.cdn.bcebos.com/user-byc66ang2qrk/app-bycc1mwfyi9t/20260605/jimeng-2026-06-05-7065-保持原图所有内容不变，仅调整图片宽高比例，维持内容完整.png" 
          alt="Lobster Assistant Banner" 
          className="w-full h-auto object-contain block z-10 group-hover:scale-105 transition-transform duration-700"
        />
      </div>

      <div className="flex items-center justify-between mt-8 mb-4">
        <h2 className="text-2xl font-bold">智守团队</h2>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Create Card */}
        <Card 
          className="h-full min-h-[320px] flex flex-col items-center justify-center border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-colors soft-shadow group"
          onClick={openCreateModal}
        >
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Plus className="w-8 h-8 text-primary" />
          </div>
          <h3 className="font-semibold text-lg">召唤新智守</h3>
          <p className="text-sm text-muted-foreground mt-1">创建您的专属小助手</p>
        </Card>

        {/* Lobster Cards */}
        {lobsters.map(lobster => (
          <Card 
            key={lobster.id} 
            className={`h-full flex flex-col soft-shadow cursor-pointer transition-all overflow-hidden group claude-card ${!lobster.isMine ? 'opacity-70 grayscale-[20%]' : 'hover:-translate-y-1'}`}
            onClick={() => {
              if (lobster.isMine) {
                navigate(`/lobster/chat/${lobster.id}`);
              } else {
                toast.info('只能与自己创建的智守进行沟通');
              }
            }}
          >
            <div className="h-24 bg-gradient-to-r from-red-500/20 to-orange-400/20 flex items-center justify-center relative overflow-hidden shrink-0">
              <img 
                src="https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_8eeafa02-093e-49b1-b111-0ce2c924d417.jpg" 
                alt="Lobster Avatar" 
                className="w-16 h-16 rounded-full object-cover border-2 border-background shadow-sm z-10"
              />
              <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px]" />
            </div>
            <CardHeader className="text-center pt-4 pb-2 relative z-10">
              <CardTitle className="text-lg flex items-center justify-center gap-2">
                {lobster.name}
              </CardTitle>
              <div className="flex justify-center mt-2">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${roleColors[lobster.role] || 'bg-secondary text-secondary-foreground'}`}>
                  {lobster.role}
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col text-center pb-4">
              <p className="text-sm text-muted-foreground line-clamp-3 flex-1 mb-4">{lobster.desc}</p>
              
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-4">
                <User className="w-3.5 h-3.5" />
                <span>创建人: {lobster.creator}</span>
              </div>
              
              <Button 
                variant="ghost" 
                disabled={!lobster.isMine}
                onClick={() => {
                  if (lobster.isMine) {
                    navigate(`/lobster/chat/${lobster.id}`);
                  }
                }}
                className={`w-full mt-auto ${lobster.isMine ? 'group-hover:bg-primary group-hover:text-primary-foreground transition-colors' : ''}`}
              >
                <MessageSquare className="w-4 h-4 mr-2" /> 去沟通
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => !isLoading && setCreateOpen(open)}>
        <DialogContent className={`sm:max-w-[${step === 2 ? '600px' : '425px'}] transition-all duration-300`}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="relative">
                <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full animate-pulse" />
                <Wand2 className="w-16 h-16 text-red-500 animate-bounce relative z-10" />
                <Sparkles className="w-6 h-6 text-yellow-500 absolute -top-2 -right-2 animate-ping" />
              </div>
              <h3 className="text-xl font-bold animate-pulse">正在召唤虾班智守...</h3>
              <p className="text-sm text-muted-foreground">即将为您分配最得力的助手</p>
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mt-4" />
            </div>
          ) : step === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>第一步：设定基本信息</DialogTitle>
                <DialogDescription>
                  为您的新助手设定一个独特的名称和介绍。
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">
                    智守名称 <span className="text-red-500">*</span>
                  </Label>
                  <Input 
                    id="name" 
                    value={newLobsterName} 
                    onChange={e => setNewLobsterName(e.target.value)} 
                    placeholder="例如：超级小龙虾"
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="desc">
                    功能描述
                  </Label>
                  <Textarea 
                    id="desc" 
                    value={newLobsterDesc} 
                    onChange={e => setNewLobsterDesc(e.target.value)} 
                    placeholder="描述一下这个助手的主要职责或特点..."
                    className="resize-none h-24"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button onClick={handleNextStep}>下一步 <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>第二步：分配智守角色</DialogTitle>
                <DialogDescription>
                  选择适合该助手的专业角色，赋予其特定的技能。
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 max-h-[60vh] overflow-y-auto px-1">
                {AVAILABLE_ROLES.map(role => (
                  <div 
                    key={role.id}
                    className="flex flex-col p-4 rounded-xl border border-border hover:border-primary cursor-pointer hover:bg-primary/5 transition-all text-left group"
                    onClick={() => handleCreate(role.id)}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="text-2xl">{role.icon}</div>
                      <h4 className="font-semibold">{role.title}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{role.desc}</p>
                  </div>
                ))}
              </div>
              <DialogFooter className="sm:justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> 上一步
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
