import React from 'react';
import { FileCode2 } from 'lucide-react';

interface DiffLine {
  type: 'context' | 'del' | 'add';
  oldNum?: number;
  newNum?: number;
  content: string;
}

function parseDiffV2(diffText: string): DiffLine[] {
  const lines = diffText.split('\n');
  const result: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      continue;
    }
    if (line.startsWith('-')) {
      result.push({ type: 'del', oldNum: oldLineNum, content: line.slice(1) });
      oldLineNum++;
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', newNum: newLineNum, content: line.slice(1) });
      newLineNum++;
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      result.push({ type: 'context', oldNum: oldLineNum, newNum: newLineNum, content });
      oldLineNum++;
      newLineNum++;
    }
  }

  return result;
}

function highlightLine(line: string): React.ReactNode {
  if (!line) return <span>&nbsp;</span>;

  let html = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, '<span class="text-emerald-600 dark:text-emerald-400">$&</span>');
  html = html.replace(/(\/\/.*)/g, '<span class="text-gray-500 italic">$&</span>');
  html = html.replace(/\b(interface|class|function|const|let|var|import|export|from|return|if|else|for|while|switch|case|break|continue|try|catch|throw|new|this|typeof|instanceof|async|await)\b/g, '<span class="text-purple-600 dark:text-purple-400">$&</span>');
  html = html.replace(/\b(boolean|string|number|void|any|unknown|never|object|Array|Promise|null|undefined|true|false)\b/g, '<span class="text-blue-600 dark:text-blue-400">$&</span>');
  html = html.replace(/(&lt;\/?[\w-]+)/g, '<span class="text-red-600 dark:text-red-400">$&</span>');
  html = html.replace(/\b(\w+)(?==)/g, '<span class="text-violet-600 dark:text-violet-400">$&</span>');

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

interface DiffViewProps {
  content: string;
}

export const DiffView: React.FC<DiffViewProps> = ({ content }) => {
  const lines = parseDiffV2(content);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 font-mono text-[13px] leading-relaxed my-1">
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4" />
          <span>文件变更</span>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[360px]">
        <table className="w-full border-collapse min-w-[600px]">
          <tbody>
            {lines.map((line, i) => (
              <tr
                key={i}
                className={`transition-colors hover:brightness-[0.97] ${
                  line.type === 'del' ? 'bg-red-50 dark:bg-red-900/10' :
                  line.type === 'add' ? 'bg-green-50 dark:bg-green-900/10' :
                  'bg-transparent'
                }`}
              >
                <td className="w-10 text-right pr-2 text-gray-400 text-xs select-none py-[2px]">
                  {line.oldNum || ''}
                </td>
                <td className={`w-1/2 py-[2px] px-2 whitespace-pre border-l-[3px] ${
                  line.type === 'del'
                    ? 'border-l-red-400 text-red-700 dark:text-red-300'
                    : 'border-l-transparent text-gray-700 dark:text-gray-300'
                }`}>
                  {line.type !== 'add' ? highlightLine(line.content) : ''}
                </td>
                <td className="w-10 text-right pr-2 text-gray-400 text-xs select-none py-[2px]">
                  {line.newNum || ''}
                </td>
                <td className={`w-1/2 py-[2px] px-2 whitespace-pre border-l-[3px] ${
                  line.type === 'add'
                    ? 'border-l-green-400 text-green-700 dark:text-green-300'
                    : 'border-l-transparent text-gray-700 dark:text-gray-300'
                }`}>
                  {line.type !== 'del' ? highlightLine(line.content) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
