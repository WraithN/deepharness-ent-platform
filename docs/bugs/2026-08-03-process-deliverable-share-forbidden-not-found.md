# 流程交付物“查看详情”报 forbidden / not found

## 现象
在流程详情页点击交付成果的“查看详情”按钮时：
- 文档交付物（PRD 初稿）弹出提示 `forbidden`。
- 原型交付物（可运行原型）弹出提示 `not found`。
导致用户无法预览流程运行产生的实际产物。

## 根因
流程详情页原本直接复用产品空间的文档/原型分享 API，但这两个接口存在权限与路径不匹配问题：
1. 文档产物实际保存在流程所有者（工作项负责人）的个人目录下，当前调用者身份与产物所有者不一致，触发了产品空间 PM/所有者权限校验，返回 `forbidden`。
2. 原型产物位于流程运行目录（`pm-jobs/prototypes/{folder}`），并非产品空间已发布的原型条目，直接调用产品空间分享接口找不到对应记录，返回 `not found`。

因此需要一个新的后端接口：以流程所有者身份把产物先导入到产品空间，再生成需求级分享链接，前端统一调用该接口。

## 解决方案
### 后端（dh-backend）
1. 在 `domain/productspace/service/folder_service.go` 新增 `ImportProcessDeliverable` 方法：
   - 按 `workitem.AssigneeID` 确定产物所有者（ownerUserID），为空时回退到当前登录用户。
   - 文档产物：读取 `{workspaceRoot}/{ownerUserID}/{workspaceID}/{marker.path}`，写入 `products/docs/{需求标题}/{文件名}`，并创建 `product_doc_versions` 内容版本（需求级分享视图依赖该表）。
   - 原型产物：把 `pm-jobs/prototypes/{folder}` 复制到 `products/prototypes/{folder}`，仅导入 `.html` 并保留 Vite `dist/index.html` 优先规则。
   - 生成 `RequirementShare` 后返回 `token`。
2. 在 `domain/productspace/import_handler.go` 新增 `ShareProcessDeliverable` Handler：
   - 解析流程对应的工作项，获取负责人作为 ownerUserID。
   - 调用 `ImportProcessDeliverable` 并返回分享链接。
3. 在 `gateway/server/server.go` 注册新路由：
   - `POST /api/v1/processes/{id}/deliverables/share`

### 前端（dh-frontend）
1. 在 `src/lib/productspace-api.ts` 新增 `shareProcessDeliverable` 方法。
2. `ProcessDetail.tsx` 中的 `ProductDeliverableCard` 改为调用新接口，并把 `processId` 传入组件。
3. 点击“查看详情”后拿到分享 token，在新窗口打开 `/share/requirement/{token}`。

### 验证结果
- `go vet ./...` 0 警告。
- `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 0 错误。
- `pnpm build` 全部成功。
- 重启开发服务后前后端访问正常：
  - 前端 `http://localhost:8888` 返回 200。
  - 后端 `http://localhost:8080/health` 返回 200。
  - 新接口 `POST /api/v1/processes/{id}/deliverables/share` 返回 401（未登录，说明路由已注册）。
