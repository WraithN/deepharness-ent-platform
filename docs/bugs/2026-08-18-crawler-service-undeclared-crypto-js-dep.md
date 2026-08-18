# crawler-service: crawl-with-token.ts 引入未声明依赖 crypto-js（pnpm 严格模式暴露）

## 现象
执行 Task 1（抽取 `mergePage*` 纯函数到 `services/merge.ts`）时，按 brief Step 3 运行 `pnpm --filter @repo/crawler-service install` 安装 vitest 后，`pnpm --filter @repo/crawler-service check-types` 报错：

```
src/crawl-with-token.ts(13,22): error TS2307: Cannot find module 'crypto-js' or its corresponding type declarations.
```

`check-types` 在安装前曾通过（exit 0），安装后失败。`crawl-with-token.ts` 是 Task 1 未触及的独立 CLI 脚本（`npx tsx src/crawl-with-token.ts <accessToken>`），并非被 refactor 的文件。

## 根因
`apps/crawler-service/src/crawl-with-token.ts:13` 直接 `import CryptoJS from "crypto-js"`，但 `apps/crawler-service/package.json` 的 `dependencies`/`devDependencies` 中**从未声明 `crypto-js` 或 `@types/crypto-js`**（grep 计数为 0）。这是一处长期存在的"未声明运行时依赖"缺陷。

此前 `check-types` 之所以"通过"，是因为 `apps/crawler-service/` 目录下存在一个 **gitignored 的 npm 风格 `package-lock.json`**（仓库根 `.gitignore` 含 `package-lock.json` 规则，该文件未被 git 跟踪）。该 lockfile 是历史上有人在本机误用 `npm install` 产生的，npm 默认将依赖**扁平化提升（flat hoisting）**到 `node_modules` 顶层，使 `crypto-js`（作为某传递依赖被装入 `.pnpm` store）恰好能被 tsc 解析，从而掩盖了未声明依赖。

仓库根使用 pnpm workspace（`pnpm-workspace.yaml` 包含 `apps/*`，根 `packageManager: pnpm@9.15.5`）。Task 1 Step 3 要求 `pnpm --filter @repo/crawler-service install`，pnpm 以**严格（非扁平）**方式重建 `node_modules`，未声明的 `crypto-js` 不再被提升到 `crawler-service` 的 `node_modules`，tsc 模块解析失败，TS2307 报错，缺陷暴露。

验证：`git stash` 暂存 Task 1 全部改动后，对 baseline 源码运行 `pnpm --filter @repo/crawler-service check-types`，在当前 pnpm `node_modules` 下**同样报 TS2307**，确认缺陷为预先存在、与本次 refactor 无关，仅由 pnpm 严格安装触发。

## 解决方案
在 `apps/crawler-service/package.json` 中正式声明该依赖（治本，非掩盖）：
- `dependencies` 增加 `"crypto-js": "^4.2.0"`（`crawl-with-token.ts` 运行时真实使用）。
- `devDependencies` 增加 `"@types/crypto-js": "^4.2.2"`（`crypto-js@4.2.0` 自身不带 `.d.ts`，需独立类型包供 tsc 解析）。

`pnpm add crypto-js@^4.2.0` 与 `pnpm add -D @types/crypto-js@^4.2.2` 安装成功。

### 验证结果
- `pnpm --filter @repo/crawler-service check-types`：0 errors（exit 0）。
- `pnpm --filter @repo/crawler-service lint`（biome check src）：0 warnings（exit 0）。
- `pnpm --filter @repo/crawler-service test`（vitest）：5/5 通过。
- `pnpm --filter @repo/crawler-service build`（tsc）：成功，`dist/services/merge.js`、`dist/routes/scrape.js` 正常产出。
- 8091 端口已有 crawler-service 实例运行，`curl http://localhost:8091/health` 返回 `{"status":"ok"}`。

### 影响文件
- `apps/crawler-service/package.json` - 声明 `crypto-js` 运行时依赖与 `@types/crypto-js` 开发依赖。

### 说明
此修复为 Task 1（merge 函数抽取）的**附带修复**：Task 1 本身只动 `merge.ts`/`merge.test.ts`/`scrape.ts`/`package.json`（加 vitest），但 brief Step 3 强制要求 `pnpm install`，该安装步骤暴露了本缺陷并阻塞 Step 7（check-types 必须 0 errors）。经用户确认选择"添加 crypto-js 到 deps"方案后修复。
