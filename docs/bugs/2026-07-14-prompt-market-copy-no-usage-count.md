# 提示词市场复制不计数 & 复制按钮无防抖

## 现象

提示词市场卡片的「复制」按钮仅将内容写入剪贴板，市场提示词的使用次数（usage_count）不会增加；且按钮无任何防抖，用户可连续点击。

## 根因

`PromptMarket.tsx` 的 `handleCopy` 只调用 `navigator.clipboard.writeText`，前端没有对应的计数上报接口，后端 `team_prompts.usage_count` 也从未被任何链路更新（此前仅实现了「加入空间」和「会话使用」两条计数链路，复制到剪贴板这条链路缺失）。

## 解决方案

1. **新增计数接口**：`POST /api/v1/team/prompts/{id}/use`（`middleware.Auth`），由 `TeamService.RecordPromptUsage` 实现。
2. **按天去重**：新增 `team_prompt_usage_daily` 去重表（主键 `prompt_id + user_id + usage_date`），事务内先 `INSERT ... ON CONFLICT DO NOTHING`，仅插入成功（当日首次）才递增 `usage_count`。
   - 去重维度采用**登录用户 ID + 天**而非 User-Agent：市场接口均需登录，用户 ID 不可伪造，且同一用户跨浏览器复制同一提示词也应视为同一次使用，比 UA 更合理。
3. **前端 5 秒防抖**：复制按钮点击后进入 5 秒冷却（`copyCooldownUntil` 按提示词 ID 记录截止时刻），冷却期按钮禁用，冷却结束自动恢复；上报为 fire-and-forget，失败不影响复制动作，成功后用返回值刷新卡片计数。
4. 复制按钮回调签名由 `handleCopy(content)` 改为 `handleCopy(prompt)`，以便拿到提示词 ID 上报。

## 验证结果

- curl：同一用户连点 3 次仅 +1（去重表仅 1 行）；换用户再 +1；同用户当日再次点击不再计数；未登录 401。
- Playwright e2e：点击复制触发 1 次 use 上报，按钮立即禁用，冷却中再点无新上报，5 秒后按钮自动恢复。
