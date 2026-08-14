import React from 'react';
import { ArrowLeft, Bot, CheckCircle2, ChevronRight, FileCheck, FileText, Layers, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlowGraph } from '@/components/FlowGraph';
import {
  STAGE_NAMES,
  STAGE_STATUS,
  STAGE_TYPE,
  OPERATOR_TYPE,
  type ProcessStage,
} from '@/lib/process-api';

// ── 类型定义 ──

type TemplateType = 'ai_dev' | 'auto_test_asset' | 'auto_test_execution' | 'product';

interface StageDetail {
  name: string;
  description: string;
  input?: string;
  processing?: string;
  responsibleRule: string;
  aiCapability?: string;
  admission: string;
  deliverables: string;
  /** 当前节点执行时调用的 slash 指令；人工节点为空。 */
  command?: string;
}

interface RoleGroup {
  role: string;
  items: string[];
}

interface FlowTemplate {
  id: TemplateType;
  name: string;
  description: string;
  type: TemplateType;
  stages: ProcessStage[];
  stageDetails: StageDetail[];
  responsibleRules: RoleGroup[];
  aiCapabilities: RoleGroup[];
  admissions: string[];
  deliverables: string[];
}

// ── 阶段构建辅助函数 ──

function buildStage(
  name: string,
  label: string,
  operatorType: string,
  stageType: string,
  agentRole?: string,
): ProcessStage {
  return {
    name,
    label,
    status: STAGE_STATUS.PENDING,
    stageType,
    operatorType,
    agentRole,
    inputDesc: '',
    outputDesc: '',
  };
}

function buildHumanStage(name: string, label: string): ProcessStage {
  return buildStage(name, label, OPERATOR_TYPE.HUMAN, STAGE_TYPE.ACTION);
}

function buildAIStage(name: string, label: string, agentRole: string): ProcessStage {
  return buildStage(name, label, OPERATOR_TYPE.AI, STAGE_TYPE.ACTION, agentRole);
}

function buildJudgeStage(name: string, label: string): ProcessStage {
  return buildStage(name, label, OPERATOR_TYPE.HUMAN, STAGE_TYPE.JUDGE);
}

function buildAIJudgeStage(name: string, label: string, agentRole: string): ProcessStage {
  return buildStage(name, label, OPERATOR_TYPE.AI, STAGE_TYPE.JUDGE, agentRole);
}

function buildGatewayStage(name: string, label: string): ProcessStage {
  return buildStage(name, label, OPERATOR_TYPE.HUMAN, STAGE_TYPE.GATEWAY);
}

// ── AI 开发流程模板 ──

