import React from 'react';
import { Bot, CheckCircle2, FileCheck, FileText, Layers, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FlowGraph } from '@/components/FlowGraph';
import {
  STAGE_NAMES,
  STAGE_STATUS,
  STAGE_TYPE,
  OPERATOR_TYPE,
  type ProcessStage,
} from '@/lib/process-api';

// ── 类型定义 ──

type TemplateType = 'ai_dev' | 'auto_test' | 'product';

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

interface FlowTemplate {
  id: TemplateType;
  name: string;
  description: string;
  type: TemplateType;
  stages: ProcessStage[];
  stageDetails: StageDetail[];
  responsibleRules: string[];
  aiCapabilities: string[];
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

// ── AI 开发流程模板 ──

const AI_DEV_TEMPLATE: FlowTemplate = {
  id: 'ai_dev',
  name: '智能化需求研发流程',
  description: '从研发需求受理到代码交付的全自动 AI 开发流水线，覆盖需求评估、架构设计、AI 评审、人工审核、代码开发、代码评审与优化闭环。',
  type: 'ai_dev',
  stages: [
    buildHumanStage(STAGE_NAMES.REQUIREMENT, '需求受理'),
    buildJudgeStage(STAGE_NAMES.REQUIREMENT_EVAL, '需求评估'),
    buildAIStage(STAGE_NAMES.ARCH_DESIGN, '架构设计', '架构助理'),
    buildAIStage(STAGE_NAMES.AI_EVAL, 'AI 方案评估', '评审助理'),
    buildJudgeStage(STAGE_NAMES.HUMAN_AUDIT, '人工审核'),
    buildAIStage(STAGE_NAMES.DEVELOPMENT, 'AI 开发', '开发助理'),
    buildAIStage(STAGE_NAMES.REVIEW, 'AI 代码评审', '评审助理'),
    buildJudgeStage(STAGE_NAMES.HUMAN_REVIEW, '人工评审'),
    buildAIStage(STAGE_NAMES.CODE_OPTIMIZE, '代码优化', '优化助理'),
    buildHumanStage(STAGE_NAMES.DEV_COMPLETE, '开发完成'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.REQUIREMENT,
      description: '受理并确认需求，决定是否进入 AI 开发流程。',
      responsibleRule: '产品经理或需求受理人负责确认需求范围和优先级。',
      aiCapability: '辅助解析需求，提取关键要素。',
      admission: '需求已创建并指派给对应负责人。',
      deliverables: '已确认的需求工单',
    },
    {
      name: STAGE_NAMES.REQUIREMENT_EVAL,
      description: '判断需求是否需要架构设计，或直接开发。',
      responsibleRule: '由 AI 初审 + 人工确认决策。',
      aiCapability: '基于历史项目判断复杂度与开发路径。',
      admission: '需求受理完成。',
      deliverables: '决策结论：直接进入开发 / 进入架构设计',
    },
    {
      name: STAGE_NAMES.ARCH_DESIGN,
      description: 'AI 根据需求生成技术方案与架构设计。',
      responsibleRule: 'AI 架构助理主导，架构师可复核。',
      aiCapability: '生成技术选型、模块拆分、接口草案。',
      admission: '需求评估判定需要架构设计。',
      deliverables: '架构方案文档、接口草稿、任务拆分',
    },
    {
      name: STAGE_NAMES.AI_EVAL,
      description: 'AI 对架构方案进行自评，识别潜在风险。',
      responsibleRule: 'AI 评审助理自动执行。',
      aiCapability: '风险识别、方案一致性检查、性能影响评估。',
      admission: '架构设计已产出。',
      deliverables: '评估报告与风险提示',
    },
    {
      name: STAGE_NAMES.HUMAN_AUDIT,
      description: '人工审核架构方案，决定是否进入开发。',
      responsibleRule: '技术负责人或架构师负责审批。',
      admission: 'AI 评估报告已生成。',
      deliverables: '审批结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.DEVELOPMENT,
      description: 'AI 根据需求和架构方案自动完成代码开发。',
      responsibleRule: 'AI 开发数字分身执行，开发工程师可监控进度。',
      aiCapability: '代码生成、单元测试、分支提交、工程文件管理。',
      admission: '需求与架构方案已通过审核。',
      deliverables: '可运行的代码分支、单元测试、变更说明',
    },
    {
      name: STAGE_NAMES.REVIEW,
      description: 'AI 对生成的代码进行静态检查与问题识别。',
      responsibleRule: 'AI 评审助理自动执行。',
      aiCapability: '代码质量检查、安全漏洞识别、风格一致性检测。',
      admission: '开发阶段已产出代码。',
      deliverables: 'AI 评审报告',
    },
    {
      name: STAGE_NAMES.HUMAN_REVIEW,
      description: '人工对 AI 代码与评审报告做最终确认。',
      responsibleRule: '代码审查人或技术负责人负责审批。',
      admission: 'AI 评审报告已生成。',
      deliverables: '人工评审结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.CODE_OPTIMIZE,
      description: '针对人工评审反馈，AI 自动修复与优化代码。',
      responsibleRule: 'AI 优化助理执行，开发工程师复核。',
      aiCapability: '根据评审意见自动修改代码、补充测试、重新提交。',
      admission: '人工评审判定需要优化。',
      deliverables: '优化后的代码与测试',
    },
    {
      name: STAGE_NAMES.DEV_COMPLETE,
      description: '确认代码质量达标，流程结束。',
      responsibleRule: '技术负责人或开发责任人最终确认。',
      admission: '人工评审通过。',
      deliverables: '可合并的代码分支、最终交付物',
    },
  ],
  responsibleRules: [
    '需求阶段由产品经理/需求受理人负责',
    '架构与技术决策由技术负责人/架构师负责',
    '开发执行由 AI 开发数字分身负责',
    '人工评审由代码审查人或技术负责人负责',
  ],
  aiCapabilities: [
    'AI 架构助理：自动生成技术方案与接口设计',
    'AI 评审助理：评估方案风险与代码质量',
    'AI 开发数字分身：端到端代码开发与测试',
    'AI 优化助理：根据反馈自动修复与优化',
  ],
  admissions: [
    '需求已完成录入并指派',
    'AI 评估或人工决策确认开发路径',
    '架构方案通过人工审核',
  ],
  deliverables: [
    '技术架构方案',
    '可运行的代码分支',
    '单元测试与变更说明',
    'AI 评审报告',
    '最终可合并的交付物',
  ],
};

// ── 智能化测试流程模板 ──

const AUTO_TEST_TEMPLATE: FlowTemplate = {
  id: 'auto_test',
  name: '智能化需求测试流程',
  description: '从测试需求到准入评审的智能化测试流水线，AI 负责测试计划、用例生成与自动执行，人工负责关键评审与缺陷确认。',
  type: 'auto_test',
  stages: [
    buildHumanStage(STAGE_NAMES.TEST_REQUIREMENT, '测试需求'),
    buildAIStage(STAGE_NAMES.TEST_PLAN_DESIGN, '测试计划设计', '测试助理'),
    buildJudgeStage(STAGE_NAMES.TEST_PLAN_REVIEW, '测试计划评审'),
    buildAIStage(STAGE_NAMES.TEST_CASE_GEN, '测试用例生成', '测试助理'),
    buildJudgeStage(STAGE_NAMES.TEST_CASE_REVIEW, '用例评审'),
    buildAIStage(STAGE_NAMES.TEST_AUTO_EXEC, '自动化执行', '测试助理'),
    buildAIStage(STAGE_NAMES.TEST_DEFECT_VERIFY, '缺陷验证', '测试助理'),
    buildJudgeStage(STAGE_NAMES.TEST_ADMISSION_REVIEW, '准入评审'),
    buildHumanStage(STAGE_NAMES.TEST_COMPLETE, '测试完成'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.TEST_REQUIREMENT,
      description: '明确测试范围、目标与验收标准。',
      responsibleRule: '测试负责人或产品经理确认测试需求。',
      aiCapability: '辅助提取测试点与验收条件。',
      admission: '开发阶段已产出待测需求或代码分支。',
      deliverables: '测试需求清单',
    },
    {
      name: STAGE_NAMES.TEST_PLAN_DESIGN,
      description: 'AI 根据需求和代码生成测试计划与策略。',
      responsibleRule: 'AI 测试助理主导，测试工程师复核。',
      aiCapability: '自动生成测试策略、覆盖范围、资源估算。',
      admission: '测试需求已确认。',
      deliverables: '测试计划文档',
    },
    {
      name: STAGE_NAMES.TEST_PLAN_REVIEW,
      description: '人工评审测试计划是否充分。',
      responsibleRule: '测试负责人或技术负责人审批。',
      admission: 'AI 测试计划已生成。',
      deliverables: '评审结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.TEST_CASE_GEN,
      description: 'AI 生成覆盖功能、边界与异常的测试用例。',
      responsibleRule: 'AI 测试助理执行。',
      aiCapability: '基于需求与代码生成测试用例与预期结果。',
      admission: '测试计划已通过评审。',
      deliverables: '测试用例集合',
    },
    {
      name: STAGE_NAMES.TEST_CASE_REVIEW,
      description: '人工确认用例覆盖度与可执行性。',
      responsibleRule: '测试工程师负责评审。',
      admission: '测试用例已生成。',
      deliverables: '评审结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.TEST_AUTO_EXEC,
      description: 'AI 自动执行测试用例并收集结果。',
      responsibleRule: 'AI 测试助理执行。',
      aiCapability: '自动化运行测试脚本、采集日志与覆盖率。',
      admission: '用例已通过评审。',
      deliverables: '测试执行报告',
    },
    {
      name: STAGE_NAMES.TEST_DEFECT_VERIFY,
      description: 'AI 分析失败用例，定位疑似缺陷并给出根因分析。',
      responsibleRule: 'AI 测试助理分析，开发工程师确认。',
      aiCapability: '失败日志分析、缺陷定位建议、复现路径。',
      admission: '自动化执行已完成。',
      deliverables: '缺陷分析报告',
    },
    {
      name: STAGE_NAMES.TEST_ADMISSION_REVIEW,
      description: '人工综合评估是否满足发布准入条件。',
      responsibleRule: '测试负责人或发布负责人最终审批。',
      admission: '缺陷验证与测试报告已产出。',
      deliverables: '准入评审结论',
    },
    {
      name: STAGE_NAMES.TEST_COMPLETE,
      description: '测试流程结束，输出完整测试产物。',
      responsibleRule: '测试负责人确认归档。',
      admission: '准入评审通过。',
      deliverables: '最终测试报告',
    },
  ],
  responsibleRules: [
    '测试需求由产品经理/测试负责人确认',
    '测试计划与用例由 AI 测试助理生成、人工评审',
    '测试执行与缺陷分析由 AI 测试助理负责',
    '准入评审由测试负责人或发布负责人负责',
  ],
  aiCapabilities: [
    'AI 测试助理：自动生成测试计划与用例',
    'AI 测试助理：自动化执行测试并采集结果',
    'AI 测试助理：失败分析与缺陷定位',
  ],
  admissions: [
    '已具备待测需求或可测代码',
    '测试计划与用例已通过评审',
    '自动化执行完成且缺陷已分析',
  ],
  deliverables: [
    '测试计划',
    '测试用例集合',
    '测试执行报告',
    '缺陷分析报告',
    '最终测试报告',
  ],
};

// ── 产品流程模板 ──

const PRODUCT_TEMPLATE: FlowTemplate = {
  id: 'product',
  name: '智能化需求产品流程',
  description: '轻量级 AI Coding 平台适用的产品工作向导：从需求头脑风暴到需求评审结束，AI 负责发散、调研、草案、PRD 与原型，人工负责方案自主复核、原型交互复核与最终需求评审。简易链路无原型时可直接从 PRD 进入需求评审。',
  type: 'product',
  stages: [
    buildAIStage(STAGE_NAMES.PRODUCT_BRAINSTORM, '需求头脑风暴', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_RESEARCH, '方案调研与选型', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_DRAFT, '草案输出', '产品助理'),
    buildJudgeStage(STAGE_NAMES.PRODUCT_REVIEW, '方案自主复核'),
    buildAIStage(STAGE_NAMES.PRODUCT_PRD_WRITE, 'PRD初稿生成', '产品助理'),
    buildAIStage(STAGE_NAMES.PRODUCT_PROTO_MAKE, '原型生成', '产品助理'),
    buildJudgeStage(STAGE_NAMES.PRODUCT_PROTO_REVIEW, '原型交互复核'),
    buildHumanStage(STAGE_NAMES.PRODUCT_FINAL_REVIEW, '需求评审'),
  ],
  stageDetails: [
    {
      name: STAGE_NAMES.PRODUCT_BRAINSTORM,
      description: 'AI 基于业务背景进行需求头脑风暴，产出结构化需求要点；产品手动确认完成。',
      input: '业务方/用户提出的原始需求描述、背景信息、目标用户群。',
      processing: 'AI 产品助理通过多轮提问澄清核心场景、用户角色、内容范围、业务规则，收敛为结构化需求要点。',
      responsibleRule: 'AI 产品助理主导发散，产品经理确认完成。',
      aiCapability: '需求发散、要点提取、结构化梳理。',
      admission: '业务方或用户已提出原始需求。',
      deliverables: '结构化需求要点',
      command: '/brainstorm',
    },
    {
      name: STAGE_NAMES.PRODUCT_RESEARCH,
      description: 'AI 针对需求要点进行方案调研与选型，输出业务方案、技术约束及备选方案对比。',
      input: '已确认的结构化需求要点。',
      processing: 'AI 产品助理检索业务方案、识别技术约束、对比备选方案，形成选型建议。',
      responsibleRule: 'AI 产品助理执行调研，产品经理审核方向。',
      aiCapability: '业务方案检索、技术约束识别、备选方案对比。',
      admission: '需求要点已确认。',
      deliverables: '业务方案、技术约束、备选方案对比',
      command: '/prd-research',
    },
    {
      name: STAGE_NAMES.PRODUCT_DRAFT,
      description: 'AI 基于调研结论输出初步业务方案草案。',
      input: '调研结论（业务方案、技术约束、备选方案对比）。',
      processing: 'AI 产品助理整合调研结论，输出初步业务方案草案并提示风险点。',
      responsibleRule: 'AI 产品助理生成，产品经理复核。',
      aiCapability: '方案整合、草案撰写、风险点提示。',
      admission: '方案调研与选型已完成。',
      deliverables: '初步业务方案',
      command: '/prd-research',
    },
    {
      name: STAGE_NAMES.PRODUCT_REVIEW,
      description: '产品经理对方案草案进行自主复核；通过则继续，不通过则返回方案草案输出节点由 AI 优化后再次复核。外部沟通线下开展，平台不强制组织评审。',
      input: '初步业务方案草案。',
      processing: '产品经理自主复核方案合理性，决定进入 PRD 生成或返回修订方案。',
      responsibleRule: '产品经理负责复核。',
      admission: '方案草案已产出。',
      deliverables: '复核结论：通过 / 不通过',
    },
    {
      name: STAGE_NAMES.PRODUCT_PRD_WRITE,
      description: 'AI 根据定稿方案生成结构化 PRD 文档。',
      input: '定稿方案。',
      processing: 'AI 产品助理根据定稿方案自动撰写结构化 PRD。',
      responsibleRule: 'AI 产品助理生成，产品经理修改确认。',
      aiCapability: '自动撰写 PRD、流程说明、验收标准。',
      admission: '方案自主复核通过。',
      deliverables: '结构化 PRD 文档',
      command: '/prd-write',
    },
    {
      name: STAGE_NAMES.PRODUCT_PROTO_MAKE,
      description: 'AI 根据 PRD 生成 UI 交互原型。',
      input: '结构化 PRD 文档。',
      processing: 'AI 产品助理根据 PRD 生成可运行的 UI 交互原型。',
      responsibleRule: 'AI 产品助理生成原型，设计师/产品经理调整。',
      aiCapability: '生成原型页面、交互说明、页面流程。',
      admission: 'PRD 已产出。',
      deliverables: 'UI 交互原型',
      command: '/proto-make',
    },
    {
      name: STAGE_NAMES.PRODUCT_PROTO_REVIEW,
      description: '产品经理对 AI 生成的原型进行交互复核，检查交互一致性与需求覆盖度；不通过则返回 PRD 初稿生成节点修订。',
      input: 'UI 交互原型 + 结构化 PRD。',
      processing: '产品经理自主复核原型交互一致性与需求覆盖度，决定进入需求评审或返回修订 PRD。',
      responsibleRule: '产品经理负责原型交互复核。',
      admission: '原型已生成。',
      deliverables: '复核结论：通过 / 不通过',
      command: '/proto-make',
    },
    {
      name: STAGE_NAMES.PRODUCT_FINAL_REVIEW,
      description: '需求评审结束点：产品经理对 PRD/原型进行最终确认，通过后流程结束，可一键启动 AI 开发；不通过则返回 PRD 初稿生成节点修订。',
      input: '通过复核的 PRD + 原型。',
      processing: '产品经理组织相关方进行最终需求评审并决策，通过即定稿。',
      responsibleRule: '产品经理组织相关方评审并决策。',
      admission: 'PRD 已产出并经过原型交互复核通过。',
      deliverables: '需求定稿、开发排期输入',
    },
  ],
  responsibleRules: [
    '产品经理：方案自主复核、原型交互复核、需求评审',
    'AI 产品助理：需求头脑风暴、方案调研、草案输出、PRD 生成、原型生成',
    '设计师（可选）：原型视觉与交互调整',
  ],
  aiCapabilities: [
    'AI 产品助理：需求头脑风暴与要点结构化',
    'AI 产品助理：方案调研、选型对比与草案输出',
    'AI 产品助理：自动生成结构化 PRD',
    'AI 产品助理：根据 PRD 生成可交互原型',
  ],
  admissions: [
    '业务方或用户已提出原始需求',
    '方案自主复核通过',
    'PRD 已产出（完整链路需原型交互复核通过）',
  ],
  deliverables: [
    '结构化需求要点',
    '业务方案与备选方案对比',
    '初步业务方案',
    '结构化 PRD',
    'UI 交互原型（可选）',
    '需求定稿（通过即可一键启动 AI 开发）',
  ],
};

// ── 模板索引 ──

const TEMPLATES: Record<TemplateType, FlowTemplate> = {
  ai_dev: AI_DEV_TEMPLATE,
  auto_test: AUTO_TEST_TEMPLATE,
  product: PRODUCT_TEMPLATE,
};

const TEMPLATE_ORDER: TemplateType[] = ['product', 'ai_dev', 'auto_test'];

const TEMPLATE_TAB_LABELS: Record<TemplateType, string> = {
  ai_dev: '研发流程',
  auto_test: '测试流程',
  product: '产品流程',
};

// ── 子组件 ──

function InfoCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <Card className="border border-border/50 soft-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TemplateOverview({ template }: { template: FlowTemplate }) {
  return (
    <Card className="border border-border/50 soft-shadow mb-6">
      <CardHeader>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary">{template.type === 'ai_dev' ? 'AI 开发' : template.type === 'auto_test' ? '智能化测试' : '产品'}</Badge>
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

function TemplateStageTable({ template }: { template: FlowTemplate }) {
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
              <TableHead className="w-48">处理</TableHead>
              <TableHead className="w-40">交付物</TableHead>
              <TableHead className="w-40">责任人规则</TableHead>
              <TableHead className="w-40">AI 分身能力</TableHead>
              <TableHead className="w-28">使用指令</TableHead>
              <TableHead className="w-40">准入条件</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {template.stages.map(stage => {
              const detail = detailMap.get(stage.name);
              if (!detail) return null;
              // 旧模板未补充 input/processing 时，用节点说明兜底，避免表格空白。
              const inputText = detail.input || detail.description;
              const processingText = detail.processing || detail.description;
              return (
                <TableRow key={stage.name} id={`stage-row-${template.id}-${stage.name}`}>
                  <TableCell className="font-medium">{stage.label}</TableCell>
                  <TableCell>{inputText}</TableCell>
                  <TableCell>{processingText}</TableCell>
                  <TableCell>{detail.deliverables}</TableCell>
                  <TableCell>{detail.responsibleRule}</TableCell>
                  <TableCell>{detail.aiCapability ?? '-'}</TableCell>
                  <TableCell>{detail.command ?? '-'}</TableCell>
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

function TemplateDetail({ template }: { template: FlowTemplate }) {
  const handleStageClick = (name: string) => {
    const element = document.getElementById(`stage-row-${template.id}-${name}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6">
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
      <TemplateStageTable template={template} />
    </div>
  );
}

// ── 页面组件 ──

export const FlowTemplateMarketContent: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<TemplateType>('product');

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TemplateType)} className="w-full">
      <TabsList className="mb-4">
        {TEMPLATE_ORDER.map(type => (
          <TabsTrigger key={type} value={type}>
            {TEMPLATE_TAB_LABELS[type]}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* 仅渲染当前激活的 Tab，避免非激活流程图在隐藏容器内初始化导致渲染异常。 */}
      <TabsContent value={activeTab}>
        <TemplateDetail template={TEMPLATES[activeTab]} />
      </TabsContent>
    </Tabs>
  );
};

export const FlowTemplateMarket: React.FC = () => {
  return (
    <div className="flex-1 max-w-7xl mx-auto w-full pb-12 space-y-6">
      <div className="border-b border-border/50 pb-4">
        <h2 className="text-2xl font-bold tracking-tight">流程模板市场</h2>
        <p className="text-muted-foreground mt-1">
          标准流水线知识库：浏览平台预置的智能化需求产品 / 研发 / 测试流程模板，无需发起任务即可查看完整链路与节点说明。
        </p>
      </div>
      <FlowTemplateMarketContent />
    </div>
  );
};
