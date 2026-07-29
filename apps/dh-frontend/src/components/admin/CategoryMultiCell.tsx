import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import MultiSelect from '@/components/ui/multi-select';

const SAVE_SUCCESS_MESSAGE = '分类已更新';
const SAVE_FAILED_MESSAGE = '分类更新失败，请重试';
const CELL_WIDTH_CLASS = 'w-[200px]';
const CHIP_CLASS =
  'inline-flex items-center rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground';
const OVERFLOW_CHIP_CLASS =
  'inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground';

interface CategoryOption {
  value: string;
  label: string;
}

interface CategoryMultiCellProps {
  options: CategoryOption[];
  value: string[];
  onSave: (categoryIds: string[]) => Promise<void>;
  disabled?: boolean;
}

/**
 * 列表内的多分类编辑单元格。
 * 折叠态（默认）：只展示第一个分类标签 + 「+N」溢出计数，整行保持单行高度；
 * 点击后展开为完整 MultiSelect 下拉编辑，变更即保存（saving 禁用、失败回滚），
 * 点击单元格外部自动收起。技能管理与提示词管理共用（规则6）。
 */
export function CategoryMultiCell({ options, value, onSave, disabled }: CategoryMultiCellProps) {
  const [selected, setSelected] = useState<string[]>(value);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 外部数据刷新（如重新分页加载）时同步最新值。
  useEffect(() => {
    setSelected(value);
  }, [value]);

  // 展开态点击外部自动收起。
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expanded]);

  const handleChange = async (next: string[]) => {
    const previous = selected;
    setSelected(next);
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      setSelected(previous);
      toast.error(SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  const labelOf = (id: string) => options.find((o) => o.value === id)?.label ?? '';
  const selectedLabels = selected.map(labelOf).filter(Boolean);
  const overflowCount = selectedLabels.length - 1;

  return (
    <div ref={containerRef} className={CELL_WIDTH_CLASS}>
      {expanded ? (
        <MultiSelect
          options={options}
          value={selected}
          onChange={handleChange}
          disabled={disabled || saving}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setExpanded(true)}
          className="flex min-h-[36px] w-full items-center gap-1.5 rounded-lg border border-input bg-card/80 px-3 py-1.5 text-left shadow-sm transition-colors hover:border-input/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedLabels.length === 0 ? (
            <span className="text-sm text-muted-foreground">选择分类...</span>
          ) : (
            <>
              <span className={`${CHIP_CLASS} max-w-[120px] truncate`}>{selectedLabels[0]}</span>
              {overflowCount > 0 && <span className={OVERFLOW_CHIP_CLASS}>+{overflowCount}</span>}
            </>
          )}
        </button>
      )}
    </div>
  );
}
