import { Skill, Prompt, Requirement, DashboardStats, User, SettingsConfig } from '../types';

export const mockCurrentUser: User = {
  id: 'u1',
  name: '开发者小明',
  role: 'admin',
  joinedAt: '2023-01-01',
};

export const mockUsers: User[] = [
  mockCurrentUser,
  { id: 'u2', name: '产品小红', role: 'pm', joinedAt: '2023-02-15' },
  { id: 'u3', name: '设计小李', role: 'designer', joinedAt: '2023-03-10' },
  { id: 'u4', name: '测试小刚', role: 'tester', joinedAt: '2023-04-20' },
];

export const mockSkills: Skill[] = [
  { id: 's1', name: '代码补全专家', description: '智能上下文代码补全', category: '编码开发', tags: ['代码', '效率'], downloads: 12500, rating: 4.8, installed: true },
  { id: 's2', name: '代码重构助手', description: '自动识别坏味道并重构', category: '代码审查', tags: ['重构', '质量'], downloads: 8300, rating: 4.6, installed: true },
  { id: 's3', name: 'UI转代码', description: '上传设计稿自动生成前端代码', category: 'UI设计', tags: ['UI', '前端'], downloads: 21000, rating: 4.9, installed: false },
  { id: 's4', name: 'API测试生成器', description: '根据接口文档生成测试用例', category: '测试验证', tags: ['测试', 'API'], downloads: 5400, rating: 4.5, installed: false },
  { id: 's5', name: 'PRD生成专家', description: '根据需求描述生成结构化PRD文档', category: '需求设计', tags: ['PRD', '文档'], downloads: 9800, rating: 4.7, installed: false },
  { id: 's6', name: '数据库优化助手', description: '分析SQL性能并提供优化建议', category: '架构方案', tags: ['数据库', '性能'], downloads: 7200, rating: 4.4, installed: false },
  { id: 's7', name: 'Jest自动化测试', description: '为前端代码生成Jest单元测试', category: '测试验证', tags: ['Jest', '前端测试'], downloads: 11000, rating: 4.6, installed: false },
  { id: 's8', name: '预发布巡检助手', description: '在发布前自动检查常见风险点', category: '预发布验证', tags: ['发布', '检查'], downloads: 4500, rating: 4.3, installed: false },
];

export const mockPrompts: Prompt[] = [
  { id: 'p1', name: '生成React组件', description: '提供组件描述，生成带TypeScript和Tailwind的React组件', useCase: '前端开发', usageCount: 45000, addedToSpace: true },
  { id: 'p2', name: '解释复杂代码', description: '将复杂的代码段转换为易懂的自然语言解释', useCase: '代码阅读', usageCount: 32000, addedToSpace: true },
  { id: 'p3', name: '生成SQL表结构', description: '根据业务需求生成SQL建表语句', useCase: '后端开发', usageCount: 28000, addedToSpace: false },
  { id: 'p4', name: '编写测试用例', description: '为指定函数编写单元测试', useCase: '自动化测试', usageCount: 19000, addedToSpace: false },
];

export const mockRequirements: Requirement[] = [
  { id: 'r1', title: '实现多租户登录功能', status: 'done', assigneeId: 'u1', createdAt: '2026-05-20', meegoSyncStatus: 'synced' },
  { id: 'r2', title: '数据大盘图表展示', status: 'in-progress', assigneeId: 'u1', createdAt: '2026-05-22', meegoSyncStatus: 'synced' },
  { id: 'r3', title: 'UI设计对话助手', status: 'todo', assigneeId: 'u3', createdAt: '2026-05-25', meegoSyncStatus: 'synced' },
  { id: 'r4', title: '智能评审结果展示', status: 'backlog', assigneeId: 'u4', createdAt: '2026-05-27', meegoSyncStatus: 'pending' },
];

export const mockDashboardStats: DashboardStats = {
  codeCommits: [
    { date: '05-21', count: 12 },
    { date: '05-22', count: 18 },
    { date: '05-23', count: 15 },
    { date: '05-24', count: 25 },
    { date: '05-25', count: 22 },
    { date: '05-26', count: 30 },
    { date: '05-27', count: 28 },
  ],
  sessions: [
    { date: '05-21', count: 45 },
    { date: '05-22', count: 52 },
    { date: '05-23', count: 48 },
    { date: '05-24', count: 65 },
    { date: '05-25', count: 70 },
    { date: '05-26', count: 68 },
    { date: '05-27', count: 85 },
  ],
  requirementsCompleted: [
    { date: '05-21', count: 2 },
    { date: '05-22', count: 1 },
    { date: '05-23', count: 3 },
    { date: '05-24', count: 0 },
    { date: '05-25', count: 4 },
    { date: '05-26', count: 2 },
    { date: '05-27', count: 5 },
  ],
};

export const mockSettings: SettingsConfig = {
  meegoProject: 'proj_aicoding_platform',
  gitlabUrl: 'https://gitlab.example.com/aicoding',
  codingStandard: '# 编码规范\n\n1. 使用 TypeScript 编写所有新代码\n2. 组件必须使用 React Functional Component 格式\n3. 样式一律使用 Tailwind CSS\n',
  designStandard: '# 设计规范\n\n1. 主色调: #2F54EB (极客蓝)\n2. 背景色: #F7F9FC\n3. 卡片圆角: 2px\n',
  agentConfig: {
    agentName: 'opencode',
    modelSource: 'builtin',
    model: 'gpt-4o',
    temperature: 0.7,
    baseUrl: '',
    apiKey: '',
  },
};
