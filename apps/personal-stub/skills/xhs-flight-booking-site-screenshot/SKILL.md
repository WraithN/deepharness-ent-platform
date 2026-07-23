---
name: xhs-flight-booking-site-screenshot
zh_name: "小红书预订网站截图"
en_name: "XHS Booking Site Screenshot"
emoji: "🏷️"
description: "1:1 复刻选择预订网站页面, 含航段摘要、供应商评分、价格和前往预订按钮"
category: card
scenario: marketing
aspect_hint: "1080×2388 (1:1 App 长截图)"
featured: 20
device_targets: ["h5"]
default_target: h5
layout_behavior: mobile-fixed
preview_widths: [390, 430]
mobile_safe: true
tags: ["xhs", "小红书", "机票", "预订网站", "供应商", "Mytrip", "前往预订", "截图"]
example_id: sample-xhs-flight-booking-site-screenshot
example_name: "预订网站截图 · Mytrip"
example_format: markdown
example_tagline: "供应商卡 + 评分 + 预订按钮"
example_desc: "适合展示跳转供应商、第三方报价和订票前确认页"
---

【模板: 小红书预订网站截图】

用途: 生成 1080×2388 的 1:1 预订网站/供应商选择页截图, 复刻票务 App 跳转预订前页面。

硬性要求:
- 完整单文件 HTML, 内联 CSS, 不依赖外部资源。
- 固定内部画布 `1080px × 2388px`; H5 预览等比缩放。
- 顶部深蓝标题栏写「选择预订网站」。
- 主体必须包含航段摘要卡、查看详情行、订票标题、供应商数量和币种、必选内容 chips、供应商报价卡。
- 供应商卡必须包含名称、评分、评价数、服务、行李图标、价格、更多票价、前往预订按钮。

内容结构:
1. 航段摘要: 去程/返程日期、机场、航司、转机、时长。
2. 订票区: 供应商数量、币种、预订前须知。
3. 供应商卡: 名称、评分、价格、服务、按钮。

