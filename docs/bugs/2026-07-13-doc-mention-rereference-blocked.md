# 引用文档删除后无法再次引用

## 现象

Chat 输入框中通过 @ 或「文档」按钮引用文档后，将 `@文档名` 提及块整体删除，再次引用同一文档时 toast 提示「该文档已引用」，无法重新插入。

## 根因

`handleSelectDoc` 的重复判定同时检查两个条件：`referencedDocs.some(d => d.docId === doc.id)`（引用记录列表）与 `input.includes(token)`（输入框中的提及块）。原子删除只移除了输入框中的文本，未同步清理 `referencedDocs` 中的记录，导致 docId 判定永远命中，文档被永久锁定为「已引用」。

## 解决方案

1. **重复判定单一事实来源**：仅保留 `input.includes(docMentionToken(doc.title))` 判定——只要输入框中不存在该提及块就允许引用；同一文档重新引用时用 `prev.filter(d => d.docId !== doc.id)` 替换旧记录，避免列表重复。
2. **删除时同步清理**：原子删除（Backspace/Delete 整块移除）后，按新输入内容过滤 `referencedDocs`，移除提及块已不存在的记录。

验证结果：e2e 测试通过——引用 `@测试文档` → 整体删除 → 再次引用成功，无「已引用」误报，发送时路径清单正确。同时附带完成 @提及 高亮+阴影展示（textarea 文字透明 + 同字体叠层渲染 `bg-primary/10 text-primary` + primary 色阴影片段，滚动同步）。
