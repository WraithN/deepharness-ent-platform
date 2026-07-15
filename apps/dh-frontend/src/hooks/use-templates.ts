import { useCallback, useEffect, useState } from 'react';
import { templateApi } from '@/lib/template-api';
import type { DocTemplate, TemplateCategory } from '@/types';

/** 同一浏览器会话内的模板缓存，避免多消费者重复请求。 */
const cache: Partial<Record<TemplateCategory, DocTemplate[]>> = {};

/** 同一浏览器会话内的请求去重 Promise。 */
const inflight: Partial<Record<TemplateCategory, Promise<DocTemplate[]> | undefined>> = {};

export interface UseTemplatesResult {
  templates: DocTemplate[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useTemplates(category: TemplateCategory): UseTemplatesResult {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchList = useCallback(async (): Promise<DocTemplate[]> => {
    const cached = cache[category];
    if (cached) return cached;

    const existing = inflight[category];
    if (existing) return existing;

    const promise = templateApi
      .list(category)
      .then((data) => {
        cache[category] = data;
        return data;
      })
      .catch((err) => {
        inflight[category] = undefined;
        throw err;
      });

    inflight[category] = promise;
    return promise;
  }, [category]);

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
  }, [category, fetchList]);

  const refresh = useCallback(async () => {
    delete cache[category];
    delete inflight[category];
    setLoading(true);
    setError(null);

    try {
      const data = await templateApi.list(category);
      cache[category] = data;
      setTemplates(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '刷新模板失败';
      setError(new Error(message));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [category]);

  return { templates, loading, error, refresh };
}
