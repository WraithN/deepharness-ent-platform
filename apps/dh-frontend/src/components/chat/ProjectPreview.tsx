import React, { useEffect, useState, useCallback } from 'react';
import { X, ChevronRight, ChevronDown, Folder, File, FileJson, FileText, FileType, Braces, Terminal, Palette, Globe, FileCode2, Database, Image as ImageIcon, Settings, Loader2, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { DiffView } from '@/components/chat/DiffView';
import { projectApi, type ProjectFileNode } from '@/lib/project-api';
import { fileApi, type FileContent } from '@/lib/file-api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProjectPreviewProps {
  /** 工程根目录的绝对路径 */
  path: string;
  /** 预览模式：files=文件树+代码，diff=git diff */
  mode: 'files' | 'diff';
  /** 关闭预览回调 */
  onClose: () => void;
}

const FILE_TREE_INDENT_PX = 12;
const FILE_TREE_BASE_INDENT_PX = 8;
const MAX_OPEN_TABS = 8;

/**
 * 工程预览组件。
 *
 * 在 Chat 页分栏区域内渲染工程内容，支持两种模式：
 * - files：左侧目录树 + 右侧代码查看器
 * - diff：git diff 视图
 */
export const ProjectPreview: React.FC<ProjectPreviewProps> = ({ path, mode, onClose }) => {
  const projectName = path.split('/').pop() || path;

  return (
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-300">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card shrink-0 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-2 min-w-0">
          <Folder className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-sm font-medium truncate" title={path}>
            {projectName}
          </h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
            {mode === 'diff' ? 'Diff 预览' : '文件预览'}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="关闭预览">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === 'files' ? (
          <FileTreePane path={path} />
        ) : (
          <DiffPane path={path} />
        )}
      </div>
    </div>
  );
};

// ──────────────── 文件树 + 代码查看器 ────────────────

/**
 * 文件树面板：左侧目录树 + 右侧代码查看器。
 */
