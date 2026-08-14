import React, { useEffect, useRef, useState } from 'react';
import { Graph } from '@antv/x6';
import { Bot, User } from 'lucide-react';
import { STAGE_NAMES, STAGE_STATUS, STAGE_TYPE, type ProcessStage } from '@/lib/process-api';

// ── 状态颜色 ──
const STATUS_STROKE: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '#cbd5e1',
  [STAGE_STATUS.IN_PROGRESS]: '#3b82f6',
  [STAGE_STATUS.COMPLETED]: '#10b981',
  [STAGE_STATUS.FAILED]: '#ef4444',
  [STAGE_STATUS.SKIPPED]: '#94a3b8',
};

const STATUS_FILL: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '#ffffff',
  [STAGE_STATUS.IN_PROGRESS]: '#dbeafe',
  [STAGE_STATUS.COMPLETED]: '#d1fae5',
  [STAGE_STATUS.FAILED]: '#fee2e2',
  [STAGE_STATUS.SKIPPED]: '#f1f5f9',
};

const STATUS_LABELS: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '待执行',
  [STAGE_STATUS.IN_PROGRESS]: '进行中',
  [STAGE_STATUS.COMPLETED]: '已完成',
  [STAGE_STATUS.FAILED]: '失败',
  [STAGE_STATUS.SKIPPED]: '已跳过',
};

// ── 边颜色（基于源节点状态） ──
const EDGE_COLOR_PASSED = '#10b981';
const EDGE_COLOR_ACTIVE = '#3b82f6';
const EDGE_COLOR_PENDING = '#cbd5e1';

// ── 布局常量 ──
const NODE_SIZE = 48;
const GRAPH_W = 1200;
const GRAPH_H = 230;
const NODE_Y = 55;
const ROW_GAP = 95;
const NODE_Y_BOTTOM = NODE_Y + ROW_GAP;
const ORTH_TOP_Y = NODE_Y - 30;
const ORTH_BOTTOM_Y = NODE_Y_BOTTOM + NODE_SIZE + 12;
const LABEL_Y = NODE_Y + NODE_SIZE + 8;
const LABEL_Y_BOTTOM = NODE_Y_BOTTOM + NODE_SIZE + 8;
const PAD_X = 40;
const SCROLL_PADDING = 12;

// ── 各流程类型布局配置 ──

type FlowConfig = {
  topRow: string[];
  /** 底部行节点，与 topRow 同索引对齐；空字符串占位。 */
  bottomRow?: string[];
  stageTypeFallback: Record<string, string>;
  operatorTypeFallback: Record<string, string>;
  /** 节点标签 Y 坐标（不含底部节点则无需覆写） */
  labelYOverride?: (stageName: string, defaultY: number) => number;
};

const DEV_FLOW: FlowConfig = {
  topRow: [
    STAGE_NAMES.REQUIREMENT,
    STAGE_NAMES.REQUIREMENT_EVAL,
    STAGE_NAMES.ARCH_DESIGN,
    STAGE_NAMES.AI_EVAL,
    STAGE_NAMES.HUMAN_AUDIT,
    STAGE_NAMES.DEVELOPMENT,
    STAGE_NAMES.REVIEW,
    STAGE_NAMES.HUMAN_REVIEW,
    STAGE_NAMES.DEV_COMPLETE,
  ],
  stageTypeFallback: {
    [STAGE_NAMES.REQUIREMENT]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.REQUIREMENT_EVAL]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.ARCH_DESIGN]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.AI_EVAL]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.HUMAN_AUDIT]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.DEVELOPMENT]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.HUMAN_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.DEV_COMPLETE]: STAGE_TYPE.ACTION,
  },
  operatorTypeFallback: {
    [STAGE_NAMES.REQUIREMENT]: 'human',
    [STAGE_NAMES.REQUIREMENT_EVAL]: 'human',
    [STAGE_NAMES.ARCH_DESIGN]: 'ai',
    [STAGE_NAMES.AI_EVAL]: 'ai',
    [STAGE_NAMES.HUMAN_AUDIT]: 'human',
    [STAGE_NAMES.DEVELOPMENT]: 'ai',
    [STAGE_NAMES.REVIEW]: 'ai',
    [STAGE_NAMES.HUMAN_REVIEW]: 'human',
    [STAGE_NAMES.DEV_COMPLETE]: 'human',
  },
};

