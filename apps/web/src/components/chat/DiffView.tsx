import React, { useState } from 'react';
import { FileCode2, ChevronDown, ChevronUp } from 'lucide-react';

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

const MAX_LINE_CHARS = 80;
const COLLAPSED_LINES = 6;

interface DiffViewProps {
  content: string;
}

export const DiffView: React.FC<DiffViewProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);
  const lines = parseDiffV2(content);
  const displayLines = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const addCount = lines.filter(l => l.type === 'add').length;
  const delCount = lines.filter(l => l.type === 'del').length;

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 font-mono text-[13px] leading-relaxed my-1">
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4" />
          <span>文件变更</span>
          <span className="text-xs text-muted-foreground font-normal">
            +{addCount} -{delCount}，共 {lines.length} 行
          </span>
        </div>
      </div>
      <div className={`relative overflow-auto ${expanded ? 'max-h-[360px]' : 'max-h-[180px]'}`}>
        <table className="w-full border-collapse table-fixed">
          <tbody>
            {displayLines.map((line, i) => (
              <tr
                key={i}
                className={`transition-colors hover:brightness-[0.97] ${
                  line.type === 'del' ? 'bg-red-50 dark:bg-red-900/10' :
                  line.type === 'add' ? 'bg-green-50 dark:bg-green-900/10' :
                  'bg-transparent'
                }`}
              >
                <td className="w-12 text-right pr-2 text-gray-400 text-xs select-none py-[2px]">
                  {line.oldNum || ''}
                </td>
                <td className={`w-[80ch] min-w-[80ch] py-[2px] px-2 whitespace-pre-wrap border-l-[3px] align-top ${
                  line.type === 'del'
                    ? 'border-l-red-400 text-red-700 dark:text-red-300'
                    : 'border-l-transparent text-gray-700 dark:text-gray-300'
                }`}>
                  {line.type !== 'add' ? highlightLine(line.content) : ''}
                </td>
                <td className="w-12 text-right pr-2 text-gray-400 text-xs select-none py-[2px]">
                  {line.newNum || ''}
                </td>
                <td className={`w-[80ch] min-w-[80ch] py-[2px] px-2 whitespace-pre-wrap border-l-[3px] align-top ${
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
        {!expanded && lines.length > COLLAPSED_LINES && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
      </div>
      {lines.length > COLLAPSED_LINES && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {expanded ? (
            <>
              收起 <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开全部 {lines.length} 行 <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
};
