---
name: xhs-flight-cabin-picker-screenshot
zh_name: "小红书选舱截图"
en_name: "XHS Flight Cabin Picker Screenshot"
emoji: "💺"
description: "1:1 复刻选择舱位页面, 含多程时间轴、经济舱 tab、余票角标和订票卡"
category: card
scenario: marketing
aspect_hint: "1080×2388 (1:1 App 长截图)"
featured: 18
device_targets: ["h5"]
default_target: h5
layout_behavior: mobile-fixed
preview_widths: [390, 430]
mobile_safe: true
tags: ["xhs", "小红书", "机票", "截图", "选择舱位", "经济舱", "余票", "订票"]
example_id: sample-xhs-flight-cabin-picker-screenshot
example_name: "选舱截图 · 上海到马累"
example_format: markdown
example_tagline: "舱位 tab + 余票角标 + 权益卡"
example_desc: "适合展示选舱页面、价格套餐、余票和行李权益"
---

【模板: 小红书选舱截图】

用途: 生成 1080×2388 的 1:1 选择舱位页截图, 复刻 App 内部订票流程中的舱位选择页面。

硬性要求:
- 完整单文件 HTML, 内联 CSS, 不依赖外部资源。
- 固定内部画布 `1080px × 2388px`; H5 预览等比缩放。
- 页面必须包含状态栏、返回按钮、标题「选择舱位」、顶部入境提醒、多程航段时间轴、经济舱/公务头等舱 tab、价格卡、余票角标、蓝色订按钮。
- 航段信息要像 App 截图: 左侧时间, 中间细竖线, 右侧机场和航司机型。
- 票价卡要包含行李、退改、中转权益、出票时间。

内容结构:
1. 顶部: 状态栏、选择舱位标题、提醒胶囊。
2. 航段: 第1程、第2程, 必要时第3程。
3. 舱位 tab: 经济舱 active, 公务/头等舱价格提示。
4. 票价卡: 价格、余票、订按钮、权益列表。