const TEST_FLOW: FlowConfig = {
  topRow: [
    STAGE_NAMES.TEST_REQUIREMENT,
    STAGE_NAMES.TEST_PLAN_DESIGN,
    STAGE_NAMES.TEST_PLAN_REVIEW,
    STAGE_NAMES.TEST_CASE_GEN,
    STAGE_NAMES.TEST_CASE_REVIEW,
    STAGE_NAMES.TEST_AUTO_EXEC,
    STAGE_NAMES.TEST_DEFECT_VERIFY,
    STAGE_NAMES.TEST_ADMISSION_REVIEW,
    STAGE_NAMES.TEST_COMPLETE,
  ],
  stageTypeFallback: {
    [STAGE_NAMES.TEST_REQUIREMENT]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_PLAN_DESIGN]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_PLAN_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.TEST_CASE_GEN]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_CASE_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.TEST_AUTO_EXEC]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_DEFECT_VERIFY]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_ADMISSION_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.TEST_COMPLETE]: STAGE_TYPE.ACTION,
  },
  operatorTypeFallback: {
    [STAGE_NAMES.TEST_REQUIREMENT]: 'human',
    [STAGE_NAMES.TEST_PLAN_DESIGN]: 'ai',
    [STAGE_NAMES.TEST_PLAN_REVIEW]: 'human',
    [STAGE_NAMES.TEST_CASE_GEN]: 'ai',
    [STAGE_NAMES.TEST_CASE_REVIEW]: 'human',
    [STAGE_NAMES.TEST_AUTO_EXEC]: 'ai',
    [STAGE_NAMES.TEST_DEFECT_VERIFY]: 'ai',
    [STAGE_NAMES.TEST_ADMISSION_REVIEW]: 'human',
    [STAGE_NAMES.TEST_COMPLETE]: 'human',
  },
};

const PRODUCT_FLOW: FlowConfig = {
  topRow: [
    STAGE_NAMES.PRODUCT_BRAINSTORM,
    STAGE_NAMES.PRODUCT_BREAKDOWN,
    STAGE_NAMES.PRODUCT_RESEARCH,
    STAGE_NAMES.PRODUCT_DRAFT,
    STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW,
    STAGE_NAMES.PRODUCT_REVIEW,
    STAGE_NAMES.PRODUCT_AI_GATEWAY,
    STAGE_NAMES.PRODUCT_PRD_WRITE,
    STAGE_NAMES.PRODUCT_PROTO_REVIEW,
    STAGE_NAMES.PRODUCT_FINAL_REVIEW,
  ],
  bottomRow: [
    '', '', '', '', '', '', '',
    STAGE_NAMES.PRODUCT_PROTO_MAKE,
    '', '',
  ],
  stageTypeFallback: {
    [STAGE_NAMES.PRODUCT_BRAINSTORM]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.PRODUCT_BREAKDOWN]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.PRODUCT_RESEARCH]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.PRODUCT_DRAFT]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.PRODUCT_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.PRODUCT_AI_GATEWAY]: STAGE_TYPE.GATEWAY,
    [STAGE_NAMES.PRODUCT_PROTO_MAKE]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.PRODUCT_PRD_WRITE]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.PRODUCT_PROTO_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.PRODUCT_FINAL_REVIEW]: STAGE_TYPE.ACTION,
  },
  operatorTypeFallback: {
    [STAGE_NAMES.PRODUCT_BRAINSTORM]: 'ai',
    [STAGE_NAMES.PRODUCT_BREAKDOWN]: 'ai',
    [STAGE_NAMES.PRODUCT_RESEARCH]: 'ai',
    [STAGE_NAMES.PRODUCT_DRAFT]: 'ai',
    [STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW]: 'human',
    [STAGE_NAMES.PRODUCT_REVIEW]: 'human',
    [STAGE_NAMES.PRODUCT_AI_GATEWAY]: 'ai',
    [STAGE_NAMES.PRODUCT_PROTO_MAKE]: 'ai',
    [STAGE_NAMES.PRODUCT_PRD_WRITE]: 'ai',
    [STAGE_NAMES.PRODUCT_PROTO_REVIEW]: 'human',
    [STAGE_NAMES.PRODUCT_FINAL_REVIEW]: 'human',
  },
};

const TEST_ASSET_FLOW: FlowConfig = {
  topRow: [
    STAGE_NAMES.TEST_REQUIREMENT,
    STAGE_NAMES.TEST_PLAN_DESIGN,
    STAGE_NAMES.TEST_PLAN_REVIEW,
    STAGE_NAMES.TEST_CASE_GEN,
    STAGE_NAMES.TEST_CASE_REVIEW,
    STAGE_NAMES.TEST_COMPLETE,
  ],
  stageTypeFallback: {
    [STAGE_NAMES.TEST_REQUIREMENT]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_PLAN_DESIGN]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_PLAN_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.TEST_CASE_GEN]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_CASE_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.TEST_COMPLETE]: STAGE_TYPE.ACTION,
  },
  operatorTypeFallback: {
    [STAGE_NAMES.TEST_REQUIREMENT]: 'human',
    [STAGE_NAMES.TEST_PLAN_DESIGN]: 'ai',
    [STAGE_NAMES.TEST_PLAN_REVIEW]: 'human',
    [STAGE_NAMES.TEST_CASE_GEN]: 'ai',
    [STAGE_NAMES.TEST_CASE_REVIEW]: 'human',
    [STAGE_NAMES.TEST_COMPLETE]: 'human',
  },
};

