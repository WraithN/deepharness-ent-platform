# crawler-service: mergePageMarkdown 对空内容页仍输出 URL 标题（噪音）

## 现象
Task 1（抽取 `mergePage*` 纯函数到 `services/merge.ts`）按 brief Step 1 编写单元测试后，brief Step 4 给出的"原样搬入"实现无法通过其中一条测试：

```ts
it("多页用 PAGE_SEPARATOR 连接，空页被过滤", () => {
  const out = mergePageMarkdown([
    page({ url: "u1", markdown: "m1" }),
    page({ url: "u2", markdown: "", text: "" }),
  ]);
  expect(out).toContain("m1");
  expect(out).not.toContain("u2");  // 失败：实际输出包含 "## u2"
});
```

`page({ url: "u2", markdown: "", text: "" })`（markdown 与 text 均空）经原实现处理后输出 `## u2\n\n`（仅标题、无正文），`"## u2".trim().length > 0` 为真，未被 `.filter` 过滤，导致合并结果包含 `"u2"`，与测试断言 `not.toContain("u2")` 冲突。

## 根因
原 `mergePageMarkdown`（`routes/scrape.ts`）的实现先拼装 `## ${p.url}\n\n${body}` 再按"整段 trim 后非空"过滤：

```ts
const body = p.markdown || p.text;
return `## ${p.url}\n\n${body}`;
// ...
.filter((s) => s.trim().length > 0)
```

当 `body` 为空字符串时，整段为 `## ${url}\n\n`，trim 后为 `## ${url}`（非空），因此**仅标题、无正文的空页被保留**，输出中出现无内容的 URL 标题噪音。`.filter` 的过滤粒度是"整段"，无法识别"标题非空但正文为空"的情况。

下游消费者（LLM agent 阅读合并后的 markdown）会看到一堆无内容的 `## url` 标题，造成误导。

## 解决方案
在拼装前先判断 `body` 是否为空，body 为空时直接返回空串（整页跳过，含 URL 标题），使后续 `.filter` 能将其过滤掉：

```ts
export function mergePageMarkdown(pages: PageResult[]): string {
  return pages
    .map((p) => {
      // markdown 兜底提取可能为空（SPA 无 h1/p/li），此时回退到 innerText。
      const body = p.markdown || p.text;
      // body 为空时整页跳过（含 URL 标题），避免输出仅有标题的空页。
      return body.trim().length > 0 ? `## ${p.url}\n\n${body}` : "";
    })
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}
```

其余 4 个函数（`mergePageText`/`mergePageHtml`/`mergePageCleanedHtml`/`dedupe`）严格按 brief Step 4 原样搬入，未改动。

### 偏离 brief 说明
brief Step 4 的示例代码为"原样搬入"的最小骨架，未含此空 body 判断；brief Step 6 期望"5 个测试通过"。两者存在冲突：示例代码无法通过 Step 1 的测试。遵循 TDD（测试即规格）与 Step 6 的明确期望，对 `mergePageMarkdown` 做最小改动以满足测试，并保留原有中文注释（规则5：容错处理必须注释）。

### 验证结果
- `pnpm --filter @repo/crawler-service test`（vitest）：5/5 通过（含"空页被过滤"用例）。
- `pnpm --filter @repo/crawler-service check-types`：0 errors。
- `pnpm --filter @repo/crawler-service lint`：0 warnings。
- `pnpm --filter @repo/crawler-service build`：成功。

### 影响文件
- `apps/crawler-service/src/services/merge.ts` - `mergePageMarkdown` 增加 body 空值判断（其余函数原样搬入）。