const AI_DEV_TEMPLATE: FlowTemplate = {
  id: 'ai_dev',
  name: 'AI需求开发流程',
  description: '从研发需求受理到代码交付的全自动 AI 开发流水线，覆盖需求评估、方案设计、AI 方案评估、人工审核、代码开发、代码评审与返修闭环。',
  type: 'ai_dev',
  stages: [
    buildHumanStage(STAGE_NAMES.REQUIREMENT, '需求受理'),
    buildJudgeStage(STAGE_NAMES.REQUIREMENT_EVAL, '需求评估'),
    buildAIStage(STAGE_NAMES.ARCH_DESIGN, '方案设计', '方案助理'),
    buildAIJudgeStage(STAGE_NAMES.AI_EVAL, 'AI 方案评估', '评审助理'),
    buildJudgeStage(STAGE_NAMES.HUMAN_AUDIT, '人工审核'),
    buildAIStage(STAGE_NAMES.DEVELOPMENT, 'AI 开发', '开发助理'),
    buildAIJudgeStage(STAGE_NAMES.REVIEW, 'AI 代码评审', '评审助理'),
    buildJudgeStage(STAGE_NAMES.HUMAN_REVIEW, '人工评审'),
    buildHumanStage(STAGE_NAMES.DEV_COMPLETE, '人工介入'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.REQUIREMENT,
      description: '确认需求，决定是否进入 AI 开发。',
      responsibleRule: '产品经理确认需求',
      aiCapability: '需求解析与要素提取',
      admission: '需求已创建并指派',
      deliverables: '已确认的需求工单',
    },
    {
      name: STAGE_NAMES.REQUIREMENT_EVAL,
      description: '判断需求是否适合 AI 开发：通过进入方案设计，不通过直接转人工介入。',
      responsibleRule: 'AI 初审 + 人工决策',
      aiCapability: '可行性判断与路径推荐',
      admission: '需求已受理',
      deliverables: '决策：方案设计 / 人工介入',
    },
    {
      name: STAGE_NAMES.ARCH_DESIGN,
      description: 'AI 生成技术方案与设计文档。',
      responsibleRule: 'AI 方案助理',
      aiCapability: '技术选型、模块拆分、接口草案',
      admission: '需求评估通过',
      deliverables: '方案设计文档、接口草稿、任务拆分',
    },
    {
      name: STAGE_NAMES.AI_EVAL,
      description: 'AI 自评方案设计，识别潜在风险并判定通过/不通过；不通过自动返回方案设计（最多 2 次），超限转人工裁决。',
      responsibleRule: 'AI 评审助理自动执行，超限人工裁决',
      aiCapability: '风险识别、方案检查、性能评估',
      admission: '方案设计已产出',
      deliverables: '评估报告与通过/不通过结论',
    },
    {
      name: STAGE_NAMES.HUMAN_AUDIT,
      description: '人工审核方案设计，决定是否开发。',
      responsibleRule: '技术负责人审批',
      admission: '评估报告已生成',
      deliverables: '审批结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.DEVELOPMENT,
      description: 'AI 自动完成代码开发。',
      responsibleRule: 'AI 开发分身',
      aiCapability: '代码生成、测试、分支提交',
      admission: '需求与方案已审核通过',
      deliverables: '代码分支、单元测试、变更说明',
    },
    {
      name: STAGE_NAMES.REVIEW,
      description: 'AI 检查代码质量与安全问题并判定通过/不通过；不通过自动返回 AI 开发修复（最多 2 次），超限转人工裁决。',
      responsibleRule: 'AI 评审助理自动执行，超限人工裁决',
      aiCapability: '代码质量、安全漏洞、风格一致性',
      admission: '代码已产出',
      deliverables: 'AI 评审报告与通过/不通过结论',
    },
    {
      name: STAGE_NAMES.HUMAN_REVIEW,
      description: '人工对 AI 代码做最终确认，不通过返回 AI 开发修改。',
      responsibleRule: '代码审查人或技术负责人审批',
      admission: '评审报告已生成',
      deliverables: '评审结论：通过 / 不通过（返回 AI 开发）',
    },
    {
      name: STAGE_NAMES.DEV_COMPLETE,
      description: '流程终态节点：需求评估不通过时人工接管需求；开发完成时人工确认交付。',
      responsibleRule: '技术负责人接管或最终确认',
      admission: '需求评估不通过 / 人工评审通过',
      deliverables: '人工接管结论 / 可合并的代码分支',
    },
  ],
  responsibleRules: [
    { role: '产品经理/需求受理人', items: ['需求录入与确认'] },
    { role: '技术负责人/架构师', items: ['方案与技术决策'] },
    { role: 'AI 开发数字分身', items: ['端到端代码开发与测试'] },
    { role: '代码审查人/技术负责人', items: ['人工评审', '人工介入'] },
  ],
  aiCapabilities: [
    { role: 'AI 方案助理', items: ['自动生成技术方案与接口设计'] },
    { role: 'AI 评审助理', items: ['评估方案风险与代码质量'] },
    { role: 'AI 开发数字分身', items: ['端到端代码开发与测试', '根据评审反馈自动返修'] },
  ],
  admissions: [
    '需求已完成录入并指派',
    '需求评估通过（适合 AI 开发）',
    '方案通过 AI 方案评估与人工审核',
  ],
  deliverables: [
    '技术方案设计文档',
    '可运行的代码分支',
    '单元测试与变更说明',
    'AI 评审报告',
    '最终可合并的交付物',
  ],
};

// ── AI测试资产流程模板 ──

