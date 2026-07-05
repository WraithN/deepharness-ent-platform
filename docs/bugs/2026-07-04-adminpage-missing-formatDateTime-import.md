# AdminPage 编译错误：缺少 formatDateTime 导入

## 现象

前端 `pnpm lint` / `tsc --noEmit` 报错：

```
src/pages/AdminPage.tsx(240,35): error TS2304: Cannot find name 'formatDateTime'.
```

导致 `pnpm build` 无法通过，空间管理页面无法上线。

## 根因

在将超级管理员「空间管理」从 mock 数据切换到真实 API 时，页面移除了旧的 mock 字段与相关工具函数引用，但表格中仍保留了一处 `formatDateTime(row.createdAt)` 的调用。`formatDateTime` 既未在文件内定义，也未被导入，因此 TypeScript 编译失败。

## 解决方案

1. 在 `apps/dh-frontend/src/pages/AdminPage.tsx` 中补充导入：
   ```ts
   import { formatDateTime } from '@/lib/utils';
   ```
2. 同步更新文件顶部的注释，说明空间管理已对接真实 API。
3. 重新执行验证：
   - `pnpm check-types` 通过
   - `pnpm lint` 通过
   - `pnpm build` 通过
   - 后端接口权限校验正常：未认证 401、普通用户 403、超级管理员可 CRUD

