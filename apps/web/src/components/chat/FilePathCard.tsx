import React from 'react';
import { FileCode2, ExternalLink } from 'lucide-react';

interface FilePathCardProps {
  path: string;
}

/**
 * 文件路径卡片。
 *
 * 点击后在新标签页打开文件查看页面，展示文件内容并以 markdown 格式化。
 */
export const FilePathCard: React.FC<FilePathCardProps> = ({ path }) => {
  const handleClick = () => {
    const params = new URLSearchParams();
    params.set('path', path);
    window.open(`/file-view?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 my-1 px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm max-w-full"
      title={`查看 ${path}`}
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium truncate">{path}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
    </button>
  );
};
