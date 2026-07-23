---
name: xhs-flight-search-results-screenshot
zh_name: "小红书机票搜索结果截图"
en_name: "XHS Flight Search Results Screenshot"
emoji: "🔎"
description: "1:1 复刻深蓝机票搜索结果页, 含搜索框、筛选 chips、航司卡片和底部 tab"
category: card
scenario: analysis
aspect_hint: "1080×2388 (1:1 App 长截图)"
featured: 19
device_targets: ["h5"]
default_target: h5
layout_behavior: mobile-fixed
preview_widths: [390, 430]
mobile_safe: true
tags: ["xhs", "小红书", "机票", "搜索结果", "截图", "深蓝", "筛选", "航司卡片"]
example_id: sample-xhs-flight-search-results-screenshot
example_name: "搜索结果截图 · 首尔法兰克福"
example_format: markdown
example_tagline: "深蓝 header + 结果卡列表"
example_desc: "适合展示多条搜索结果、最低价筛选和航司卡列表"
---

【模板: 小红书机票搜索结果截图】

用途: 生成 1080×2388 的 1:1 搜索结果页截图, 复刻海外机票 App 深蓝结果列表页面。

硬性要求:
- 完整单文件 HTML, 内联 CSS, 不依赖外部资源。
- 固定内部画布 `1080px × 2388px`; H5 预览等比缩放。
- 顶部必须是深蓝 header, 包含状态栏、白色搜索框、日期、通知图标。
- 主体为浅灰蓝背景, 包含结果数量、筛选 chips、3-5 张白色结果卡、底部 tab bar。
- 结果卡必须包含航司、分享/收藏图标、去返程时间、机场代码、转机次数、时长、价格。

内容结构:
1. 顶部搜索: 出发/到达机场、日期。
2. 筛选: 最佳、最低价、最快、直飞。
3. 结果卡: 航司、去程、返程、转机、价格。
4. 底部导航: 探索、Drops、心愿单、我的资料。

