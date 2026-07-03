import React from 'react';

interface TreeDirBlockProps {
  code: string;
}

// 树形连接线字符，用于区分结构线和内容。
const TREE_LINE_CHARS = /[├└│]/;
// 一级模块图标正则：匹配行首的 emoji 或常见图标符号。
const ICON_REGEX = /^(\s*[├└│─]*\s*)([📦✅📤📁📋🔧🎨📦📄🚀✨🔥💡]\s*)/;

/**
 * 判断代码块内容是否为目录树结构。
 * 当文本中包含树形连接线字符（├ └ │）时判定为树形块。
 */
export function isTreeDirContent(code: string): boolean {
  return TREE_LINE_CHARS.test(code);
}

/**
 * 树形目录结构渲染组件。
 *
 * 将包含 ├ └ │ 连接线的目录树文本渲染为美化版块：
 * - 连接线弱化为浅灰色
 * - 一级模块图标（📦✅📤等）放大 + 主色高亮
 * - 等宽字体 + 层级缩进
 */
export const TreeDirBlock: React.FC<TreeDirBlockProps> = ({ code }) => {
  const lines = code.split('\n');

  return (
    <pre className="tree-dir">
      {lines.map((line, idx) => {
        // 将每行拆分为：缩进/连接线部分 + 图标 + 内容
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
    </pre>
  );
};