const FileTreePane: React.FC<{ path: string }> = ({ path }) => {
  const [tree, setTree] = useState<ProjectFileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<ProjectFileNode | null>(null);
  const [openTabs, setOpenTabs] = useState<ProjectFileNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectApi
      .tree(path)
      .then((nodes) => {
        if (!cancelled) setTree(nodes);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ProjectPreview] tree load failed:', err);
          toast.error('加载工程文件树失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path]);

  const handleSelectFile = useCallback((node: ProjectFileNode) => {
    setSelectedFile(node);
    setOpenTabs((prev) => {
      if (prev.some((t) => t.path === node.path)) return prev;
      if (prev.length >= MAX_OPEN_TABS) {
        return [...prev.slice(1), node];
      }
      return [...prev, node];
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">正在加载文件树...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 border-r border-border/50 overflow-auto p-2 bg-card/50 animate-in fade-in duration-500">
        {tree.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">工程目录为空</p>
        ) : (
          tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              level={0}
              onSelectFile={handleSelectFile}
              selectedPath={selectedFile?.path ?? null}
            />
          ))
        )}
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        {openTabs.length > 0 && (
          <div className="flex items-center border-b border-border/50 bg-card/30 overflow-x-auto shrink-0">
            {openTabs.map((tab) => (
              <button
                key={tab.path}
                onClick={() => setSelectedFile(tab)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-all duration-200 hover:bg-accent/50',
                  selectedFile?.path === tab.path
                    ? 'border-primary text-foreground bg-background'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {getFileIcon(tab.name).icon}
                <span>{tab.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {selectedFile ? (
            <FileContentViewer
              projectPath={path}
              fileNode={selectedFile}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              选择左侧文件查看内容
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * 文件树节点组件（递归）。
 */
const FileTreeNode: React.FC<{
  node: ProjectFileNode;
  level: number;
  onSelectFile: (node: ProjectFileNode) => void;
  selectedPath: string | null;
}> = ({ node, level, onSelectFile, selectedPath }) => {
  const [isOpen, setIsOpen] = useState(level === 0);
  const isFolder = node.type === 'folder';
  const isSelected = selectedPath === node.path;

  const handleClick = () => {
    if (isFolder) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node);
    }
  };

  const paddingLeft = level * FILE_TREE_INDENT_PX + FILE_TREE_BASE_INDENT_PX;
  const { icon, color } = isFolder
    ? { icon: <Folder className="h-3.5 w-3.5 text-amber-500" />, color: '' }
    : getFileIcon(node.name);

  return (
    <div className="w-full">
      <div
        className={cn(
          'group flex items-center gap-1.5 py-1.5 px-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-sm rounded-md transition-all duration-200 hover:translate-x-1',
          isSelected && 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
        )}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={handleClick}
      >
        {isFolder ? (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200', isOpen && 'rotate-90')} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={cn('shrink-0 transition-transform duration-200 group-hover:scale-110', color)}>{icon}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {isFolder && isOpen && node.children && node.children.length > 0 && (
        <div className="animate-in fade-in slide-in-from-left-2 duration-200">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 文件内容查看器：加载并渲染单个文件内容。
 */
const FileContentViewer: React.FC<{
  projectPath: string;
  fileNode: ProjectFileNode;
}> = ({ projectPath, fileNode }) => {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);

  // 构建文件的绝对路径
  const absPath = `${projectPath}/${fileNode.path}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fileApi
      .content(absPath)
      .then((data) => {
        if (!cancelled) setContent(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ProjectPreview] file content load failed:', err);
          toast.error('加载文件内容失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [absPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">正在加载...</span>
      </div>
    );
  }

  if (!content) {
    return <div className="p-4 text-sm text-muted-foreground">文件内容为空或加载失败</div>;
  }

  const isMarkdown = /\.(md|markdown)$/i.test(content.path);
  const displayContent = isMarkdown
    ? content.content
    : `\`\`\`${content.language || ''}\n${content.content}\n\`\`\``;

  return (
    <div className="p-4 animate-in fade-in zoom-in-95 duration-300">
      <MarkdownView content={displayContent} collapsible={false} />
    </div>
  );
};

// ──────────────── Diff 面板 ────────────────

/**
 * Diff 面板：加载并渲染工程的 git diff。
 */
const DiffPane: React.FC<{ path: string }> = ({ path }) => {
  const [diffText, setDiffText] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectApi
      .diff(path)
      .then((result) => {
        if (!cancelled) {
          setDiffText(result.diff);
          setHasChanges(result.hasChanges);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ProjectPreview] diff load failed:', err);
          toast.error('加载 diff 失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">正在加载 diff...</span>
      </div>
    );
  }

  if (!hasChanges) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <GitCompareArrows className="h-8 w-8 opacity-50" />
        <span className="text-sm">没有未提交的更改</span>
      </div>
    );
  }

  return (
    <div className="overflow-auto p-4 h-full">
      <DiffView content={diffText} />
    </div>
  );
};

// ──────────────── 文件图标工具 ────────────────

type IconResult = { icon: React.ReactNode; color: string };

function getFileIcon(name: string): IconResult {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return { icon: <Braces className="h-3.5 w-3.5" />, color: 'text-blue-500' };
    case 'ts':
    case 'js':
      return { icon: <FileType className="h-3.5 w-3.5" />, color: 'text-blue-400' };
    case 'json':
      return { icon: <FileJson className="h-3.5 w-3.5" />, color: 'text-amber-500' };
    case 'md':
    case 'txt':
      return { icon: <FileText className="h-3.5 w-3.5" />, color: 'text-slate-500' };
    case 'go':
      return { icon: <Terminal className="h-3.5 w-3.5" />, color: 'text-cyan-500' };
    case 'css':
    case 'scss':
    case 'less':
      return { icon: <Palette className="h-3.5 w-3.5" />, color: 'text-pink-400' };
    case 'html':
    case 'htm':
      return { icon: <Globe className="h-3.5 w-3.5" />, color: 'text-orange-400' };
    case 'py':
      return { icon: <FileCode2 className="h-3.5 w-3.5" />, color: 'text-yellow-500' };
    case 'sql':
    case 'db':
      return { icon: <Database className="h-3.5 w-3.5" />, color: 'text-indigo-400' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'gif':
      return { icon: <ImageIcon className="h-3.5 w-3.5" />, color: 'text-purple-400' };
    case 'yml':
    case 'yaml':
    case 'conf':
    case 'config':
      return { icon: <Settings className="h-3.5 w-3.5" />, color: 'text-gray-400' };
    default:
      return { icon: <File className="h-3.5 w-3.5" />, color: 'text-muted-foreground' };
  }
}
