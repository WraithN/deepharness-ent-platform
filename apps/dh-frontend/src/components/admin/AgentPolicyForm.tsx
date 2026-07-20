import { ChevronDown, Lock, LockOpen } from 'lucide-react';
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ModelVendorSelect } from '@/components/ModelVendorSelect';
import { cn } from '@/lib/utils';
import type { AgentPolicy, AgentType, ModelVendorGroup, WorkspaceAgentConfig } from '@/types';

// 后端未返回厂商分组时的本地兜底模型列表
const FALLBACK_BUILTIN_MODELS = ['gpt-4o'];

interface AgentPolicyFormProps {
  agentTypes: AgentType[];
  modelGroups: ModelVendorGroup[];
  policy: AgentPolicy;
  onChange: (policy: AgentPolicy) => void;
  disabled?: boolean;
}

/**
 * 租户级智能体策略配置表单。
 *
 * 每个 Agent 渲染为一张可折叠卡片：
 * - 头部左侧复选框控制是否允许使用该 Agent；
 * - 右侧锁定按钮控制该 Agent 配置是否对空间管理员只读；
 * - 展开后在卡片体内完成启用开关、自定义模型、温度、Token 数等参数配置；
 * - 锁定或未启用时，卡片体自动灰化/收起，形成清晰的操作闭环。
 */
