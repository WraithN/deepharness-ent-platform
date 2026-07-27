# 原型产品分享独立页面

## 现象

原型分享原先仅生成 `/personal-space?tab=prototype&prototype=<itemId>` 深链，跳转到产品空间管理界面（需登录），无法作为独立页面分享给外部评审人员。缺少一个免登录、左文件列表右 HTML 详情、展示批注数字标记并可最大化的独立预览页。

## 根因

1. **后端无原型分享 token 机制**：productdoc 模块有 `product_doc_shares` 表与公开接口，但 productspace 模块没有对应的分享 token 表与免登录接口，原型 serve / 批注查询均需 PM 鉴权。
2. **前端无独立分享页**：分享链接指向产品空间管理界面（需登录 + PM 权限），外部人员无法访问。
3. **批注标记不可点击**：注入的标注脚本中 marker 元素 `pointerEvents: 'none'`，仅用于编辑模式下的视觉回显，无法在分享页点击查看批注详情。

## 解决方案

### 后端

1. **新增分享表** `product_prototype_shares`（`infra/database/productdoc/migration-20260724-proto-shares.sql`），按 workspace+user+product_folder 幂等创建 token。

2. **Service 层**（`db_service.go`）新增 4 个方法：
   - `CreatePrototypeShare`：PM 校验 + sanitizeName 清洗产品目录名 + 幂等查询 + base62 token 生成 + 插入。
   - `GetSharedPrototype`：按 token 解析 workspace/user/productFolder，查询该产品目录下全部原型页面（LIKE `prototypes/{folder}/%`）。
   - `ServeSharedFile`：按 token 校验后 serve 文件，限制 relativePath 必须位于 `prototypes/{productFolder}/` 下，防越权。
   - `ListSharedComments`：按 token 校验 itemID 属于被分享产品目录后查询批注。

3. **Handler 层**（`handler.go`）新增 4 个接口，路由注册于 `server.go`：
   - `POST /api/v1/workspaces/{id}/product-space/share`（需 PM 鉴权）
   - `GET /api/v1/prototype-shares/{token}`（公开）
   - `GET /api/v1/prototype-shares/{token}/files/{path...}`（公开，HTML 注入批注脚本）
   - `GET /api/v1/prototype-shares/{token}/pages/{itemId}/comments`（公开）
   - 使用独立前缀 `prototype-shares` 避免与 `/api/v1/shares/{token}` 路由冲突。

4. **标注脚本增强**（`handler.go` `prototypeAnnotationScript`）：新增 `markerClickable` 模式，启用后 marker 设置 `pointerEvents: auto` + `cursor: pointer` + 点击回传 `dh-marker-click` 消息（含 comment id）。通过 `dh-set-marker-clickable` 消息切换，不影响编辑器原有行为。

### 前端

1. **API 封装**（`productspace-api.ts`）：新增 `prototypeShareApi`（getView / listComments / serveUrl）与 `productSpaceApi.createPrototypeShare`，以及 `PrototypeShare` / `SharedPrototypeView` / `SharedPrototypePage` 类型。

2. **独立页面** `SharePrototype.tsx`（路由 `/share/prototype/:token`，免登录）：
   - 左侧文件列表：该产品下全部原型页面，点击切换。
   - 右侧 iframe：通过公开 serve URL 加载 HTML，onLoad 后 postMessage 启用可点击标记 + 渲染批注数字标记。
   - 点击数字标记：iframe 回传 `dh-marker-click`，父页面高亮右侧批注列表对应项。
   - 批注列表：按添加顺序编号（红色圆形徽标），点击列表项 postMessage `dh-focus-marker` 定位画布标记。
   - 最大化按钮：Fullscreen API 全屏/还原。

3. **分享入口改造**（`PrototypeWorkspace.tsx`）：`handleShare` 改为调用 `createPrototypeShare(workspaceId, product.name)` 生成 token，链接改为 `${origin}/share/prototype/${token}`；按钮 disabled 条件从 `!page` 改为 `!product`（分享整个产品）。

### 验证

- `go build ./...` + `go vet ./...`：0 warnings
- `tsc --noEmit` + `biome lint`：0 errors
- `pnpm build`：成功
- curl 端到端测试：登录 PM → 创建分享 token → 公开访问 view（返回 2 页面）/ comments（空数组）/ serve HTML（含批注脚本注入，5 处匹配）→ 无效 token 返回 404
- 前端 `/share/prototype/:token` 路由返回 200
