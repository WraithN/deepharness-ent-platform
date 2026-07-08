import React, { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { Eye, Edit3, Columns3 } from 'lucide-react';

export type EditorLayout = 'edit' | 'preview' | 'split';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  layout?: EditorLayout;
  onLayoutChange?: (layout: EditorLayout) => void;
  placeholder?: string;
  readOnly?: boolean;
}

/**
 * Markdown 双栏编辑器。
 *
 * 支持三种布局：
 * - edit：仅编辑
 * - preview：仅预览
 * - split：左侧编辑、右侧预览（默认）
 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  layout: controlledLayout,
  onLayoutChange,
  placeholder = '在此编辑 Markdown 文档…',
  readOnly = false,
}) => {
  const [internalLayout, setInternalLayout] = useState<EditorLayout>('split');
  const activeLayout = controlledLayout ?? internalLayout;
  const setActiveLayout = onLayoutChange ?? setInternalLayout;

  const showEdit = activeLayout === 'edit' || activeLayout === 'split';
  const showPreview = activeLayout === 'preview' || activeLayout === 'split';

  const LayoutButton = ({
    target,
    icon: Icon,
    label,
  }: {
    target: EditorLayout;
    icon: React.ElementType;
    label: string;
  }) => (
    <Button
      variant={activeLayout === target ? 'secondary' : 'ghost'}
      size="sm"
      className="h-8 gap-1"
      onClick={() => setActiveLayout(target)}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 shrink-0 bg-background/90">
        <div className="flex items-center gap-1">
          <LayoutButton target="edit" icon={Edit3} label="编辑" />
          <LayoutButton target="split" icon={Columns3} label="双栏" />
          <LayoutButton target="preview" icon={Eye} label="预览" />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {showEdit && (
          <div className={`${activeLayout === 'split' ? 'w-1/2 border-r' : 'w-full'} h-full p-4 overflow-auto`}>
            <Textarea
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={placeholder}
              readOnly={readOnly}
              className="w-full h-full min-h-[400px] font-mono text-sm resize-none border-none focus-visible:ring-0 bg-transparent"
            />
          </div>
        )}
        {showPreview && (
          <div className={`${activeLayout === 'split' ? 'w-1/2' : 'w-full'} h-full p-4 overflow-auto`}>
            <MarkdownView content={value} collapsible={false} />
          </div>
        )}
      </div>
    </div>
  );
};
