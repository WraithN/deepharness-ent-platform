import { Plus, Shield, X } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface CategoryItem {
  id: string;
  name: string;
  builtin?: boolean;
}

interface CategoryManagerProps {
  title: string;
  categories: CategoryItem[];
  onCreate: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  loading?: boolean;
}

// 分类管理组件：用于技能 / 提示词分类的增删。
export const CategoryManager: React.FC<CategoryManagerProps> = ({
  title,
  categories,
  onCreate,
  onDelete,
  loading,
}) => {
  const [newName, setNewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error('分类名称不能为空');
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate(trimmed);
      setNewName('');
      toast.success('分类创建成功');
    } catch {
      toast.error('分类创建失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await onDelete(id);
      toast.success('分类删除成功');
    } catch {
      toast.error('分类删除失败');
    }
  };

  return (
    <Card className="soft-shadow border-none">
      <CardHeader className="pb-2 border-b">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="输入新分类名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            disabled={isSubmitting || loading}
          />
          <Button onClick={handleCreate} disabled={isSubmitting || loading}>
            <Plus className="h-4 w-4 mr-1" />
            新增
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <Badge
              key={cat.id}
              variant="secondary"
              className="inline-flex items-center gap-1"
            >
              {cat.name}
              {cat.builtin && <Shield className="h-3 w-3 text-muted-foreground" />}
              {!cat.builtin && (
                <button
                  type="button"
                  onClick={() => handleDelete(cat.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title="删除"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {categories.length === 0 && (
            <span className="text-sm text-muted-foreground">暂无分类</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
