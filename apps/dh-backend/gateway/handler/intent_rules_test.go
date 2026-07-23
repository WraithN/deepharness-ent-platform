package handler

import "testing"

// TestRuleBasedClassify 验证规则层置信度打分 + 上下文降级的关键行为。
// 测试运行于包目录，config/intent_rules.yaml 不可达，自动回退到内嵌默认配置。
func TestRuleBasedClassify(t *testing.T) {
	cases := []struct {
		name  string
		input string
		// wantCmd 为空表示期望返回 nil（交给 LLM）。
		wantCmd string
	}{
		// 强信号单独命中 -> 直接判任务。
		{"strong 写代码", "帮我写代码实现登录", "/code"},
		{"strong 做原型", "做原型", "/proto-make"},
		{"strong 代码审查", "代码审查", "/review"},
		{"strong 写需求", "帮我写需求", "/prd-write"},

		// 两个弱信号叠加达阈值 -> 判任务。
		{"weak+weak 修复bug", "修复这个bug", "/debug"},          // 修复(1)+bug(1)=2
		{"weak+weak 开发实现", "开发并实现登录功能", "/code"}, // 开发(1)+实现(1)=2

		// 单个弱信号未达阈值 -> 交给 LLM（修复误判）。
		{"weak-only 开发", "我想了解开发流程", ""}, // 注意：含「了解」也会被降级
		{"weak-only bug", "有个bug", ""},
		{"weak-only 问题", "问题不大，先这样", ""},
		{"weak-only review", "review一下", ""},
		{"weak-only 原型", "原型", ""},

		// 上下文降级：疑问/探讨/否定词命中 -> 即使强信号也交给 LLM。
		{"downgrade 怎么review", "怎么review别人的代码", ""},
		{"downgrade 了解一下", "了解一下开发", ""},
		{"downgrade 不要写代码", "不要写代码", ""},
		{"downgrade 如何实现", "如何实现登录", ""},

		// 空输入。
		{"empty", "", ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ruleBasedClassify(c.input)
			if c.wantCmd == "" {
				if got != nil {
					t.Fatalf("input=%q: expect nil (->LLM), got command %s", c.input, got.Command)
				}
				return
			}
			if got == nil {
				t.Fatalf("input=%q: expect command %s, got nil", c.input, c.wantCmd)
			}
			if got.Command != c.wantCmd {
				t.Fatalf("input=%q: expect command %s, got %s", c.input, c.wantCmd, got.Command)
			}
		})
	}
}
