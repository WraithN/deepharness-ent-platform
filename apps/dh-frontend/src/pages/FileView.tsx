import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileCode2, Loader2, AlertCircle, ArrowLeft, Download, Library, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi, type FileContent, type FileVersionInfo } from '@/lib/file-api';
import { toast } from 'sonner';

/**
 * 文件查看页面。
 *
 * 通过查询参数 path 定位文件，调用 /api/v1/files/content 读取本地文件内容，
 * 在新页面中完整展示文件内容（不收缩）；支持下载和保存到飞书知识库。
 * 标题栏展示文件名和版本标记，支持切换历史版本，默认显示最新版本。
 */
export const FileView: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const path = searchParams.get('path') || '';

  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<FileVersionInfo[]>([]);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);

  const displayContent = useMemo(() => {
    if (!fileContent) return '';
    const isMarkdown = /\.(md|markdown)$/i.test(fileContent.path);
    if (isMarkdown) {
      return fileContent.content;
    }
    const lang = fileContent.language || '';
    return `\`\`\`${lang}\n${fileContent.content}\n\`\`\``;
  }, [fileContent]);

  useEffect(() => {
    if (!path) {
      setError('缺少文件路径参数');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFileContent(null);

    const load = async () => {
      try {
        const content = await fileApi.content(path);
        if (!cancelled) {
          setFileContent(content);
          if (content.versions && content.versions.length > 0) {
            setVersions(content.versions);
          }
        }
      } catch (err) {
        console.error('[FileView] load failed:', err);
        if (!cancelled) {
          setError('加载文件失败或文件不存在');
          toast.error('加载文件失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const handleVersionSwitch = async (versionPath: string) => {
    setVersionMenuOpen(false);
    if (versionPath === path) return;

    // 更新 URL 中的 path 参数，触发重新加载
    const newParams = new URLSearchParams(searchParams);
    newParams.set('path', versionPath);
    setSearchParams(newParams);
  };

  // 构造标题栏显示的文件名 + 版本标记
  const titleDisplay = useMemo(() => {
    if (!fileContent) return path || '文件查看';
    const baseName = fileContent.baseName || '';
    const ext = fileContent.ext || '';
    const version = fileContent.version;
    const fileName = baseName && ext ? `${baseName}${ext}` : fileContent.name;
    if (version !== undefined && version > 0) {
      return `${fileName} v${version}`;
    }
    return fileName;
  }, [fileContent, path]);

  // 判断是否为最新版本
  const isLatestVersion = useMemo(() => {
    if (versions.length === 0 || !fileContent) return true;
    const maxVersion = Math.max(...versions.map(v => v.version));
    return (fileContent.version ?? 0) >= maxVersion;
  }, [versions, fileContent]);

  const handleSaveToFeishu = async () => {
    if (!path) return;
    try {
      const res = await fileApi.saveToFeishu(path);
      toast.success(res.message || '已保存到飞书知识库');
    } catch (err) {
      console.error('[FileView] save to feishu failed:', err);
      toast.error('保存到飞书知识库失败');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border/50 bg-card px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => window.close()} title="关闭">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileCode2 className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h1 className="text-sm font-medium truncate">{titleDisplay}</h1>
          {/* 版本切换器 */}
          {versions.length > 1 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setVersionMenuOpen(!versionMenuOpen)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border border-border/50 bg-muted/50 hover:bg-muted transition-colors"
                title="切换版本"
              >
                <span className="text-muted-foreground">
                  {isLatestVersion ? '最新' : `v${fileContent?.version ?? 0}`}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {versionMenuOpen && (
                <>
                  {/* 点击外部关闭菜单 */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setVersionMenuOpen(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 z-20 min-w-[160px] rounded-md border border-border/50 bg-popover shadow-md py-1 max-h-60 overflow-y-auto">
                    {versions.slice().reverse().map((v) => (
                      <button
                        key={v.path}
                        type="button"
                        onClick={() => handleVersionSwitch(v.path)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2 ${
                          v.path === path ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'
                        }`}
                      >
                        <span>v{v.version}</span>
                        {v.path === path && <span className="text-primary">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {fileContent && (
          <>
            <a
              href={fileApi.downloadUrl(fileContent.path)}
              download={fileContent.name}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
              title="下载文件"
            >
              <Download className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={handleSaveToFeishu}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
              title="保存到飞书知识库"
            >
              <Library className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="max-w-5xl mx-auto p-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>正在加载文件内容...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-destructive">
            <AlertCircle className="h-8 w-8" />
            <p>{error}</p>
          </div>
        )}

        {!loading && fileContent && (
          <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
            <MarkdownView content={displayContent} collapsible={false} />
          </div>
        )}
      </div>
    </div>
  );
};
