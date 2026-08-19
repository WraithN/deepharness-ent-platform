package handler

// embeddedIntentRules 是内嵌的默认意图识别规则配置。
// 当外部 config/intent_rules.yaml 不存在或解析失败时使用此配置作为回退。
// 修改规则配置时请编辑 config/intent_rules.yaml 文件。
var embeddedIntentRules = IntentRulesConfig{
	Threshold: defaultIntentThreshold,
	Rules: []IntentRule{
		{Cmd: "/prd-write", Strong: []string{"写需求", "需求文档", "写prd"}, Weak: []string{"prd", "产品需求"}},
		{Cmd: "/prd-research", Strong: []string{"产品调研", "网站调研", "竞品调研", "爬虫调研"}, Weak: []string{"调研", "产品分析", "网站分析"}},
		{Cmd: "/prd-analysis", Strong: []string{"竞品信息分析", "网站信息对照", "多站信息提取"}, Weak: []string{"信息分析", "对照表格", "多网站"}},
		{Cmd: "/proto-make", Strong: []string{"做原型", "可运行原型", "ui原型", "生成原型"}, Weak: []string{"原型"}},
		{Cmd: "/code", Strong: []string{"写代码", "编写代码", "创建工程"}, Weak: []string{"开发", "实现", "写个", "做一个", "写页面", "做个系统", "做个网站", "写功能"}},
		{Cmd: "/debug", Strong: []string{"修bug", "解bug", "修复bug", "修复缺陷"}, Weak: []string{"bug", "缺陷", "报错", "错误", "问题", "调试", "修复"}},
		{Cmd: "/review", Strong: []string{"代码审查", "codereview", "代码review", "review代码"}, Weak: []string{"review", "审查", "评审"}},
	},
	DowngradeWords: []string{"怎么", "如何", "什么是", "介绍一下", "了解一下", "请问", "区别", "原理", "不要", "先别"},
}