const TEST_EXECUTION_FLOW: FlowConfig = {
  topRow: [
    STAGE_NAMES.TEST_REQUIREMENT,
    STAGE_NAMES.TEST_AUTO_EXEC,
    STAGE_NAMES.TEST_DEFECT_VERIFY,
    STAGE_NAMES.TEST_ADMISSION_REVIEW,
    STAGE_NAMES.TEST_COMPLETE,
  ],
  stageTypeFallback: {
    [STAGE_NAMES.TEST_REQUIREMENT]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_AUTO_EXEC]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_DEFECT_VERIFY]: STAGE_TYPE.ACTION,
    [STAGE_NAMES.TEST_ADMISSION_REVIEW]: STAGE_TYPE.JUDGE,
    [STAGE_NAMES.TEST_COMPLETE]: STAGE_TYPE.ACTION,
  },
  operatorTypeFallback: {
    [STAGE_NAMES.TEST_REQUIREMENT]: 'human',
    [STAGE_NAMES.TEST_AUTO_EXEC]: 'ai',
    [STAGE_NAMES.TEST_DEFECT_VERIFY]: 'ai',
    [STAGE_NAMES.TEST_ADMISSION_REVIEW]: 'human',
    [STAGE_NAMES.TEST_COMPLETE]: 'human',
  },
};

const PROCESS_TYPE_CONFIG: Record<string, FlowConfig> = {
  ai_dev: DEV_FLOW,
  auto_test: TEST_FLOW,
  auto_test_asset: TEST_ASSET_FLOW,
  auto_test_execution: TEST_EXECUTION_FLOW,
  product: PRODUCT_FLOW,
};

// ── 动画常量 ──
const DOT_DASH = '4 16';
const DOT_PERIOD = 20;
const DOT_ANIM_MS = 800;

// ── 时间格式化 ──
const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60000;
const MS_PER_HOUR = 3600000;

function formatDuration(ms: number): string {
  if (ms < MS_PER_SEC) return `${ms}ms`;
  if (ms < MS_PER_MIN) return `${(ms / MS_PER_SEC).toFixed(1)}秒`;
  if (ms < MS_PER_HOUR) {
    const min = Math.floor(ms / MS_PER_MIN);
    const sec = Math.floor((ms % MS_PER_MIN) / MS_PER_SEC);
    return sec > 0 ? `${min}分${sec}秒` : `${min}分`;
  }
  return `${(ms / MS_PER_HOUR).toFixed(1)}小时`;
}

function durationFromStage(stage: ProcessStage): number | null {
  if (!stage.startedAt) return null;
  const end = stage.completedAt ? new Date(stage.completedAt).getTime() : Date.now();
  return Math.max(0, end - new Date(stage.startedAt).getTime());
}

/** 顶行节点左上角 X（按 TOP_ROW 中的索引均匀分布） */
function topRowX(topRowLen: number, topIdx: number): number {
  const usable = GRAPH_W - NODE_SIZE - PAD_X * 2;
  const gap = usable / (topRowLen - 1);
  return PAD_X + topIdx * gap;
}

/** 顶行节点圆心 X */
function topRowCenterX(topRowLen: number, topIdx: number): number {
  return topRowX(topRowLen, topIdx) + NODE_SIZE / 2;
}

/** 任意节点的左上角坐标 */
function stagePos(topRow: string[], stageName: string, bottomRow: string[] = []): { x: number; y: number } {
  const topIdx = topRow.indexOf(stageName);
  if (topIdx !== -1) {
    return { x: topRowX(topRow.length, topIdx), y: NODE_Y };
  }
  const bottomIdx = bottomRow.indexOf(stageName);
  if (bottomIdx !== -1) {
    return { x: topRowX(topRow.length, bottomIdx), y: NODE_Y_BOTTOM };
  }
  // 兼容旧逻辑：不在 top/bottom row 的节点落到 HUMAN_REVIEW 下方
  const humanReviewIdx = topRow.indexOf(STAGE_NAMES.HUMAN_REVIEW);
  return { x: topRowX(topRow.length, humanReviewIdx), y: NODE_Y_BOTTOM };
}

