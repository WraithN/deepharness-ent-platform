---
name: xhs-flight-screenshot-collage
zh_name: "小红书机票截图拼图"
en_name: "XHS Flight Screenshot Collage"
emoji: "🧩"
description: "1:1 复刻多城市机票截图拼图, 将 2-3 张票务页面并排对比"
category: card
scenario: analysis
aspect_hint: "1080×1440 (截图拼图)"
featured: 22
device_targets: ["h5"]
default_target: h5
layout_behavior: mobile-fixed
preview_widths: [390, 430]
mobile_safe: true
tags: ["xhs", "小红书", "机票", "截图", "拼图", "对比", "多城市", "罗马"]
example_id: sample-xhs-flight-screenshot-collage
example_name: "截图拼图 · 多城市到罗马"
example_format: markdown
example_tagline: "三列机票截图对比"
example_desc: "适合展示不同出发地、不同中转时间、同价不同方案的对比图"
---

【模板: 小红书机票截图拼图】

用途: 生成 1080×1440 的 1:1 机票截图拼图, 将 2-3 张 App 票务页面并排对比, 复刻小红书常见横向拼图参考图。

硬性要求:
- 完整单文件 HTML, 内联 CSS, 不依赖外部资源。
- 固定内部画布 `1080px × 1440px`; H5 预览等比缩放。
- 每列必须像缩小版真实票务截图: 状态栏、城市对、时间轴、灰色中转块、价格卡。
- 默认 3 列; 用户只给 2 个方案时用 2 列更宽布局。
- 不要做成普通表格; 必须有截图感边框、状态栏和页面 UI。

内容结构:
1. 拼图标题或无标题, 重点给截图本身。
2. 每列一个方案: 城市对、时间轴、中转风险、价格。
3. 可在底部加一行小结, 但不能抢截图主体。
