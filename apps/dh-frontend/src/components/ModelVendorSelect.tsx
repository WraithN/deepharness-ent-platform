import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ModelVendorGroup } from '@/types';

const FALLBACK_GROUP_KEY = 'fallback';
const FALLBACK_GROUP_NAME = '内置模型';
const DEFAULT_PLACEHOLDER = '选择内置模型';
const EMPTY_TEXT = '未找到匹配的模型';

interface ModelVendorSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  groups: ModelVendorGroup[];
  fallbackModels: string[];
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 模型选择器：按厂商分组 + 在触发输入框中直接搜索。
 * 点击触发框展开下拉，输入时实时过滤模型；选择后关闭并回填。
 */
export const ModelVendorSelect: React.FC<ModelVendorSelectProps> = ({
  value,
  onValueChange,
  groups,
  fallbackModels,
  disabled,
  placeholder = DEFAULT_PLACEHOLDER,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const selectingRef = useRef(false);

  // value 外部变化时同步到输入框
  useEffect(() => {
    setSearch(value || '');
  }, [value]);

  // 关闭下拉时若未选择任何项，将输入框重置回当前已选值
  useEffect(() => {
    if (!open && !selectingRef.current) {
      setSearch(value || '');
    }
  }, [open, value]);

  const effectiveGroups: ModelVendorGroup[] =
    groups.length > 0
      ? groups
      : [{ key: FALLBACK_GROUP_KEY, name: FALLBACK_GROUP_NAME, models: fallbackModels }];

  const q = search.trim().toLowerCase();
  const filteredGroups: ModelVendorGroup[] = q
    ? effectiveGroups
        .map(g => ({ ...g, models: g.models.filter(m => m.toLowerCase().includes(q)) }))
        .filter(g => g.models.length > 0)
    : effectiveGroups;

  const firstModel = filteredGroups[0]?.models[0];

  const handleSelect = (model: string) => {
    selectingRef.current = true;
    setSearch(model);
    onValueChange(model);
    setOpen(false);
    window.setTimeout(() => {
      selectingRef.current = false;
    }, 0);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-all duration-250 ease-smooth',
            'focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-ring focus-within:bg-white',
            'disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card/80',
            !value && 'text-muted-foreground'
          )}
        >
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter' && firstModel) {
                e.preventDefault();
                handleSelect(firstModel);
              }
            }}
            disabled={disabled}
            placeholder={placeholder}
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground min-w-0"
          />
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
          {filteredGroups.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{EMPTY_TEXT}</div>
          ) : (
            filteredGroups.map(group => (
              <div key={group.key || group.name} className="mb-1 last:mb-0">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{group.name}</div>
                {group.models.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelect(m)}
                    className={cn(
                      'w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors',
                      value === m
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
