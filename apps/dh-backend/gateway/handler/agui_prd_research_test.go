package handler

import "testing"

// TestParsePRDResearchArgs 验证 /prd-research 指令参数解析的关键场景，
// 重点是「登录Cookie：」后换行写值的兼容（否则 cookie 解析为空导致抓取未登录页面）。
func TestParsePRDResearchArgs(t *testing.T) {
	cases := []struct {
		name        string
		args        string
		wantURL     string
		wantCookies int
	}{
		{
			name:        "同行标签格式",
			args:        "调研链接：https://example.com/x\n登录Cookie：a=1; b=2",
			wantURL:     "https://example.com/x",
			wantCookies: 2,
		},
		{
			name:        "Cookie 值换行（真实用户输入格式）",
			args:        "调研链接：https://app.apifox.com/main/teams/3883284?tab=project\n登录Cookie：\nabflag=123; Authorization=Bearer tok; userToken=",
			wantURL:     "https://app.apifox.com/main/teams/3883284?tab=project",
			wantCookies: 2, // userToken= 值为空，按 parseCookieString 规则跳过
		},
		{
			name:        "链接标签值也换行",
			args:        "调研链接：\nhttps://example.com/page\n登录Cookie：a=1",
			wantURL:     "https://example.com/page",
			wantCookies: 1,
		},
		{
			name:        "标签行后紧跟其他标签则无值",
			args:        "登录Cookie：\n调研链接：https://example.com/x",
			wantURL:     "https://example.com/x",
			wantCookies: 0,
		},
		{
			name:        "仅产品名称无链接",
			args:        "调研产品：Apifox",
			wantURL:     "",
			wantCookies: 0,
		},
		{
			name:        "裸参数格式（带 ck: 前缀）",
			args:        "https://example.com/x ck:sessionid=abc",
			wantURL:     "https://example.com/x",
			wantCookies: 1,
		},
		{
			name:        "裸参数格式（直接粘贴浏览器 cookie，无前缀）",
			args:        "https://example.com/x sessionid=abc; token=xyz; empty=",
			wantURL:     "https://example.com/x",
			wantCookies: 2, // empty= 值为空，跳过
		},
	}

	for _, tc := range cases {
		gotURL, gotCookies := parsePRDResearchArgs(tc.args)
		if gotURL != tc.wantURL {
			t.Errorf("%s: url = %q, want %q", tc.name, gotURL, tc.wantURL)
		}
		if len(gotCookies) != tc.wantCookies {
			t.Errorf("%s: cookies = %d, want %d (%v)", tc.name, len(gotCookies), tc.wantCookies, gotCookies)
		}
	}
}