export const AgentPolicyForm: React.FC<AgentPolicyFormProps> = ({
  agentTypes,
  modelGroups,
  policy,
  onChange,
  disabled,
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const updateField = <K extends keyof AgentPolicy>(field: K, value: AgentPolicy[K]) => {
    onChange({ ...policy, [field]: value });
  };

  const isLocked = (key: string) => policy.agentConfigLocked || (policy.lockedAgentKeys ?? []).includes(key);
  const isAllowed = (key: string) => policy.allowedAgentKeys.includes(key);

  const toggleExpand = (key: string) => {
    if (!isAllowed(key)) return;
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAgentKey = (key: string, checked: boolean) => {
    const nextAllowed = checked
      ? [...policy.allowedAgentKeys, key]
      : policy.allowedAgentKeys.filter(k => k !== key);

    let nextLocked = policy.lockedAgentKeys ?? [];
    if (!checked && nextLocked.includes(key)) {
      nextLocked = nextLocked.filter(k => k !== key);
    }

    onChange({ ...policy, allowedAgentKeys: nextAllowed, lockedAgentKeys: nextLocked });

    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAgentLock = (key: string) => {
    if (policy.agentConfigLocked) return;
    const current = policy.lockedAgentKeys ?? [];
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    updateField('lockedAgentKeys', next);
  };

  const getAgentConfig = (key: string): WorkspaceAgentConfig => {
    const existing = policy.defaultAgentConfigs?.[key];
    if (existing) return existing;
    return {
      id: '',
      workspaceId: '',
      agentKey: key,
      name: agentTypes.find(a => a.key === key)?.name ?? key,
      description: '',
      enabled: true,
      isDefault: false,
      model: '',
      modelSource: 'builtin',
      baseUrl: '',
      apiKey: '',
      createdAt: '',
      updatedAt: '',
    };
  };

  const updateAgentConfig = (key: string, patch: Partial<WorkspaceAgentConfig>) => {
    const current = getAgentConfig(key);
    onChange({
      ...policy,
      defaultAgentConfigs: {
        ...policy.defaultAgentConfigs,
        [key]: { ...current, ...patch },
      },
    });
  };

  const updateAdvanced = (
    key: string,
    field: keyof NonNullable<WorkspaceAgentConfig['advancedConfig']>,
    value: number | undefined,
  ) => {
    const current = getAgentConfig(key);
    updateAgentConfig(key, {
      advancedConfig: {
        ...current.advancedConfig,
        [field]: value,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* 整体锁定：保留作为全局兜底开关 */}
      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-3">
        <div className="space-y-0.5">
          <Label className="text-sm">锁定智能体配置</Label>
          <p className="text-xs text-muted-foreground">开启后所有智能体配置对空间管理员只读</p>
        </div>
        <Switch
          checked={policy.agentConfigLocked}
          onCheckedChange={checked => updateField('agentConfigLocked', checked)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <div className="space-y-0.5">
          <Label className="text-sm">允许使用的 Coding Agent</Label>
          <p className="text-xs text-muted-foreground">
            勾选允许后可单独锁定该智能体（锁定后空间管理员无法修改其配置）
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {agentTypes.map(at => {
            const allowed = isAllowed(at.key);
            const locked = isLocked(at.key);
            const expanded = expandedKeys.has(at.key);
            const cfg = getAgentConfig(at.key);

            return (
              <div
                key={at.key}
                className={cn(
                  'rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden transition-all duration-200',
                  !allowed && 'opacity-70',
                  allowed && !locked && 'hover:border-primary/30',
                )}
              >
                {/* 卡片头部 */}
                <div
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 select-none transition-colors',
                    allowed && !locked && 'cursor-pointer hover:bg-muted/50',
                  )}
                  onClick={() => toggleExpand(at.key)}
                >
                  <Checkbox
                    id={`agent-${at.key}`}
                    checked={allowed}
                    onCheckedChange={checked => toggleAgentKey(at.key, checked === true)}
                    disabled={disabled}
                    onClick={e => e.stopPropagation()}
                  />
                  <Label
                    htmlFor={`agent-${at.key}`}
                    className="text-sm font-medium flex-1 cursor-pointer"
                    onClick={e => e.stopPropagation()}
                  >
                    {at.name}
                  </Label>

                  {allowed && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs rounded-md px-2 py-0.5',
                        locked
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {locked ? '已锁定' : '已启用'}
                    </Badge>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-7 w-7 rounded-md shrink-0',
                      locked
                        ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                        : 'text-muted-foreground hover:text-primary hover:bg-primary/10',
                    )}
                    disabled={disabled || policy.agentConfigLocked}
                    title={policy.agentConfigLocked ? '整体锁定已开启' : (locked ? '点击解锁' : '点击锁定')}
                    onClick={e => {
                      e.stopPropagation();
                      toggleAgentLock(at.key);
                    }}
                  >
                    {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                  </Button>

                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
                      expanded && 'rotate-180',
                    )}
                  />
                </div>

                {/* 卡片配置体 */}
                {allowed && expanded && (
                  <div
                    className={cn(
                      'px-4 pb-4 pt-3 border-t border-border/50 space-y-4',
                      locked && 'opacity-60 pointer-events-none',
                    )}
                  >
                    {/* 启用开关 */}
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">启用</Label>
                      <Switch
                        checked={cfg.enabled ?? true}
                        onCheckedChange={checked => updateAgentConfig(at.key, { enabled: checked })}
                        disabled={disabled}
                      />
                    </div>

                    {/* 自定义模型开关 */}
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">使用自定义模型</Label>
                      <Switch
                        checked={cfg.modelSource === 'custom'}
                        onCheckedChange={checked =>
                          updateAgentConfig(at.key, { modelSource: checked ? 'custom' : 'builtin' })
                        }
                        disabled={disabled}
                      />
                    </div>

                    {/* 模型 + 温度 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {cfg.modelSource === 'custom' ? '模型名称' : '选择模型'}
                        </Label>
                        {cfg.modelSource === 'custom' ? (
                          <Input
                            placeholder="例如: custom-model-v1"
                            value={cfg.model}
                            onChange={e => updateAgentConfig(at.key, { model: e.target.value })}
                            disabled={disabled}
                          />
                        ) : (
                          <ModelVendorSelect
                            value={cfg.model}
                            onValueChange={val => updateAgentConfig(at.key, { model: val })}
                            disabled={disabled}
                            groups={modelGroups}
                            fallbackModels={FALLBACK_BUILTIN_MODELS}
                          />
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">温度 (Temperature)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          placeholder="例如: 0.7"
                          value={cfg.temperature ?? ''}
                          onChange={e =>
                            updateAgentConfig(at.key, {
                              temperature: e.target.value ? parseFloat(e.target.value) : undefined,
                            })
                          }
                          disabled={disabled}
                        />
                      </div>
                    </div>

                    {/* 自定义模型专属字段 */}
                    {cfg.modelSource === 'custom' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Base URL</Label>
                          <Input
                            placeholder="https://api.example.com/v1"
                            value={cfg.baseUrl}
                            onChange={e => updateAgentConfig(at.key, { baseUrl: e.target.value })}
                            disabled={disabled}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">API Key</Label>
                          <Input
                            type="password"
                            placeholder="sk-..."
                            value={cfg.apiKey}
                            onChange={e => updateAgentConfig(at.key, { apiKey: e.target.value })}
                            disabled={disabled}
                          />
                        </div>
                      </div>
                    )}

                    {/* 高级参数 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">最大 Token 数</Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="例如: 4096"
                          value={cfg.advancedConfig?.maxTokens ?? ''}
                          onChange={e =>
                            updateAdvanced(at.key, 'maxTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)
                          }
                          disabled={disabled}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">上下文窗口</Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="例如: 128000"
                          value={cfg.advancedConfig?.contextWindow ?? ''}
                          onChange={e =>
                            updateAdvanced(at.key, 'contextWindow', e.target.value ? parseInt(e.target.value, 10) : undefined)
                          }
                          disabled={disabled}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Top K</Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="例如: 50"
                          value={cfg.advancedConfig?.topK ?? ''}
                          onChange={e =>
                            updateAdvanced(at.key, 'topK', e.target.value ? parseInt(e.target.value, 10) : undefined)
                          }
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