const AUTO_TEST_ASSET_TEMPLATE: FlowTemplate = {
  id: 'auto_test_asset',
  name: 'AI测试资产流程',
  description: '聚焦测试资产产出：从测试需求到测试用例评审，AI 负责测试计划设计与用例生成，人工负责关键方案与用例评审。',
  type: 'auto_test_asset',
  stages: [
    buildHumanStage(STAGE_NAMES.TEST_REQUIREMENT, '测试需求'),
    buildAIStage(STAGE_NAMES.TEST_PLAN_DESIGN, '测试计划设计', '测试助理'),
    buildJudgeStage(STAGE_NAMES.TEST_PLAN_REVIEW, '测试计划评审'),
    buildAIStage(STAGE_NAMES.TEST_CASE_GEN, '测试用例生成', '测试助理'),
    buildJudgeStage(STAGE_NAMES.TEST_CASE_REVIEW, '用例评审'),
    buildHumanStage(STAGE_NAMES.TEST_COMPLETE, '测试完成'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.TEST_REQUIREMENT,
      description: '明确测试范围、目标与验收标准。',
      responsibleRule: '测试负责人确认需求',
      aiCapability: '测试点与验收条件提取',
      admission: '已产出待测需求或代码',
      deliverables: '测试需求清单',
    },
    {
      name: STAGE_NAMES.TEST_PLAN_DESIGN,
      description: 'AI 生成测试计划与策略。',
      responsibleRule: 'AI 测试助理',
      aiCapability: '测试策略、覆盖范围、资源估算',
      admission: '测试需求已确认',
      deliverables: '测试计划文档',
    },
    {
      name: STAGE_NAMES.TEST_PLAN_REVIEW,
      description: '人工评审测试计划充分性。',
      responsibleRule: '测试负责人审批',
      admission: '测试计划已生成',
      deliverables: '评审结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.TEST_CASE_GEN,
      description: 'AI 生成覆盖功能、边界与异常的用例。',
      responsibleRule: 'AI 测试助理执行',
      aiCapability: '用例与预期结果生成',
      admission: '计划已通过评审',
      deliverables: '测试用例集合',
    },
    {
      name: STAGE_NAMES.TEST_CASE_REVIEW,
      description: '人工确认用例覆盖度与可执行性。',
      responsibleRule: '测试工程师评审',
      admission: '用例已生成',
      deliverables: '评审结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.TEST_COMPLETE,
      description: '测试资产已就绪，可交付测试执行流程。',
      responsibleRule: '测试负责人归档确认',
      admission: '测试计划与用例已通过评审',
      deliverables: '最终测试资产包',
    },
  ],
  responsibleRules: [
    { role: '产品经理/测试负责人', items: ['测试需求确认'] },
    { role: 'AI 测试助理 + 人工', items: ['测试计划与用例生成及评审'] },
    { role: '测试负责人', items: ['测试资产归档'] },
  ],
  aiCapabilities: [
    { role: 'AI 测试助理', items: ['自动生成测试计划与用例'] },
  ],
  admissions: [
    '已具备待测需求或可测代码',
    '测试计划与用例已通过评审',
  ],
  deliverables: [
    '测试计划',
    '测试用例集合',
  ],
};

// ── AI测试执行流程模板 ──

const AUTO_TEST_EXECUTION_TEMPLATE: FlowTemplate = {
  id: 'auto_test_execution',
  name: 'AI测试执行流程',
  description: '聚焦测试执行与闭环：在测试资产就绪后，AI 自动执行测试、分析缺陷并生成报告，人工负责准入评审。',
  type: 'auto_test_execution',
  stages: [
    buildHumanStage(STAGE_NAMES.TEST_REQUIREMENT, '测试需求'),
    buildAIStage(STAGE_NAMES.TEST_AUTO_EXEC, '自动化执行', '测试助理'),
    buildAIStage(STAGE_NAMES.TEST_DEFECT_VERIFY, '缺陷验证', '测试助理'),
    buildJudgeStage(STAGE_NAMES.TEST_ADMISSION_REVIEW, '准入评审'),
    buildHumanStage(STAGE_NAMES.TEST_COMPLETE, '测试完成'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.TEST_REQUIREMENT,
      description: '明确本次执行的测试范围与目标。',
      responsibleRule: '测试负责人确认需求',
      aiCapability: '测试点与验收条件提取',
      admission: '已具备测试资产或可测代码',
      deliverables: '测试执行需求清单',
    },
    {
      name: STAGE_NAMES.TEST_AUTO_EXEC,
      description: 'AI 自动执行测试并收集结果。',
      responsibleRule: 'AI 测试助理执行',
      aiCapability: '自动化测试、日志采集、覆盖率',
      admission: '测试资产已通过评审',
      deliverables: '测试执行报告',
    },
    {
      name: STAGE_NAMES.TEST_DEFECT_VERIFY,
      description: 'AI 分析失败用例，定位缺陷并给出根因分析。',
      responsibleRule: 'AI 分析，工程师确认',
      aiCapability: '失败日志分析、缺陷定位、复现路径',
      admission: '自动化执行已完成',
      deliverables: '缺陷分析报告',
    },
    {
      name: STAGE_NAMES.TEST_ADMISSION_REVIEW,
      description: '人工评估是否满足发布准入条件。',
      responsibleRule: '测试/发布负责人审批',
      admission: '缺陷已分析',
      deliverables: '准入评审结论',
    },
    {
      name: STAGE_NAMES.TEST_COMPLETE,
      description: '测试执行结束，输出完整报告。',
      responsibleRule: '测试负责人归档确认',
      admission: '准入评审通过',
      deliverables: '最终测试报告',
    },
  ],
  responsibleRules: [
    { role: '产品经理/测试负责人', items: ['测试执行需求确认'] },
    { role: 'AI 测试助理', items: ['自动化测试执行', '缺陷分析与定位'] },
    { role: '测试负责人/发布负责人', items: ['准入评审'] },
  ],
  aiCapabilities: [
    { role: 'AI 测试助理', items: ['自动化执行测试并采集结果', '失败分析与缺陷定位'] },
  ],
  admissions: [
    '已具备测试资产或可测代码',
    '自动化执行完成且缺陷已分析',
  ],
  deliverables: [
    '测试执行报告',
    '缺陷分析报告',
    '最终测试报告',
  ],
};

