## 现象

打开应用后在浏览器 Console 中报错：

```
Uncaught TypeError: Cannot read properties of undefined (reading 'tokenizePlaceholders')
```

错误堆栈：

```
at index.esm-D1V62i4j.js:26816:38     -> e$1.languages["markup-templating"].tokenizePlaceholders(t$2, "php")
at Object.run                          -> Prism tokenizer run()
at Object.highlight                    -> Prism.highlight()
at Object.highlightElement             -> Prism.highlightElement()
at Object.highlightAllUnder            -> Prism.highlightAllUnder()
at Object.highlightAll                 -> Prism.highlightAll()
at d$1 (index.esm-D1V62i4j.js:25995)  -> wangeditor init calls highlightAll()
```

## 根因

1. `@wangeditor/editor@5.1.23` 在内部打包了自己的 Prism.js（位于 Vite 预打包后的 `index.esm-D1V62i4j.js`），并在模块初始化时自动调用 `Prism.highlightAll()` 扫描页面中所有 `code[class*="language-"]` 元素。

2. wangeditor 打包的 Prism.js 包含 PHP 等模板类语言的语法定义，这些语法在 `after-tokenize` 钩子中依赖 `markup-templating` 插件来解析模板占位符。然而 `markup-templating` 并未被加载到 wangeditor 的 `window.Prism.languages` 中（该模块由 `refractor` 单独引入，仅注册到 refractor 内部的 Prism 实例）。

3. 当 `react-syntax-highlighter` 渲染了代码块后，wangeditor 的 `highlightAll()` 尝试重新高亮这些元素。当遇到 PHP 这类模板语言时，`after-tokenize` 钩子调用 `Prism.languages["markup-templating"].tokenizePlaceholders()`，但 `Prism.languages["markup-templating"]` 为 `undefined`，导致崩溃。

## 解决方案

在 `apps/dh-frontend/index.html` 中，在模块脚本 `<script type="module" src="/src/main.tsx">` **之前**添加内联脚本，将 `window.Prism.manual` 设置为 `true`：

```html
<script>
  window.Prism = window.Prism || {};
  window.Prism.manual = true;
</script>
```

原理：wangeditor 打包的 Prism 在初始化时会读取 `window.Prism.manual` 的值。若为 `true` 则跳过 `highlightAll()` 调用，不会进行全局自动高亮。同时 wangeditor 编辑器内部仍然可以通过显式调用 `highlightElement()` 来高亮自己的代码块，不受影响。