/** 任意节点圆心 X */
function stageCenterX(topRow: string[], stageName: string, bottomRow: string[] = []): number {
  return stagePos(topRow, stageName, bottomRow).x + NODE_SIZE / 2;
}

/** 任意节点圆心 Y */
function stageCenterY(topRow: string[], stageName: string, bottomRow: string[] = []): number {
  return stagePos(topRow, stageName, bottomRow).y + NODE_SIZE / 2;
}

/** 根据源节点状态推导边的样式 */
function edgeStyle(srcStatus: string, isConditional: boolean) {
  if (srcStatus === STAGE_STATUS.COMPLETED) {
    return { stroke: EDGE_COLOR_PASSED, dasharray: '', animate: false };
  }
  if (srcStatus === STAGE_STATUS.IN_PROGRESS) {
    return { stroke: EDGE_COLOR_ACTIVE, dasharray: DOT_DASH, animate: true };
  }
  // pending / failed / skipped 均按 pending 样式处理
  return { stroke: EDGE_COLOR_PENDING, dasharray: isConditional ? '6 4' : '', animate: false };
}

export const FlowGraph: React.FC<{
  stages: ProcessStage[];
  onStageClick: (name: string) => void;
  processType?: string;
}> = ({ stages, onStageClick, processType = 'ai_dev' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const clickCbRef = useRef(onStageClick);
  clickCbRef.current = onStageClick;

  const [hovered, setHovered] = useState<{
    stage: ProcessStage;
    cx: number;
    topY: number;
  } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  // 监听容器可见性：Tabs 默认不会卸载非激活内容，隐藏容器内初始化 X6 会导致渲染异常，
  // 因此通过 ResizeObserver 感知容器尺寸变化，在容器可见时重新创建 Graph。
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const [containerSizeKey, setContainerSizeKey] = useState(0);

  const cfg: FlowConfig = PROCESS_TYPE_CONFIG[processType] ?? DEV_FLOW;
  const { topRow, stageTypeFallback, operatorTypeFallback, labelYOverride } = cfg;
  const bottomRowRef = cfg.bottomRow ?? [];
  const topRowLen = topRow.length;
  const count = stages.length;

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const prev = containerSizeRef.current;
      // 仅当有效尺寸发生变化时才触发 Graph 重建，避免重复刷新。
      if (width > 0 && height > 0 && (width !== prev.width || height !== prev.height)) {
        containerSizeRef.current = { width, height };
        setContainerSizeKey((k) => k + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || count === 0) return;
    // 容器隐藏时不创建 Graph，避免渲染尺寸为 0 导致坐标计算错误。
    if (containerRef.current.offsetWidth === 0 || containerRef.current.offsetHeight === 0) return;

    const graph = new Graph({
      container: containerRef.current,
      width: GRAPH_W,
      height: GRAPH_H,
      interacting: false,
      panning: false,
      mousewheel: false,
      background: { color: 'transparent' },
    });

    stages.forEach((stage) => {
      const stroke = STATUS_STROKE[stage.status] ?? '#cbd5e1';
      const fill = STATUS_FILL[stage.status] ?? '#ffffff';
      const pos = stagePos(topRow, stage.name, bottomRowRef);

      const stageType = stage.stageType || stageTypeFallback[stage.name] || STAGE_TYPE.ACTION;
      if (stageType === STAGE_TYPE.GATEWAY) {
        graph.addNode({
          id: stage.name,
          shape: 'polygon',
          x: pos.x,
          y: pos.y,
          width: NODE_SIZE,
          height: NODE_SIZE,
          attrs: {
            body: {
              refPoints: '0.5,0 1,0.5 0.5,1 0,0.5',
              fill: '#f5f0ff',
              stroke,
              strokeWidth: 2.5,
            },
            label: { text: '+', fill: stroke, fontSize: 18, fontWeight: 700, textAnchor: 'middle', textVerticalAnchor: 'middle' },
          },
        });
      } else if (stageType === STAGE_TYPE.JUDGE) {
        graph.addNode({
          id: stage.name,
          shape: 'polygon',
          x: pos.x,
          y: pos.y,
          width: NODE_SIZE,
          height: NODE_SIZE,
          attrs: {
            body: {
              refPoints: '0.5,0 1,0.5 0.5,1 0,0.5',
              fill,
              stroke,
              strokeWidth: 2,
            },
          },
        });
      } else {
        graph.addNode({
          id: stage.name,
          shape: 'circle',
          x: pos.x,
          y: pos.y,
          width: NODE_SIZE,
          height: NODE_SIZE,
          attrs: {
            body: { fill, stroke, strokeWidth: 2 },
          },
        });
      }
    });

    const has = (name: string) => stages.some(s => s.name === name);

    const addEdge = (
      src: string,
      tgt: string,
      isConditional: boolean,
      label?: string,
      vertices?: Array<{ x: number; y: number }>,
      anchors?: { source?: string; target?: string },
    ) => {
      if (!has(src) || !has(tgt)) return;
      const srcStage = stages.find(s => s.name === src)!;
      const style = edgeStyle(srcStage.status, isConditional);

      const edgeConfig: Record<string, unknown> = {
        source: src,
        target: tgt,
        // 有 anchors 时用 anchor 连接点，确保端点固定在锚点位置（如 bottom），
        // 不被 boundary 重新投影到节点侧面
        connectionPoint: anchors ? 'anchor' : 'boundary',
        attrs: {
          line: {
            stroke: style.stroke,
            strokeWidth: 2,
            strokeDasharray: style.dasharray,
            targetMarker: { name: 'block', width: 8, height: 8 },
          },
        },
        labels: label
          ? [{
              attrs: {
                label: { text: label, fill: '#1e293b', fontSize: 11, fontWeight: 700 },
                rect: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, rx: 3, ry: 3 },
              },
              position: { distance: 0.5 },
            }]
          : [],
      };

      if (vertices) {
        edgeConfig.vertices = vertices;
        // 当显式指定 anchors 时使用 normal 路由（直线段穿过顶点），
        // orth 路由会自行计算弯折路径，可能覆盖锚点方向导致终点落到节点侧面。
        edgeConfig.router = { name: anchors ? 'normal' : 'orth' };
      }

      if (anchors?.source) {
        edgeConfig.sourceAnchor = { name: anchors.source };
      }
      if (anchors?.target) {
        edgeConfig.targetAnchor = { name: anchors.target };
      }

      const edge = graph.addEdge(edgeConfig);

      if (style.animate) {
        edge.attr('line/class', 'flow-anim');
      }
    };

    if (processType === 'auto_test' || processType === 'auto_test_asset') {
      // ── AI测试资产流程边：测试需求 -> 测试计划 -> 计划评审 -> 用例生成 -> 用例评审 -> 完成 ──
      addEdge(STAGE_NAMES.TEST_REQUIREMENT, STAGE_NAMES.TEST_PLAN_DESIGN, false);
      addEdge(STAGE_NAMES.TEST_PLAN_DESIGN, STAGE_NAMES.TEST_PLAN_REVIEW, false);
      addEdge(STAGE_NAMES.TEST_PLAN_REVIEW, STAGE_NAMES.TEST_CASE_GEN, true, 'Y 通过');
      addEdge(STAGE_NAMES.TEST_CASE_GEN, STAGE_NAMES.TEST_CASE_REVIEW, false);
      addEdge(STAGE_NAMES.TEST_CASE_REVIEW, STAGE_NAMES.TEST_COMPLETE, true, 'Y 通过');

      {
        const planReviewCx = stageCenterX(topRow, STAGE_NAMES.TEST_PLAN_REVIEW, bottomRowRef);
        const planDesignCx = stageCenterX(topRow, STAGE_NAMES.TEST_PLAN_DESIGN, bottomRowRef);
        addEdge(
          STAGE_NAMES.TEST_PLAN_REVIEW,
          STAGE_NAMES.TEST_PLAN_DESIGN,
          true,
          'N 不通过',
          [{ x: planReviewCx, y: NODE_Y_BOTTOM - 10 }, { x: planDesignCx, y: NODE_Y_BOTTOM - 10 }],
        );
      }
      {
        const caseReviewCx = stageCenterX(topRow, STAGE_NAMES.TEST_CASE_REVIEW, bottomRowRef);
        const caseGenCx = stageCenterX(topRow, STAGE_NAMES.TEST_CASE_GEN, bottomRowRef);
        addEdge(
          STAGE_NAMES.TEST_CASE_REVIEW,
          STAGE_NAMES.TEST_CASE_GEN,
          true,
          'N 不通过',
          [{ x: caseReviewCx, y: NODE_Y_BOTTOM - 10 }, { x: caseGenCx, y: NODE_Y_BOTTOM - 10 }],
        );
      }
    } else if (processType === 'auto_test_execution') {
      // ── AI测试执行流程边：测试需求 -> 自动化执行 -> 缺陷验证 -> 准入评审 -> 完成 ──
      addEdge(STAGE_NAMES.TEST_REQUIREMENT, STAGE_NAMES.TEST_AUTO_EXEC, false);
      addEdge(STAGE_NAMES.TEST_AUTO_EXEC, STAGE_NAMES.TEST_DEFECT_VERIFY, false);
      addEdge(STAGE_NAMES.TEST_DEFECT_VERIFY, STAGE_NAMES.TEST_ADMISSION_REVIEW, false);
      addEdge(STAGE_NAMES.TEST_ADMISSION_REVIEW, STAGE_NAMES.TEST_COMPLETE, true, 'Y 通过');

      {
        const admissionCx = stageCenterX(topRow, STAGE_NAMES.TEST_ADMISSION_REVIEW, bottomRowRef);
        const autoExecCx = stageCenterX(topRow, STAGE_NAMES.TEST_AUTO_EXEC, bottomRowRef);
        addEdge(
          STAGE_NAMES.TEST_ADMISSION_REVIEW,
          STAGE_NAMES.TEST_AUTO_EXEC,
          true,
          'N 不通过',
          [{ x: admissionCx, y: NODE_Y_BOTTOM - 10 }, { x: autoExecCx, y: NODE_Y_BOTTOM - 10 }],
        );
      }
    } else if (processType === 'product') {
      // 产品流程（11 阶段 + 并行决策器分叉，所有驳回边底部折线走）
      // 头脑风暴 → 拆解 → 调研 → 草案 → AI复核 → 方案复核 → AI并行决策器 →
      //   [PRD初稿生成 (top) | 原型初稿生成 (bottom) 并行] → 需求设计复核 → 需求评审

      addEdge(STAGE_NAMES.PRODUCT_BRAINSTORM, STAGE_NAMES.PRODUCT_BREAKDOWN, false);
      addEdge(STAGE_NAMES.PRODUCT_BREAKDOWN, STAGE_NAMES.PRODUCT_RESEARCH, false);
      addEdge(STAGE_NAMES.PRODUCT_RESEARCH, STAGE_NAMES.PRODUCT_DRAFT, false);
      addEdge(STAGE_NAMES.PRODUCT_DRAFT, STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW, false);
      addEdge(STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW, STAGE_NAMES.PRODUCT_REVIEW, true, 'Y 通过');
      addEdge(STAGE_NAMES.PRODUCT_REVIEW, STAGE_NAMES.PRODUCT_AI_GATEWAY, true, 'Y 通过');

      // 并行决策器分叉 → 两路并行（PRD + prototype，prd_write 在上行，proto_make 在下行）
      addEdge(STAGE_NAMES.PRODUCT_AI_GATEWAY, STAGE_NAMES.PRODUCT_PRD_WRITE, false);
      {
        const gatewayCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_AI_GATEWAY, bottomRowRef);
        const protoCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_PROTO_MAKE, bottomRowRef);
        const protoY = stageCenterY(topRow, STAGE_NAMES.PRODUCT_PROTO_MAKE, bottomRowRef);
        addEdge(
          STAGE_NAMES.PRODUCT_AI_GATEWAY,
          STAGE_NAMES.PRODUCT_PROTO_MAKE,
          false,
          undefined,
          [{ x: gatewayCx, y: protoY }, { x: protoCx - NODE_SIZE / 2, y: protoY }],
          { source: 'bottom', target: 'left' },
        );
      }

      // 两路汇入需求设计复核
      addEdge(STAGE_NAMES.PRODUCT_PRD_WRITE, STAGE_NAMES.PRODUCT_PROTO_REVIEW, false);
      {
        const protoCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_PROTO_MAKE, bottomRowRef);
        const protoY = stageCenterY(topRow, STAGE_NAMES.PRODUCT_PROTO_MAKE, bottomRowRef);
        const reviewCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_PROTO_REVIEW, bottomRowRef);
        addEdge(
          STAGE_NAMES.PRODUCT_PROTO_MAKE,
          STAGE_NAMES.PRODUCT_PROTO_REVIEW,
          false,
          undefined,
          [{ x: reviewCx, y: protoY }],
          { source: 'right', target: 'bottom' },
        );
      }

      // 需求设计复核通过 → 需求评审
      addEdge(STAGE_NAMES.PRODUCT_PROTO_REVIEW, STAGE_NAMES.PRODUCT_FINAL_REVIEW, true, 'Y 通过');

      // ─ 驳回边 ─

      // 驳回边 1：AI 草案复核不通过 → 草案（底部微下调，避免与自主复核线重合）
      {
        const srcCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW, bottomRowRef);
        const tgtCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_DRAFT, bottomRowRef);
        const rejectY = NODE_Y + NODE_SIZE + 20;
        addEdge(
          STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW,
          STAGE_NAMES.PRODUCT_DRAFT,
          true,
          'N 不通过',
          [{ x: srcCx, y: rejectY }, { x: tgtCx, y: rejectY }],
          { source: 'bottom', target: 'bottom' },
        );
      }

      // 驳回边 2：方案复核不通过 → 草案（下方折线）
      {
        const srcCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_REVIEW, bottomRowRef);
        const tgtCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_DRAFT, bottomRowRef);
        addEdge(
          STAGE_NAMES.PRODUCT_REVIEW,
          STAGE_NAMES.PRODUCT_DRAFT,
          true,
          'N 不通过',
          [{ x: srcCx, y: ORTH_BOTTOM_Y }, { x: tgtCx, y: ORTH_BOTTOM_Y }],
        );
      }

      // 驳回边 3：需求设计复核不通过 → 草案（上方折线，退回重新构思）
      {
        const srcCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_PROTO_REVIEW, bottomRowRef);
        const tgtCx = stageCenterX(topRow, STAGE_NAMES.PRODUCT_DRAFT, bottomRowRef);
        addEdge(
          STAGE_NAMES.PRODUCT_PROTO_REVIEW,
          STAGE_NAMES.PRODUCT_DRAFT,
          true,
          'N 不通过',
          [{ x: srcCx, y: ORTH_TOP_Y }, { x: tgtCx, y: ORTH_TOP_Y }],
        );
      }


    } else {
      // ── AI 开发流程边 ──

      // 顺序边（顶行水平实线）
      addEdge(STAGE_NAMES.REQUIREMENT, STAGE_NAMES.REQUIREMENT_EVAL, false);
      addEdge(STAGE_NAMES.ARCH_DESIGN, STAGE_NAMES.AI_EVAL, false);
      addEdge(STAGE_NAMES.DEVELOPMENT, STAGE_NAMES.REVIEW, false);

      addEdge(STAGE_NAMES.REQUIREMENT_EVAL, STAGE_NAMES.ARCH_DESIGN, true, 'Y 通过');

      // 需求评估不通过 → 直接到末节点人工介入（顶部折线，跳过中间所有节点）
      {
        const evalCx = stageCenterX(topRow, STAGE_NAMES.REQUIREMENT_EVAL, bottomRowRef);
        const completeCx = stageCenterX(topRow, STAGE_NAMES.DEV_COMPLETE, bottomRowRef);
        addEdge(
          STAGE_NAMES.REQUIREMENT_EVAL,
          STAGE_NAMES.DEV_COMPLETE,
          true,
          'N 不通过',
          [{ x: (evalCx + completeCx) / 2, y: ORTH_TOP_Y }],
        );
      }

      addEdge(STAGE_NAMES.AI_EVAL, STAGE_NAMES.HUMAN_AUDIT, true, 'Y 通过');

      // AI 方案评估不通过 → 返回方案设计（底部回环，与人工审核回环错层避免重叠）
      {
        const aiEvalCx = stageCenterX(topRow, STAGE_NAMES.AI_EVAL, bottomRowRef);
        const archCx = stageCenterX(topRow, STAGE_NAMES.ARCH_DESIGN, bottomRowRef);
        addEdge(
          STAGE_NAMES.AI_EVAL,
          STAGE_NAMES.ARCH_DESIGN,
          true,
          'N 不通过',
          [{ x: aiEvalCx, y: NODE_Y_BOTTOM - 26 }, { x: archCx, y: NODE_Y_BOTTOM - 26 }],
        );
      }

      addEdge(STAGE_NAMES.HUMAN_AUDIT, STAGE_NAMES.DEVELOPMENT, true, 'Y 通过');

      {
        const auditCx = stageCenterX(topRow, STAGE_NAMES.HUMAN_AUDIT, bottomRowRef);
        const archCx = stageCenterX(topRow, STAGE_NAMES.ARCH_DESIGN, bottomRowRef);
        addEdge(
          STAGE_NAMES.HUMAN_AUDIT,
          STAGE_NAMES.ARCH_DESIGN,
          true,
          'N 不通过',
          [{ x: auditCx, y: NODE_Y_BOTTOM - 10 }, { x: archCx, y: NODE_Y_BOTTOM - 10 }],
        );
      }

      addEdge(STAGE_NAMES.REVIEW, STAGE_NAMES.HUMAN_REVIEW, true, 'Y 通过');

      // AI 代码评审不通过 → 返回 AI 开发（底部回环，与人工评审回环错层避免重叠）
      {
        const reviewCx = stageCenterX(topRow, STAGE_NAMES.REVIEW, bottomRowRef);
        const devCx = stageCenterX(topRow, STAGE_NAMES.DEVELOPMENT, bottomRowRef);
        addEdge(
          STAGE_NAMES.REVIEW,
          STAGE_NAMES.DEVELOPMENT,
          true,
          'N 不通过',
          [{ x: reviewCx, y: NODE_Y_BOTTOM - 26 }, { x: devCx, y: NODE_Y_BOTTOM - 26 }],
        );
      }

      addEdge(STAGE_NAMES.HUMAN_REVIEW, STAGE_NAMES.DEV_COMPLETE, true, 'Y 通过');

      // 人工评审不通过 → 返回 AI 开发（底部回环）
      {
        const humanReviewCx = stageCenterX(topRow, STAGE_NAMES.HUMAN_REVIEW, bottomRowRef);
        const devCx = stageCenterX(topRow, STAGE_NAMES.DEVELOPMENT, bottomRowRef);
        addEdge(
          STAGE_NAMES.HUMAN_REVIEW,
          STAGE_NAMES.DEVELOPMENT,
          true,
          'N 不通过',
          [{ x: humanReviewCx, y: NODE_Y_BOTTOM - 10 }, { x: devCx, y: NODE_Y_BOTTOM - 10 }],
        );
      }
    }

    graph.on('node:click', ({ node }) => {
      clickCbRef.current(node.id);
    });

    graph.on('node:mouseenter', ({ node }) => {
      const stage = stages.find(s => s.name === node.id);
      if (!stage) return;
      const pos = node.getPosition();
      setHovered({
        stage,
        cx: pos.x + NODE_SIZE / 2,
        topY: pos.y,
      });
    });
    graph.on('node:mouseleave', () => setHovered(null));

    return () => {
      graph.dispose();
    };
  }, [stages, count, processType, topRow, containerSizeKey]);

  return (
    <div className="rounded-xl border bg-card p-3 relative">
      <style>{`
        @keyframes flowDashMove {
          to { stroke-dashoffset: ${-DOT_PERIOD}; }
        }
        .flow-anim {
          animation: flowDashMove ${DOT_ANIM_MS}ms linear infinite;
        }
      `}</style>
      <div
        ref={scrollRef}
        className="w-full overflow-x-auto"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        <div className="mx-auto" style={{ width: GRAPH_W, height: GRAPH_H, position: 'relative' }}>
          <div ref={containerRef} style={{ width: GRAPH_W, height: GRAPH_H }} />

          {stages.map((stage) => {
            const operatorType = stage.operatorType || operatorTypeFallback[stage.name] || 'ai';
            const defaultLabelY = stagePos(topRow, stage.name, bottomRowRef).y === NODE_Y ? LABEL_Y : LABEL_Y_BOTTOM;
            const lblY = labelYOverride ? labelYOverride(stage.name, defaultLabelY) : defaultLabelY;
            return (
            <div
              key={stage.name}
              className="absolute text-[11px] font-semibold text-muted-foreground whitespace-nowrap pointer-events-none select-none flex items-center gap-1"
              style={{
                left: stageCenterX(topRow, stage.name, bottomRowRef),
                top: lblY,
                transform: 'translateX(-50%)',
              }}
            >
              {operatorType === 'ai' ? (
                <Bot className="h-3 w-3 text-blue-500 shrink-0" />
              ) : (
                <User className="h-3 w-3 text-emerald-500 shrink-0" />
              )}
              {stage.label}
            </div>
            );
          })}
        </div>
      </div>

      {hovered && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: hovered.cx - scrollLeft + SCROLL_PADDING,
            top: hovered.topY - 4 + SCROLL_PADDING,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-popover border rounded-md shadow-md px-3 py-2 text-xs whitespace-nowrap space-y-0.5">
            <div className="font-semibold text-sm mb-1">{hovered.stage.label}</div>
            <div className="text-muted-foreground">
              状态：
              <span style={{ color: STATUS_STROKE[hovered.stage.status] ?? '#64748b' }}>
                {STATUS_LABELS[hovered.stage.status] ?? hovered.stage.status}
              </span>
            </div>
            {hovered.stage.operatorName && (
              <div className="text-muted-foreground">操作者：{hovered.stage.operatorName}</div>
            )}
            {hovered.stage.agentRole && (
              <div className="text-muted-foreground">角色：{hovered.stage.agentRole}</div>
            )}
            {hovered.stage.startedAt && (
              <div className="text-muted-foreground">
                开始：{new Date(hovered.stage.startedAt).toLocaleString('zh-CN', DATE_FMT)}
              </div>
            )}
            {durationFromStage(hovered.stage) !== null && (
              <div className="text-muted-foreground">
                耗时：{formatDuration(durationFromStage(hovered.stage)!)}
              </div>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-px w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-popover" />
        </div>
      )}
    </div>
  );
};
