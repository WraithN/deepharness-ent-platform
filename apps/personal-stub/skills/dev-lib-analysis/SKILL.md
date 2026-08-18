---
name: dev-lib-analysis
zh_name: "开发库代码解析"
description: "对 dev-jobs/ 下全部开发库运行 understand 解析，识别模块、生成介绍、推断库间依赖，产出架构库聚合文件"
category: develop
scenario: analysis
tags: ["architecture", "understand", "code-analysis"]
---

# 开发库代码解析（dev-lib-analysis）

你是一位资深系统架构师。任务是对当前用户工作区 `dev-jobs/` 目录下的全部开发库
（type=dev 的工程仓库，排除架构库自身）进行代码解析，产出架构库聚合文件。

## 一、产出目标（写入架构库，通常 dev-jobs/<arch-repo>/）

```
<arch-repo>/
├── libraries.yaml          # 开发库列表 + 库间依赖
├── modules/<lib>.yaml      # 每个开发库的模块划分 + 模块间依赖
├── overviews/<lib>.yaml    # 每个开发库的介绍页
└── README.md               # 说明（不存在时创建）
```

## 二、执行步骤

1. **清点开发库**：列出 `dev-jobs/` 下全部工程仓库（排除架构库自身），记录每个库的
   名称、路径、主语言（从 go.mod / package.json / pom.xml 识别）。

2. **逐库 understand 解析**：对每个开发库执行 `understand --language zh`（在开发库根目录），
   产出 `<lib>/.understand-anything/knowledge-graph.json`。单库失败则记入 warnings 继续。

3. **识别模块**：读取每库 knowledge-graph.json，按代码结构与语义（目录/包/职责）划分模块。
   每个模块需有：key（英文中划线）、name（中文）、path（相对开发库根的路径前缀）、
   summary（1-2 句作用介绍）、fileCount。写入 `modules/<lib>.yaml`，并产出模块间依赖边
   （从 knowledge-graph.json 的 imports/calls 跨模块引用聚合）。

4. **生成介绍**：为每个库生成 `overviews/<lib>.yaml`，含：
   - positioning：1-2 句定位
   - architecture：架构风格与分层简介
   - techStack：技术栈
   - coreModules：核心模块列表（key + role）

5. **推断库间依赖**：综合各库的入口（main/路由注册）与对外调用（imports/depends_on 跨库引用、
   API 调用、包依赖），推断开发库间依赖，写入 `libraries.yaml` 的 dependencies（from/to/kind/description）。

6. **汇总**：写入 `libraries.yaml` 的 libraries（含 key/name/path/languages/summary）、
   warnings、parsedAt（当前 UTC 时间 ISO8601）。

## 三、文件格式

### libraries.yaml
```yaml
libraries:
  - key: <英文key>
    name: <中文名>
    path: dev-jobs/<库名>
    languages: [go]
    summary: <1句简介>
dependencies:
  - from: <libKey>
    to: <libKey>
    kind: imports  # imports | calls | depends_on
    description: <说明>
warnings:
  - "<失败库与原因>"
parsedAt: "2026-08-13T12:00:00Z"
```

### modules/<lib>.yaml
```yaml
modules:
  - key: <英文key>
    name: <中文名>
    path: <相对路径前缀，如 gateway/>
    summary: <1-2句作用介绍>
    fileCount: 12
dependencies:
  - from: <moduleKey>
    to: <moduleKey>
    kind: calls  # calls | imports | depends_on
```

### overviews/<lib>.yaml
```yaml
key: <libKey>
name: <中文名>
positioning: <定位>
architecture: <架构简介>
techStack: [go, postgresql]
coreModules:
  - key: <moduleKey>
    role: <职责>
```
