import React from 'react';
import { MarkdownView } from './MarkdownView';
import { FilePathCard } from './FilePathCard';

const FILE_PATH_PATTERN = String.raw`(?:(?:\/|\.\.?\/)(?:[\w.-]+\/)*|(?:[\w.-]+\/)+)[\w.-]+(?:\.[A-Za-z0-9]+)?`;
const FILE_PATH_REGEX = new RegExp(`(${FILE_PATH_PATTERN})`, 'g');
const IS_FILE_PATH_REGEX = new RegExp(`^${FILE_PATH_PATTERN}$`);
const URL_REGEX = /https?:\/\/[^\s]+/g;
const URL_PLACEHOLDER_PREFIX = '__URL_';

// 常见的 slash command，不应该被识别为文件路径。
const SLASH_COMMAND_BLOCKLIST = new Set([
  '/workflows',
  '/commit',
  '/pr',
  '/review',
  '/test',
  '/fix',
  '/explain',
  '/ask',
  '/help',
]);

/**
 * 判断一段文本是否真的是文件路径，而不是 slash command 或普通目录。
 *
 * 规则：
 * - 排除已知的 slash command（如 /workflows）。
 * - 排除 URL（包含 ://）。
 * - 单段绝对/相对路径且无扩展名时，视为命令或目录，不识别为文件。
 */
function isRealFilePath(text: string): boolean {
  if (!text || text.includes('://')) return false;
  if (SLASH_COMMAND_BLOCKLIST.has(text)) return false;

  // 去掉前缀后统计段数。
  const normalized = text.replace(/^(\.\.?\/|\/)+/, '');
  const segments = normalized.split('/').filter(Boolean);
  const hasExtension = segments.length > 0 && segments[segments.length - 1].includes('.');

  // 单段且无扩展名 => 不是文件路径。
  if (segments.length === 1 && !hasExtension) return false;

  return IS_FILE_PATH_REGEX.test(text);
}

/**
 * 识别文本中的文件路径并渲染为可点击卡片，其余内容按 markdown 渲染。
 */
export const FilePathText: React.FC<{ content: string }> = ({ content }) => {
  // 先遮盖 URL，避免把 URL 中的路径误判为文件路径。
  const urlMap = new Map<string, string>();
  let counter = 0;
  const masked = content.replace(URL_REGEX, (url) => {
    const key = `${URL_PLACEHOLDER_PREFIX}${counter++}__`;
    urlMap.set(key, url);
    return key;
  });

  const parts = masked.split(FILE_PATH_REGEX);

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;

        // 还原 URL 占位符为普通链接。
        if (part.startsWith(URL_PLACEHOLDER_PREFIX) && urlMap.has(part)) {
          const url = urlMap.get(part)!;
          return (
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline text-primary break-all"
            >
              {url}
            </a>
          );
        }

        // 文件路径渲染为卡片。
        if (isRealFilePath(part)) {
          return <FilePathCard key={idx} path={part} />;
        }

        // 其余文本按 markdown 渲染。
        return <MarkdownView key={idx} content={part} />;
      })}
    </>
  );
};
