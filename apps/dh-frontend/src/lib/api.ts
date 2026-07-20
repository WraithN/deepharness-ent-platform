/**
 * API 客户端封装
 * 统一 baseURL /api，提供 get/post/put/delete 方法
 */

const BASE_URL = "/api";

/** API 请求的默认缓存模式：禁用浏览器缓存，避免 POST/PUT 后 GET 拿到旧数据。 */
const DEFAULT_CACHE_MODE: RequestCache = "no-store";

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestInit
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: DEFAULT_CACHE_MODE,
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text;
    try {
      const data = JSON.parse(text);
      if (typeof data.message === "string" && data.message) {
        message = data.message;
      }
    } catch {
      // 非 JSON 错误响应，使用原始文本
    }
    throw new ApiError(res.status, res.statusText, message);
  }

  // 204 No Content / 202 Accepted（响应无 JSON body）
  if (res.status === 204 || res.status === 202) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, options?: RequestInit) =>
    request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>("PATCH", path, body, options),
  delete: <T>(path: string, options?: RequestInit) =>
    request<T>("DELETE", path, undefined, options),
};

export { ApiError };
