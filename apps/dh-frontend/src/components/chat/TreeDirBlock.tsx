import React from 'react';

interface TreeDirBlockProps {
  code: string;
}

// 树形连接线字符，包含 Unicode 制表符（├ └ │ ─ 等）与 ASCII 字符（| + - ` \ / =）。
const TREE_CONNECTOR_CHARS = /[|+\-`\\/=\u2500-\u257F]/;
// 一级模块图标正则：匹配行首的连接线后可选的 emoji 或常见图标符号。
const ICON_REGEX = /^(\s*[|+\-`\\/=\u2500-\u257F]*\s*)(([📦✅📤📁📋🔧🎨📄🚀✨🔥💡])\s*)?/;

/**
 * 判断代码块内容是否为目录树结构。
 * 1. 包含 Unicode 制表符直接判定为树。
 * 2. 至少 3 行以树形连接符（ASCII 或 Unicode）开头，则判定为 ASCII 树。
 *    注意：只检查行首字符，避免含 / - = 等字符的普通代码（如 Mermaid）被误判。
 */
export function isTreeDirContent(code: string): boolean {
  const lines = code.split('\n');
  if (lines.some((line) => /[\u2500-\u257F]/.test(line))) return true;
  const treeLikeLines = lines.filter((line) => {
    const trimmed = line.trimStart();
    return trimmed.length > 0 && TREE_CONNECTOR_CHARS.test(trimmed[0]);
  });
  return treeLikeLines.length >= 3;
}

/**
 * 树形目录结构渲染组件。
 *
 * 将包含 ├ └ │ ─ 或 | + - ` \ / = 连接线的目录树文本渲染为美化版块：
 * - 连接线弱化为浅灰色
 * - 一级模块图标（📦✅📤等）放大 + 主色高亮
 * - 等宽字体 + 层级缩进 + 自动折行
 */
export const TreeDirBlock: React.FC<TreeDirBlockProps> = ({ code }) => {
  const lines = code.split('\n');

  return (
    <div className="tree-dir">
      {lines.map((line, idx) => {
        // 将每行拆分为：缩进/连接线部分 + 可选图标 + 内容
        const iconMatch = line.match(ICON_REGEX);
        if (iconMatch) {
          const [, indent, icon] = iconMatch;
          const rest = line.slice(iconMatch[0].length);
          return (
            <span key={idx} className="tree-line">
              <span className="tree-indent">{indent}</span>
              <span className="tree-icon">{icon}</span>
              <span className="tree-text">{rest}</span>
            </span>
          );
        }
        return (
          <span key={idx} className="tree-line">
            <span className="tree-indent">{line}</span>
          </span>
        );
      })}
    </div>
  );
};