// ── 产品流程模板 ──

const PRODUCT_TEMPLATE: FlowTemplate = {
  id: 'product',
  name: 'AI需求设计流程',
  description: '轻量级 AI Coding 平台适用的产品工作向导：从需求头脑风暴到需求评审结束，AI 负责发散、拆解、调研、草案、AI复核、PRD 与原型，人工负责方案复核、原型评审与最终需求评审（三路驳回）。',
  type: 'product',
  stages: [
    buildAIStage(STAGE_NAMES.PRODUCT_BRAINSTORM, '需求头脑风暴', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_BREAKDOWN, '功能拆解', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_RESEARCH, '方案调研与选型', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_DRAFT, '草案输出', '产品助理'),
    buildJudgeStage(STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW, 'AI草案复核'),
    buildJudgeStage(STAGE_NAMES.PRODUCT_REVIEW, '方案自主复核'),
    buildGatewayStage(STAGE_NAMES.PRODUCT_AI_GATEWAY, 'AI设计决策'),
    buildAIStage(STAGE_NAMES.PRODUCT_PRD_WRITE, 'PRD初稿生成', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_PROTO_MAKE, '原型初稿生成', '产品助理'),
    buildJudgeStage(STAGE_NAMES.PRODUCT_PROTO_REVIEW, '需求设计复核'),
    buildHumanStage(STAGE_NAMES.PRODUCT_FINAL_REVIEW, '需求评审'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.PRODUCT_BRAINSTORM,
      description: 'AI 进行需求头脑风暴，产出结构化要点。',
      input: '原始需求描述、背景信息、目标用户。',
      processing: 'AI 产品助理多轮提问，收敛为结构化需求要点。',
      responsibleRule: 'AI 产品助理主导，产品经理确认',
      aiCapability: '需求发散、要点提取、结构化',
      admission: '已提出原始需求',
      deliverables: '结构化需求要点文档',
      command: '/grill-me',
    },
    {
      name: STAGE_NAMES.PRODUCT_BREAKDOWN,
      description: 'AI 将需求要点拆解为功能模块与子任务。',
      input: '结构化需求要点文档。',
      processing: 'AI 产品助理按功能域拆解为模块化任务清单。',
      responsibleRule: 'AI 产品助理主导，产品经理确认',
      aiCapability: '功能拆解、模块划分、任务结构化',
      admission: '需求要点已产出',
      deliverables: '功能拆解清单、模块关系图',
      command: '/grill-me',
    },
    {
      name: STAGE_NAMES.PRODUCT_RESEARCH,
      description: '输入目标网址，AI 自动爬取网站并产出产品分析、功能列表、UI 设计与高仿原型。',
      input: '目标网站 URL + 功能拆解清单 + 可选登录凭证。',
      processing: 'AI 爬取网站内容，分析产品功能与 UI 设计，生成分析文档与原型工程。',
      responsibleRule: 'AI 产品助理执行，产品经理审核',
      aiCapability: '网站爬取、产品分析、UI 还原、原型生成',
      admission: '用户提供目标网址，功能已拆解',
      deliverables: '竞品调研产品整体分析、竞品调研产品功能列表、竞品调研产品UI设计分析、高仿原型',
      command: '/prd-research',
    },
    {
      name: STAGE_NAMES.PRODUCT_DRAFT,
      description: 'AI 输出初步业务方案草案。',
      input: '调研结论（业务方案、技术约束、备选方案对比）。',
      processing: 'AI 整合调研结论，输出草案并提示风险。',
      responsibleRule: 'AI 产品助理生成，产品经理复核',
      aiCapability: '方案整合、草案撰写、风险提示',
      admission: '方案调研已完成',
      deliverables: '初步业务方案',
      command: '/prd-research',
    },
    {
      name: STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW,
      description: 'AI 自动复核方案草案的完整性、一致性与可行性。',
      input: '初步业务方案草案。',
      processing: 'AI 从完整性、一致性、可行性等维度自动审查草案并输出复核意见。',
      responsibleRule: 'AI 产品助理自动执行',
      aiCapability: '方案复核、一致性检查、可行性评估',
      admission: '草案已产出',
      deliverables: 'AI 复核报告（含问题清单与改进建议）',
    },
    {
      name: STAGE_NAMES.PRODUCT_REVIEW,
      description: '产品经理自主复核方案草案。',
      input: '初步业务方案草案 + AI 复核报告。',
      processing: '产品经理复核方案合理性，决定通过或返回修订。',
      responsibleRule: '产品经理复核',
      admission: '方案草案与 AI 复核报告已产出',
      deliverables: '复核结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.PRODUCT_AI_GATEWAY,
      description: 'AI 自主决策节点：仅需 PRD 即跳过原型直接写 PRD；需要原型则同时产生原型+PRD。两路并行、择一或全并行。',
      input: '方案复核通过结论。',
      processing: 'AI 根据需求复杂度与类型判断输出方案：仅 PRD 或 原型+PRD。两路独立并行，完成后汇入联合复核。',
      responsibleRule: 'AI 产品助理自主决策',
      aiCapability: '根据需求类型自动决策输出内容',
      admission: '方案复核通过',
      deliverables: '决策结论（输出路径）',
    },
    {
      name: STAGE_NAMES.PRODUCT_PROTO_MAKE,
      description: 'AI 根据方案生成 UI 交互原型。',
      input: '定稿方案。',
      processing: 'AI 根据方案生成可运行的 UI 原型。与 PRD 生成并行，互不阻塞。',
      responsibleRule: 'AI 产品助理',
      aiCapability: '生成原型页面、交互说明、页面流程',
      admission: 'AI 并行决策器通过（原型路径）',
      deliverables: 'UI 交互原型',
      command: '/proto-make',
    },
    {
      name: STAGE_NAMES.PRODUCT_PRD_WRITE,
      description: 'AI 根据定稿方案生成结构化 PRD。',
      input: '定稿方案。当原型未产出时，PRD 可独立生成；否则基于已有原型补充细节。',
      processing: 'AI 产品助理自动撰写结构化 PRD。在上行与原型初稿生成并行执行，互不阻塞。',
      responsibleRule: 'AI 产品助理',
      aiCapability: '自动撰写 PRD、流程说明、验收标准',
      admission: 'AI 并行决策器通过（PRD 路径）',
      deliverables: '结构化 PRD 文档',
      command: '/prd-write',
    },
    {
      name: STAGE_NAMES.PRODUCT_PROTO_REVIEW,
      description: '产品经理对需求设计复核，检查交互一致性、需求覆盖度与方案合理性。',
      input: 'UI 交互原型（可选） + 结构化 PRD + 定稿方案。',
      processing: '产品经理复核 PRD 文档与原型，决定通过或退回草案重新构思。',
      responsibleRule: '产品经理决策',
      admission: '原型 和/或 PRD 已产出',
      deliverables: '复核结论：通过 / 不通过（退回草案）',
      command: '/proto-make',
    },
    {
      name: STAGE_NAMES.PRODUCT_FINAL_REVIEW,
      description: '最终需求评审，通过即定稿并一键启动 AI 开发。驳回则回到需求设计复核。',
      input: '通过复核的 PRD + 原型。',
      processing: '产品经理组织相关方评审并决策，通过即定稿。支持按问题类型三路驳回。',
      responsibleRule: '产品经理组织评审并决策',
      admission: '原型评审通过 + PRD 已生成',
      deliverables: '需求定稿、开发排期输入',
    },
  ],
  responsibleRules: [
    { role: '产品经理', items: ['方案自主复核', '需求设计复核', '需求评审'] },
    { role: 'AI 产品助理', items: ['需求头脑风暴', '功能拆解', '方案调研', '草案输出', 'AI草案复核', 'AI设计决策', 'PRD初稿生成', '原型初稿生成'] },
    { role: '设计师（可选）', items: ['原型视觉与交互调整'] },
  ],
  aiCapabilities: [
    { role: 'AI 产品助理', items: ['需求头脑风暴与要点结构化', '功能拆解与模块划分', '方案调研、选型对比与草案输出', '方案草案自动复核', 'AI 自主决策输出路径', '根据方案生成可交互原型', '自动生成结构化 PRD'] },
  ],
  admissions: [
    '业务方或用户已提出原始需求',
    '方案自主复核通过',
    'AI 并行决策器完成（输出路径已确定）',
    '需求设计复核通过',
    'PRD 已产出',
  ],
  deliverables: [
    '结构化需求要点',
    '功能拆解清单',
    '业务方案与备选方案对比',
    '初步业务方案',
    'AI 草案复核报告',
    'UI 交互原型（可选）',
    '结构化 PRD',
    '需求定稿（通过即可一键启动 AI 开发）',
  ],
};

