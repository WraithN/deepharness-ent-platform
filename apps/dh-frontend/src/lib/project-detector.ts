/**
 * 项目类型检测工具
 *
 * 根据仓库文件树中的关键文件与依赖信息，判断当前项目是否为前端项目。
 * 检测逻辑：
 * 1. 检查根目录是否存在典型前端配置文件或入口 HTML。
 * 2. 若存在 package.json，解析其 dependencies / devDependencies，查看是否包含主流前端框架。
 * 3. 检查 src 目录下是否存在前端典型入口文件（如 main.tsx、App.vue 等）。
 */

export interface DetectableFileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  content?: string;
  children?: DetectableFileNode[];
}

// 根级前端配置文件/入口文件
const FRONTEND_ROOT_FILES = [
  'index.html',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'nuxt.config.ts',
  'nuxt.config.js',
  'vue.config.js',
  'vue.config.ts',
  'angular.json',
  'svelte.config.js',
  'svelte.config.ts',
  'astro.config.mjs',
  'astro.config.js',
  'astro.config.ts',
  'gatsby-config.js',
  'gatsby-config.ts',
  'remix.config.js',
  'remix.config.ts',
  'quasar.config.js',
  'umi.config.ts',
];

// 前端框架/构建工具包名
const FRONTEND_FRAMEWORK_PACKAGES = [
  'react',
  'react-dom',
  'vue',
  '@vue/core',
  '@angular/core',
  'svelte',
  'astro',
  'next',
  'nuxt',
  'gatsby',
  'solid-js',
  'preact',
  '@remix-run/react',
  '@umijs/max',
];

/**
 * 根据文件节点列表判断是否为前端项目。
 * @param nodes 仓库根级文件节点
 * @returns true 表示前端项目；false 表示未检测到前端特征；null 表示文件树为空、无法判断
 */
export function detectFrontendProject(nodes: DetectableFileNode[]): boolean | null {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  const rootFileNames = nodes
    .filter((n) => n.type === 'file')
    .map((n) => n.name.toLowerCase());

  // 1. 根目录存在典型前端配置文件或入口 HTML
  const hasFrontendRootFile = FRONTEND_ROOT_FILES.some((name) =>
    rootFileNames.includes(name.toLowerCase())
  );
  if (hasFrontendRootFile) {
    return true;
  }

  // 2. 解析 package.json 中的依赖
  const packageJsonNode = nodes.find(
    (n) => n.type === 'file' && n.name.toLowerCase() === 'package.json'
  );
  if (packageJsonNode?.content) {
    try {
      const pkg = JSON.parse(packageJsonNode.content) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const allDeps = Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      }).map((k) => k.toLowerCase());

      const hasFrontendDependency = FRONTEND_FRAMEWORK_PACKAGES.some((pkgName) =>
        allDeps.includes(pkgName.toLowerCase())
      );
      if (hasFrontendDependency) {
        return true;
      }
    } catch {
      // package.json 解析失败时忽略，继续后续检测
    }
  }

  // 3. 检查 src 目录下的前端入口文件
  const srcDir = nodes.find(
    (n) => n.type === 'folder' && n.name.toLowerCase() === 'src'
  );
  if (srcDir?.children && srcDir.children.length > 0) {
    const srcFileNames = srcDir.children
      .filter((n) => n.type === 'file')
      .map((n) => n.name.toLowerCase());

    const FRONTEND_ENTRY_FILES = [
      'main.tsx',
      'main.jsx',
      'main.ts',
      'main.js',
      'app.tsx',
      'app.jsx',
      'app.ts',
      'app.js',
      'app.vue',
    ];
    const hasFrontendEntry = FRONTEND_ENTRY_FILES.some((name) =>
      srcFileNames.includes(name)
    );
    if (hasFrontendEntry) {
      return true;
    }
  }

  return false;
}
