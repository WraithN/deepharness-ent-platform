import { useCallback, useEffect, useState } from 'react';
import { templateApi } from '@/lib/template-api';
import type { DocTemplate, TemplateCategory } from '@/types';

/** 缓存键：区分「全部」与「仅已发布」。 */
const cacheKey = (category: TemplateCategory, publishedOnly: boolean): string =>
  publishedOnly ? `${category}:published` : category;

/** 同一浏览器会话内的模板缓存，避免多消费者重复请求。 */
const cache: Partial<Record<string, DocTemplate[]>> = {};

/** 同一浏览器会话内的请求去重 Promise。 */
const inflight: Partial<Record<string, Promise<DocTemplate[]> | undefined>> = {};

export interface UseTemplatesResult {
  templates: DocTemplate[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * 读取平台模板列表。
 * @param category 模板分类
 * @param publishedOnly 为 true 时只拉取已发布模板（供业务页面使用）；
 *                      为 false 时拉取全部（需超管权限）。
 */
export function useTemplates(category: TemplateCategory, publishedOnly = false): UseTemplatesResult {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const key = cacheKey(category, publishedOnly);

  const fetchList = useCallback(async (): Promise<DocTemplate[]> => {
    const cached = cache[key];
    if (cached) return cached;

    const existing = inflight[key];
    if (existing) return existing;

    const promise = templateApi
      .list(category, publishedOnly)
      .then((data) => {
        cache[key] = data;
        return data;
      })
      .catch((err) => {
        inflight[key] = undefined;
        throw err;
      });

    inflight[key] = promise;
    return promise;
  }, [category, publishedOnly, key]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchList()
      .then((data) => {
        if (!cancelled) setTemplates(data);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '加载模板失败';
          setError(err instanceof Error ? err : new Error(message));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, publishedOnly, fetchList]);

  const refresh = useCallback(async () => {
    delete cache[key];
    delete inflight[key];
    setLoading(true);
    setError(null);

    try {
      const data = await templateApi.list(category, publishedOnly);
      cache[key] = data;
      setTemplates(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '刷新模板失败';
      setError(new Error(message));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [category, publishedOnly, key]);

  return { templates, loading, error, refresh };
}
