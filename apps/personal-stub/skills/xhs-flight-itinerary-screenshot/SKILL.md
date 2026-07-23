---
name: xhs-flight-itinerary-screenshot
zh_name: "小红书机票详情截图"
en_name: "XHS Flight Itinerary Screenshot"
emoji: "🧾"
description: "1:1 复刻携程风机票详情页长截图, 含状态栏、去返程时间轴、价格卡和订票按钮"
category: card
scenario: marketing
aspect_hint: "1080×2388 (1:1 App 长截图)"
featured: 17
recommended: 17
device_targets: ["h5"]
default_target: h5
layout_behavior: mobile-fixed
preview_widths: [390, 430]
mobile_safe: true
tags: ["xhs", "小红书", "机票", "截图", "携程", "航班详情", "时间轴", "长图"]
example_id: sample-xhs-flight-itinerary-screenshot
example_name: "机票详情截图 · 成都往返马累"
example_format: markdown
example_tagline: "携程风 1:1 长截图"
example_desc: "适合复刻航班详情页、低价线索页、联程中转截图"
---

【模板: 小红书机票详情截图】

用途: 生成 1080×2388 的 1:1 App 截图式小红书长图, 复刻携程/航旅票务详情页视觉。

硬性要求:
- 输出完整单文件 HTML, 内联 CSS, 不依赖外部图片、字体或脚本。
- 固定内部画布 `1080px × 2388px`; 外层必须支持 390px/430px H5 等比缩放预览, 不出现横向滚动。
- 视觉必须像真实手机 App 截图, 不是营销海报: 顶部状态栏、返回按钮、城市对标题、低价提醒、更多、提醒胶囊、去返程时间轴、灰色中转块、橙色风险提示、底部价格卡都要完整。
- 字体使用 Android App 感: 优先 MiSans / HarmonyOS Sans / Noto Sans SC / PingFang SC; 数字使用 Roboto / SF Pro Display / Helvetica Neue; 字重不要过粗。
- 不使用真实品牌 logo 或外部截图; 用 CSS 画出近似控件。
- 价格、航班、库存、签证规则等如果用户未提供, 必须写「示例价」「以实时查询为准」。

内容结构:
1. 状态栏与导航: 时间、电量、城市对、低价提醒、更多。
2. 顶部提醒: 过境 / 入境 / 出行提示胶囊。
3. 去程时间轴: 日期、总时长、起降机场、中转信息、行李提示。
4. 返程时间轴: 同上, 支持跨天日期。
5. 规则提醒: 入境、签证、按顺序使用提醒。
6. 价格卡: 价格、套餐、行李、退改、中转权益、出票时间、蓝色订按钮。

