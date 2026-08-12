/**
 * Mermaid 代码块检测工具 - 统一事实来源
 *
 * 供 MarkdownView、ChatCodeBlock 等组件复用，避免不同位置维护两套
 * 启发式规则导致检测结果不一致。
 */

/**
 * 已知 Mermaid 图表类型关键字，用于判断代码块第一行/前几行是否为 Mermaid 图表。
 *
 * 只保留图表类型关键字（graph/flowchart/sequenceDiagram/...），不保留 subgraph、
 * style、classDef 等辅助关键字。辅助关键字通常出现在代码中间，作为第一行时会
 * 因缺少图表类型而本身就不是合法的 Mermaid 代码。
 */
const MERMAID_DIAGRAM_KEYWORDS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'journey',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'xychart-beta',
  'architecture-beta',
  'block-beta',
  'packet-beta',
  'sankey-beta',
  'treemap-beta',
  'requirementDiagram',
  'kanban',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
] as const;

/** 代码特征行：若代码块主要由这些行组成，则不是 Mermaid 图表。 */
const CODE_LINE_PATTERN = /^(import\s|export\s|const\s|let\s|var\s|function\s|return\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|\/\/|\/\*|\*|#)/;

/** 扫描前 N 行，避免在超长代码块中扫描过多行。 */
const MAX_SCAN_LINES = 10;

/**
 * 判断代码块是否为 Mermaid 图表。
 *
 * 规则：
 * 1. 代码块前几行中存在以 Mermaid 图表类型关键字开头的行（如 `graph TD`、
 *    `flowchart LR`、`sequenceDiagram`）。
 * 2. 注释行（%% / // / #）和明显代码特征行（import/const/function 等）不计入。
 *
 * 注意：不依赖箭头 `-->` 或节点 `A[label]` 等模式做判定，因为普通代码/注释中
 * 也可能包含箭头函数、函数调用或数组下标，导致误判。
 *
 * 对于纯文本流程（如 `A -> B -> C`），应走 `isTextFlow` 转换逻辑，而不是这里。
 */
export function isMermaidDiagramCode(code: string): boolean {
  const lines = code.trim().split('\n');
  for (let i = 0; i < Math.min(lines.length, MAX_SCAN_LINES); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;
    if (CODE_LINE_PATTERN.test(line)) continue;
    if (MERMAID_DIAGRAM_KEYWORDS.some(kw => line.startsWith(kw))) {
      return true;
    }
  }
  return false;
}