// ── 模板索引 ──

const TEMPLATES: Record<TemplateType, FlowTemplate> = {
  ai_dev: AI_DEV_TEMPLATE,
  auto_test_asset: AUTO_TEST_ASSET_TEMPLATE,
  auto_test_execution: AUTO_TEST_EXECUTION_TEMPLATE,
  product: PRODUCT_TEMPLATE,
};

const TEMPLATE_ORDER: TemplateType[] = ['product', 'ai_dev', 'auto_test_asset', 'auto_test_execution'];

// ── 子组件 ──

function isRoleGroups(items: string[] | RoleGroup[]): items is RoleGroup[] {
  return items.length > 0 && typeof items[0] === 'object';
}

function InfoCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] | RoleGroup[] }) {
  return (
    <Card className="border border-border/50 soft-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isRoleGroups(items) ? (
          <div className="space-y-3">
            {items.map((group, gIdx) => (
              <div key={gIdx}>
                <div className="text-sm font-medium text-foreground mb-1.5">{group.role}</div>
                <ul className="space-y-1.5 pl-1">
                  {group.items.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateOverview({ template }: { template: FlowTemplate }) {
  return (
    <Card className="border border-border/50 soft-shadow mb-6">
      <CardHeader>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary">
            {template.type === 'ai_dev' ? '研发人员' : template.type.startsWith('auto_test') ? '测试人员' : '产品经理'}
          </Badge>
        </div>
        <CardTitle className="text-lg">{template.name}</CardTitle>
        <CardDescription>{template.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <InfoCard icon={<Users className="h-4 w-4 text-emerald-500" />} title="责任人规则" items={template.responsibleRules} />
          <InfoCard icon={<Bot className="h-4 w-4 text-blue-500" />} title="AI 分身能力" items={template.aiCapabilities} />
          <InfoCard icon={<FileCheck className="h-4 w-4 text-amber-500" />} title="准入条件" items={template.admissions} />
          <InfoCard icon={<FileText className="h-4 w-4 text-purple-500" />} title="交付物" items={template.deliverables} />
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateStageTable({ template, selectedStage }: { template: FlowTemplate; selectedStage?: string }) {
  const detailMap = new Map(template.stageDetails.map(d => [d.name, d]));

  return (
    <Card className="border border-border/50 soft-shadow">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">节点说明</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">节点</TableHead>
              <TableHead className="w-48">输入</TableHead>
              <TableHead className="w-56">处理</TableHead>
              <TableHead className="w-36">交付物</TableHead>
              <TableHead className="w-64">责任人</TableHead>
              <TableHead className="w-40">准入条件</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {template.stages.map(stage => {
              const detail = detailMap.get(stage.name);
              if (!detail) return null;
              const inputText = detail.input || detail.description;
              const processingText = detail.processing || detail.description;
              const isAiRule = detail.responsibleRule.startsWith('AI ');
              const isSelected = selectedStage === stage.name;
              return (
                <TableRow
                  key={stage.name}
                  id={`stage-row-${template.id}-${stage.name}`}
                  className={isSelected ? 'ring-2 ring-primary/30 shadow-[0_2px_12px_rgba(59,130,246,0.18)] rounded-lg bg-primary/5' : ''}
                >
                  <TableCell className="font-semibold">{stage.label}</TableCell>
                  <TableCell>{inputText}</TableCell>
                  <TableCell>{processingText}</TableCell>
                  <TableCell>{detail.deliverables}</TableCell>
                  <TableCell className="text-sm">
                    {detail.responsibleRule && (isAiRule
                      ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3 text-blue-500 shrink-0" />{detail.responsibleRule}</span>
                      : <span className="inline-flex items-center gap-1"><Users className="h-3 w-3 text-emerald-500 shrink-0" />{detail.responsibleRule}</span>
                    )}
                    {detail.responsibleRule && detail.aiCapability && <span className="mx-1.5 text-muted-foreground">|</span>}
                    {detail.aiCapability && <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3 text-blue-500 shrink-0" />{detail.aiCapability}</span>}
                  </TableCell>
                  <TableCell>{detail.admission}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TemplateList({ templates, onSelect }: { templates: FlowTemplate[]; onSelect: (t: FlowTemplate) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {templates.map(template => (
        <Card
          key={template.id}
          className="border border-border/50 soft-shadow cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => onSelect(template)}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary">
                {template.type === 'ai_dev' ? '研发人员' : template.type.startsWith('auto_test') ? '测试人员' : '产品经理'}
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-lg mt-2">{template.name}</CardTitle>
            <CardDescription className="line-clamp-2">{template.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-emerald-500" />
                <span>{template.responsibleRules.length} 个责任角色</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-blue-500" />
                <span>{template.aiCapabilities.length} 项 AI 能力</span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileCheck className="h-3.5 w-3.5 text-amber-500" />
                <span>{template.admissions.length} 条准入条件</span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-purple-500" />
                <span>{template.deliverables.length} 个交付物</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TemplateDetail({ template, onBack }: { template: FlowTemplate; onBack: () => void }) {
  const [selectedStage, setSelectedStage] = React.useState<string | undefined>();

  const handleStageClick = (name: string) => {
    setSelectedStage(name);
    const element = document.getElementById(`stage-row-${template.id}-${name}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          返回列表
        </Button>
        <div>
          <h3 className="text-lg font-semibold">{template.name}</h3>
          <p className="text-sm text-muted-foreground">{template.description}</p>
        </div>
      </div>
      <TemplateOverview template={template} />
      <Card className="border border-border/50 soft-shadow">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">流程图</CardTitle>
          <CardDescription>点击下方节点可快速定位到节点说明</CardDescription>
        </CardHeader>
        <CardContent>
          <FlowGraph stages={template.stages} onStageClick={handleStageClick} processType={template.type} />
        </CardContent>
      </Card>
      <TemplateStageTable template={template} selectedStage={selectedStage} />
    </div>
  );
}

// ── 页面组件 ──

export const FlowTemplateMarketContent: React.FC = () => {
  const [selectedTemplate, setSelectedTemplate] = React.useState<TemplateType | null>(null);

  if (selectedTemplate) {
    return <TemplateDetail template={TEMPLATES[selectedTemplate]} onBack={() => setSelectedTemplate(null)} />;
  }

  return <TemplateList templates={TEMPLATE_ORDER.map(type => TEMPLATES[type])} onSelect={t => setSelectedTemplate(t.id)} />;
};

export const FlowTemplateMarket: React.FC = () => {
  return (
    <div className="flex-1 max-w-7xl mx-auto w-full pb-12 space-y-6">
      <div className="border-b border-border/50 pb-4">
        <h2 className="text-2xl font-bold tracking-tight">流程模板市场</h2>
        <p className="text-muted-foreground mt-1">
          标准流水线知识库：浏览平台预置的AI需求产品 / 研发 / 测试流程模板，点击卡片查看完整链路与节点说明。
        </p>
      </div>
      <FlowTemplateMarketContent />
    </div>
  );
};
