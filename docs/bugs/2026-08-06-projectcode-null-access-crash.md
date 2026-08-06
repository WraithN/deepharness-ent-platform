# ProjectCode 组件 null 属性访问崩溃

## 现象

当用户在个人工作台切换到"工程代码"Tab 时，`ProjectCode` 组件崩溃，报错：
```
Cannot read properties of null (reading 'length')
    at ProjectCode (ProjectCode.tsx:2316:48)
```

同时后端 branches API 返回 500 错误，导致 `repoDetails` 中的数组字段为 `null`。

## 根因

Go 后端在序列化 nil slice 时输出 `null`（而非 `[]`），前端 TypeScript 类型定义中这些字段为非可选数组（如 `languageStats: LanguageStatDTO[]`），导致组件直接访问 `.length` 时未做空值保护。

涉及字段：
- `RepositoryDetailsDTO.languageStats` - 语言统计数组
- `RepositoryDetailsDTO.committerStats` - 贡献者统计数组
- `RepositoryDetailsDTO.weeklyCommits` - 每周提交数组
- `RepositoryDetailsDTO.commitStats` - 提交统计结构体

当后端 branches API 返回 500 时，`repoDetails` 虽然非 null，但内部数组字段为 `null`。

## 解决方案

1. **DTO 类型安全**：将 `RepositoryDetailsDTO` 中的数组字段改为可选 `| null`：
   - `branches?: BranchInfoDTO[] | null`
   - `committerStats?: CommitterStatDTO[] | null`
   - `weeklyCommits?: DailyCommitDTO[] | null`
   - `languageStats?: LanguageStatDTO[] | null`
   - `commitStats?: CommitStatsDTO | null`

2. **组件空值保护**：`ProjectCode.tsx` 中所有访问点添加 `?.` 和 `?? []` / `?? 0`：
   - `repoDetails.languageStats?.length ?? 0`
   - `(repoDetails.languageStats ?? []).slice(0, 4)`
   - `repoDetails.commitStats?.totalCommits ?? 0`
   - 同理处理 `committerStats`、`weeklyCommits`

## 验证

- `tsc --noEmit` 0 errors
- `pnpm build` 通过
- 开发环境重启成功，前端 200、后端 healthy
