---
title: 笔墨开发记录
date: 2026-10-23
tags:
  - bimo
  - project
  - roadmap
---

# 笔墨（bimo）开发路线与逐项结论

> 基线：fork 自 Ink 0.6.1 源码（`06-Projects/bimo`），已作为独立插件 `bimo` 部署到 `.obsidian/plugins/bimo/`。
> 本文件随每一轮开发更新，记录**已实现 / 未实现 / 不可行**三类结论，以及每条的验证方式。

最后更新：2026-10-23（第 23 轮 · 笔记与 PDF 上直接书写）

---

## 零点、第 23 轮完成清单（把 Handwriting 的能力做成 bimo 原生）

目标是把 Handwriting 那套「在笔记和 PDF 上直接写、笔记仍是 Markdown」的能力完整搬到 bimo，而不是继续用两个插件抢同一片像素。

### 新增模块

| 文件 | 作用 |
|:---|:---|
| `src/logic/md-ink/types.ts` | 数据模型 + 行锚定解析 `resolveAnchorLine` |
| `src/logic/md-ink/md-ink-store.ts` | `.bimo/md-ink/<fnv1a>.json` 读写，容错解析 |
| `src/logic/md-ink/md-ink-overlay.ts` | 笔记上的 SVG 覆盖层：渲染、五种工具、撤销、复制粘贴、导出 |
| `src/logic/md-ink/md-ink-extension.ts` | CodeMirror 6 ViewPlugin，每个 Markdown 编辑器挂一层 |
| `src/logic/md-ink/md-ink-controller.ts` | 按笔记路径的 overlay 注册表 + 全局工具状态 |
| `src/logic/md-ink/md-ink-commands.ts` | 14 条命令 |
| `src/logic/md-ink/pdf-ink-types.ts` | 归一化坐标（0–1）与往返换算 |
| `src/logic/md-ink/pdf-ink-overlay.ts` | PDF 页面层：`[data-page-number]` 探测、缩放重投影 |
| `src/logic/md-ink/pdf-ink-manager.ts` | 每个 PDF leaf 一个 overlay，跟随 layout-change |
| `src/styles/md-ink.scss` | 覆盖层、浮动 pill、色板样式 |

### 关键设计决定

| 问题 | 决定与理由 |
|:---|:---|
| 笔迹锚在哪 | 每条笔迹记 `{line, lineText}`，点坐标相对该行左上角。插入段落后行号会变，但按文本指纹能找回；原文被改掉则返回 `null`，保持原行号而不是瞬移到无关段落 |
| 笔迹存哪 | `.bimo/md-ink/*.json`，**不写进 .md**。这是与书写块（writing embed）的本质区别：Markdown 文件保持普通文件，同步/版本控制/导出都不受影响 |
| 覆盖层怎么跟随滚动 | SVG 作为 `.cm-content` 的子元素，浏览器自动随文字移动，不需要每帧算 transform |
| 怎么不挡文字 | `pointer-events: none` 直到选择绘画工具。默认工具是 `pan`，所以开启功能后编辑行为一点不变 |
| PDF 坐标 | 归一化到页面盒（0–1），线宽也归一化。缩放、改窗口大小、换屏幕都重投影到同一视觉位置 |
| PDF 页面被重建 | pdf.js 虚拟滚动会销毁重建页面元素。`MutationObserver` 重扫，SVG 跟着新元素重新挂载；只有页面集合真的变了才全量重绘 |

### 功能对表（Handwriting → bimo）

| Handwriting | bimo 状态 |
|:---|:---|
| 笔记上直接书写 | 已实现 |
| PDF 上直接书写 | 已实现（DOM 探针，未在真机验证） |
| 钢笔 / 荧光笔 / 橡皮 / 套索 / 平移 | 已实现，笔刷还多出铅笔、细线笔、马克笔、蜡笔、毛笔 |
| 撤销 / 重做 | 已实现（自带栈，不依赖编辑器撤销） |
| 复制 / 剪切 / 粘贴笔迹 | 已全部实现（剪贴板 JSON）。剪切不带热键：`Mod+X` 属于编辑器，层内只在有套索选中时接管 Delete / Backspace |
| 纸张（横线/网格/点阵） | 已实现 |
| 压感 / 平滑 | 复用 bimo 既有 perfect-freehand 管线 |
| 导出 SVG | 已实现；导出 PDF 不做——用户第 16 轮明确否决 pdf-lib 这类重依赖 |
| 形状吸附（shapeSnap） | 已实现，设置可关。判定顺序是矩形优先：闭合方框也是四段接近直线，先判直线会把框压成一条对角线 |
| 颜色 / 粗细 / 橡皮循环命令 | 已实现 |
| 鼠标书写开关命令 | 已实现 |
| 笔尖光标（penReticle） | 已实现，笔记与 PDF 都有。圆环半径 = 真实落笔半径或橡皮命中半径 |
| 笔迹预测 | 未做（不影响核心书写体验） |
| 按文件存储 | 已实现，JSON 而非 Handwriting 的 pageOwners 映射 |

### 第 24 轮补充：两个真缺陷

| 缺陷 | 根因 | 修法 |
|:---|:---|:---|
| 长笔记里绘制会明显卡顿 | `lineOf()` 每渲染一条笔迹就调一次 `docLines()`，而它遍历整个文档生成字符串数组。1000 行 × 100 条笔迹 = 10 万次字符串操作，且每次编辑、每次擦除都重来一遍 | 按 `view.state.doc` 对象身份缓存行数组。Text 对象在编辑后变化，天然是免费缓存键 |
| `Delete` 删不掉字、`Ctrl+X` 不剪切文字 | 第一版把 `Delete` 和 `Mod+X` 注册成了命令热键，Obsidian 的全局热键优先于编辑器原生行为 | 两条热键全部移除。删除改由层内 `keydown` 处理，且只在 `selectedIds.size > 0` 时接管——只有「有套索选中」这个状态下，Delete 才不可能是在删字符 |

### 诊断命令

| 命令 | 输出 |
|:---|:---|
| 检查笔记书写状态 | `layers=N pills=N overlays=N active=<路径> \| <每条 notePath strokes=N tool=T>` |
| 检查 PDF 书写支持 | `pages=N canvas=N iframe=N layers=N attached=N` |

这两个不靠猜：`overlays=0` 说明编辑器扩展没挂上（笔记没重开），`layers>0` 但 `strokes=0` 说明 JSON 没加载，`pages=0` 说明 PDF 选择器没命中，`iframe>0` 说明 PDF 在 iframe 里、整条路要换。

### 验证

| 项 | 结果 |
|:---|:---|
| `tsc --noEmit -skipLibCheck` | 0 错误 |
| 逻辑层单测 | **46 套件 / 518 项全过**（新增 md-ink 15 项、pdf-ink 9 项、设置迁移 3 项、形状吸附 11 项、**挂载集成 9 项**） |
| 挂载集成测试 | `tests/logic/md-ink-mount.test.ts` 在 jsdom 里**真实创建 CodeMirror 编辑器**并 `appendConfig` 扩展，断言 layer / svg / pill 进入 DOM、按路径注册、默认 pan 不拦截指针、关闭时不挂载、嵌入块内不挂载、销毁时清空 |
| `main.js` | `5c062be24cf3322676dfea7cef7ad593`（dist 与部署一致） |
| `styles.css` | `cf365dac1c94e1dd866653e39bfa5fec`（一致） |
| 真机书写手感 | **未验证**，需用户实际落笔 |
| PDF 页面 DOM 假设 | **未验证**，`[data-page-number]` 是 pdf.js 的标准属性，但 Obsidian 版本会变；提供命令「检查 PDF 书写支持」输出 `pages/canvas/iframe/layers/attached` 计数供诊断 |

### 已知冲突

Handwriting 插件仍在启用。两个插件都会在编辑器上挂指针监听，同一次落笔可能被两边各画一条。**验证 bimo 版本前必须先停用 Handwriting**，否则看到的不是 bimo 的效果。

---

## 零点一、第 13 轮完成清单（笔刷面板重排）

用户给的截图里，面板"和周围不协调"。拆开看是三个确定性缺陷，不是审美问题。

### 1. 最后一行笔刷靠左，右侧留洞

```scss
// 改前
.ddc_ink_brush-panel__brush { flex: 1 1 18%; }   // 7 个 → 4+3，第二行左对齐
```

18% × 7 装不进一行，`flex-wrap` 折成 4 + 3，而 section 是默认 `justify-content: flex-start`，于是第二行贴着左边界，右边空出一整格宽度。

改成固定 4 列 + `justify-content: center`：

```scss
.ddc_ink_brush-panel__section { justify-content: center; }
button.ddc_ink_brush-panel__brush { flex: 0 0 calc(25% - 0.2em); }
```

4 个刚好占满，3 个自动居中。这是 `justify-content` 在 wrap 下按**每一行**生效的直接结果。

### 2. 每个笔刷都是灰方块，选中却是蓝描边

两个原因叠在一起：

| 层 | 行为 |
|:---|:---|
| Obsidian 原生 `button` | `background-color: var(--interactive-normal)` + `box-shadow` |
| 原代码的类选择器 | `.ddc_ink_brush-panel__brush { background-color: transparent }` —— **特异性输给原生规则** |

所以"压在静息态没有背景"的意图一天都没生效。修法是把选择器提到 `button.ddc_ink_brush-panel__brush`，并把静息态、悬停态、选中态统一成一套语言：

```
静息   透明，无边框
悬停   --background-modifier-hover
选中   同上 + --background-modifier-border-focus 描边
```

选中不再用 `--interactive-accent`：panel 里已经有色板在用 accent，两个 accent 抢注意力。选中用"灰底 + 中性描边"，色板自己的 accent 圈才是唯一的彩色强调。

### 3. 三块区域各用一套间距

改前：笔刷 `gap: 0.35em`、色板 `0.3em`、粗细 `justify-start` 无 padding。视觉上是三个独立小盒子堆在一起。

改后共享一条栅格：

| 区域 | 处理 |
|:---|:---|
| 笔刷网格 | 4 列居中，`padding: 0.4em 0.25em` |
| 色板 | 左对齐、`gap: 0.5em`、`padding-inline: 0.6em`（与网格同起点） |
| 粗细 | 同上，`gap: 0.15em` |
| 分隔 | 只在笔刷区与色板区之间一条 hairline（`nth-child(2)`）——色板与粗细属于同一个"用哪种墨水"的决定，再切一刀是多余的 |

面板本身也收窄到 17em（原 `min-width: 13em` 装不下 4 列），阴影改成"近距定义边缘 + 远距抬升"两层，单层大模糊会被读成对话框。

### 4. "Opaque" 这行字删掉

原逻辑：不透明笔刷时底部显示 `Opaque`。这行字没有信息量，却让面板看起来少了一个控件。改为只在 `opacity < 1` 时显示「半透明 — 覆盖在已有笔迹之上」。

### 本轮验证

| 项 | 结果 |
|:---|:---|
| `tsc --noEmit` | 0 错误 |
| 构建 | `main.js` 4.1 MB / `styles.css` 316.8 KB |
| 部署 | `main.js` `54947a88…`、`styles.css` `e73a5b42…`，与插件目录一致 |
| 产物自检 | `calc(25% - 0.2em)`、`nth-child(2)` 均在 `styles.css` |

### 本轮没做的（用户同轮提出的，待决策）

| 项 | 结论 |
|:---|:---|
| md 正文上直接书写 | 技术与现有"块级透明"完全不同，见第二章第 3 节重写 |
| 图层 | 可行，需 `InkLayer` 数据结构 + 渲染分组 + 面板 UI |
| AI 识别后生成函数图 | 复用现有采样管线，缺的是"从笔迹提取表达式"的入口 |
| PDF 批注"没实现" | 代码完整（`annotate-pdf-page`），判定为插件未重载，见下方 |

### 关于「PDF 批注还是没实现」

`src/main.ts:471` 的 `implementPdfCommands` 存在且注册为**普通 callback**（不是 `editorCallback`），`src/logic/pdf/` 四个文件齐全。

现场时间戳：

| 文件 | 时间 |
|:---|:---|
| `data.json` | 09:01:07 |
| 部署的 `main.js` | 09:09:58 |

与第 9 轮同一个症状：**磁盘上是新代码，进程里是旧代码**。需要重载插件后再判定。

### 但复查时发现两个真 bug，与「没重载」无关

#### Bug G：在 PDF 视图执行命令，文件按 PDF 的目录落

```ts
// insertPdfAnnotations，改前
const activeFile = plugin.app.workspace.getActiveFile();
const inkRoot = await resolveInkRootFolder(plugin, activeFile);
const inkFile = await createNewWritingFile(plugin, activeFile);
```

`getActiveFile()` 返回的是**当前焦点所在视图的文件**。而这个命令最自然的用法就是「盯着 PDF、按 Ctrl+Shift+P」——那一刻活动文件正是那个 PDF。

后果：

| 项 | 错到哪 |
|:---|:---|
| 页面图 | `<PDF 所在目录>/Ink/PDF/...` |
| 手写块 | 同上 |

也就是讲义目录旁边凭空多出一棵 `Ink/` 树，而配置里的 `_system/attachments/Ink/` 一个文件都没有。用户看到"命令跑完了但笔记里没东西/东西在奇怪的地方"，被读成"没实现"。

修法：`findMarkdownEditor` 扩成 `findMarkdownTarget`，把 editor 和它所属的 `TFile` 一起带出来；`insertPdfAnnotations` 新增第四个参数 `instigatingFile`，落点以它为准，`getActiveFile()` 只作兜底。

```ts
interface MarkdownTarget { editor: Editor; file: TFile }
void insertPdfAnnotations(plugin, target.editor, { pdfFile, pageNumbers }, target.file);
```

#### Bug H：同时开两个 PDF 时认错文件

```ts
// 改前：遍历所有 pdf leaf，返回第一个
const leaves = app.workspace.getLeavesOfType('pdf');
for (const leaf of leaves) { ... return { path, page }; }
```

`getLeavesOfType` 的顺序是实现细节，不是"活动顺序"。开着两本讲义时，批注第二本会静默渲染出第一本的页。

修法：先看 `workspace.activeLeaf` 的 `getViewType() === 'pdf'`，命中就直接用；未命中才回退遍历。

### 本轮验证（补充）

| 项 | 结果 |
|:---|:---|
| `tsc --noEmit` | 0 错误 |
| `pdf-page-selection.test.ts` | 13/13 通过 |
| `pdf-annotation-index.test.ts` | 13/13 通过 |
| 部署 | `main.js` `bb3b037f…`（与 dist 一致） |
| 产物自检 | `findMarkdownTarget`×2、`instigatingFile`×22、`getViewType?.()`×2 |

---

## 零点三、第 12 轮完成清单（闭环修复）

这轮先修上一轮自己引入的问题，再把三处「只修了一半」的地方补完。

### 1. 上一轮的 CSS 修复与 JS 补偿逻辑打架

第 11 轮把工具栏从「移出块外」改成「留在块内」，只改了 CSS。但滚动监听仍在按「已移出」做补偿：

```ts
// primary-menu-bar.tsx（第 11 轮之后仍然是这样）
if (menuActive) {
    embedPosY -= Number(menuBarHeight);   // 补偿一个已经不存在的 -100% 位移
}
```

后果：滚动时它判断「块已经滚出视口」，然后把 `top` 设成一个正值，把工具栏**推进块中间**。CSS 改对了，JS 还在按旧前提算。

修法是让补偿逻辑知道自己运行在哪种模式：

```ts
if (primaryMenuBar.closest('.ddc_ink_writing-embed')) {
    primaryMenuBar.style.removeProperty('top');
    return;
}
```

次级菜单栏同样处理（它原本补偿的是 `translate(0, 50%)`）。

**这条值得记下来**：改一段布局行为时，只要它有配套的滚动/定位脚本，CSS 与 JS 必须同时改。第 11 轮我只看了样式文件，没搜引用它的脚本。

### 2. 旧荧光笔笔迹：从「手动触发」改为自动修复

第 11 轮验证出旧文件里已经是 `fill="black"`，当时的说法是「打开块、画一笔、退出」才会重写。这要求用户做一件不自然的事。

现在改成打开即修：

```ts
// handleEditorReady 里，延迟 700ms 避开加载与迁移
window.setTimeout(() => {
    if (!needsStrokeColourRewrite(current.getSnapshot().strokes)) return;
    void incrementalSave();
}, 700);
```

`needsStrokeColourRewrite()` 的判据：**存在一条笔迹，它的颜色会解析成 `currentColor`、而它的笔刷自带非主题色**。正好命中「旧荧光笔」这一种情况，不会误伤普通钢笔。

延迟 700ms 是因为编辑器就绪后还有 tldraw 迁移和首次布局；过早保存会写到一半的状态。

### 3. 卡片避让：不再盖住刚写的那一行

固定右下角的卡片有个确定性缺陷：人在页面底部写完时，回复正好盖住触发它的那句话。

`replyPlacementForLastStroke()` 用同一页的笔迹自己定位：

```
最后一笔落在整页笔迹区间的下方 38% → 卡片放上方
否则 → 卡片放下方
```

5 项单测覆盖：空页、底部写完、顶部写完、空笔迹混入、全部点在同一水平线。

### 4. 浮现动画：从「弹出」改为「墨水浮起」

原来是 `opacity + translateY`。加了一层 `filter: blur(3px) → 0`：

```scss
.ddc_ink_magic-ink {
    filter: blur(3px);
    transition: opacity .26s, transform .3s, filter .34s;
}
.ddc_ink_magic-ink--visible { filter: blur(0); }
```

这是「哈利波特式浮现」与「普通 Toast 弹出」的差别所在：失焦→聚焦会被读成「有东西从纸里浮上来」，单纯位移只会被读成「弹窗出现」。

### 5. 设置页：四个分区各有一句定位说明

空的标签页等于把长滚动换成了四个空盒。每个分区开头加一行说明：

| 分区 | 说明 |
|:---|:---|
| 连接与模型 | 模型放在哪里。不配置也能正常手写，只是无法识别、也不会有 AI 回应。 |
| 书写与绘图 | 这一页本身的默认行为：笔迹怎么采集、块怎么打开、以及魔法页边。 |
| 文件与导出 | 附件存在哪里，以及旧版本写的文件如何迁移过来。 |
| 关于与维护 | 使用提示、重置与开发信息。 |

### 本轮验证

| 项 | 结果 |
|:---|:---|
| `tsc --noEmit` | 0 错误 |
| 新增单测：卡片定位 5 项 | **13/13 通过**（含原有 8 项触发器测试） |
| 全量单测 | **822 通过**（上轮 817，+5） |
| i18n | **404 键，缺失 0** |
| 构建部署 | `main.js` `84078ab6…`、`styles.css` `afa50e12…`，与插件目录一致 |
| 产物自检 | `needsStrokeColourRewrite`、`ddc_ink_magic-ink--top`、`bimo_settings-pane__intro` |

### 本轮没做的

| 项 | 原因 |
|:---|:---|
| 「打开即自动开启魔法笔」开关 | 每打开一个手写块就激活会成倍消耗请求，且用户写哪块都触发。保持显式开启。 |
| 手写体描摹（L2） | 需 opentype.js + 字体，体积翻倍，等你拍板 |

---

## 零点五、第 11 轮完成清单（深度修复）

上一轮的修复有两处基于代码推断。这轮把根因追到底，并用真实模型调用验证了提示词。

### 1. UI 重叠的真正根因：工具栏被移出了嵌入块

上一轮我改的是「按钮之间互相挤压」。重新核对后发现那只是次要问题，主因是：

```scss
// primary-menu-bar.scss（上游原样）
.ddc_ink_embed .ink_primary-menu-bar {
    &.ddc_ink_active { transform: translate(0, -100%); }   // 移出块上方
}
// secondary-menu-bar.scss
.cm-embed-block .ink_secondary-menu-bar {
    &.ddc_ink_active { transform: translate(0, 50%); }     // 移出块下方
}
```

而 `menuActive` 恒为 `true`，加上嵌入块 `overflow: visible !important`，结果是：

| 元素 | 实际位置 |
|:---|:---|
| 顶部工具栏 | **移出到嵌入块上方**，压在笔记的上一段文字上 |
| 底部按钮组 | **移出到嵌入块下方**，压住下一段文字 |

滚动时还会粘在视口边缘。这就是「整个书写界面 UI 有重叠」的来源——不是按钮互相压，是工具栏压到了笔记正文。

修法是把浮层收回块内：

```scss
.ddc_ink_embed .ddc_ink_writing-editor {
    padding-top: 46px;      // 给工具栏让出空间
    padding-bottom: 10px;   // 给底部按钮组让出空间
    box-sizing: border-box;
}
.ddc_ink_embed.ddc_ink_writing-embed .ink_primary-menu-bar,
.ddc_ink_embed.ddc_ink_writing-embed .ink_primary-menu-bar.ddc_ink_active {
    transform: none !important;
}
.cm-embed-block .ink_secondary-menu-bar,
.cm-embed-block .ink_secondary-menu-bar.ddc_ink_active {
    transform: none !important;
}
```

**代价**：书写区少了约 56px 高度。**收益**：工具栏不再盖住任何笔记正文，且滚动时不会在视口边缘漂浮。

**只作用于书写嵌入**（`.ddc_ink_writing-embed`）。绘图嵌入保持原来的移出行为——无限画布上工具栏越界是合理的。

另外加了一条 1px 渐变分隔线在工具栏底部，让第一行字有明确起点，不和按钮阴影粘连。

### 2. 荧光笔颜色：验证了预览的真实渲染路径

上一轮修了导出颜色，但没确认「锁定态显示的到底是什么」。这轮查清了：

```tsx
// writing-embed-preview.tsx
import SVG from 'react-inlinesvg';
void props.plugin.app.vault.read(props.writingFile).then((svgContent) => {
    setFileSrc(svgContent);   // 直接内联文件原文
});
```

**预览读的是磁盘上的 SVG 原文**，不是重渲染。结论：

| 情况 | 行为 |
|:---|:---|
| 新画的荧光笔 | 保存时写 `fill="#ffd400"` → 预览是黄色 ✅ |
| 第 10 轮之前画的荧光笔 | 文件里已是 `fill="black"` + `opacity=0.32` → 仍是灰 |

**旧笔迹的修复路径**：打开该块进入编辑、退出（触发一次保存）。保存会用新的 `resolvedStrokeColour` 重写整份 SVG，旧笔迹一起变黄。不需要迁移脚本——保存本身就是整份重写。

### 3. 魔法笔：6 次真实请求的实测

用配置里的 DeepSeek 端点跑了真实的手写测试图，验证「纸边批注」人设是否成立。

**第一版提示词（80 字上限）**：

| 次 | 耗时 | tokens | 字数 | 问题 |
|:---|---:|---:|---:|:---|
| 1 | 222ms | 632 | 88 | — |
| 2 | 121ms | 665 | **135** | 超限 55 字，**带全角空格缩进** |
| 3 | 105ms | 643 | 89 | — |

内容质量本身很好——三次都准确指出了测试页上的真实错误：高斯定理漏了 $q_{\text{内}}$、$\varepsilon_0$ 写成 $\varepsilon O$、$r$ 应说明是到球心距离。

**第二版（收紧到 90 字 / 最多两行 / 禁全角空格）**：

| 次 | 耗时 | tokens | 字数 | 结果 |
|:---|---:|---:|---:|:---|
| 1 | 211ms | 665 | 80 | 两行，无 Markdown |
| 2 | 89ms | 661 | 61 | 两行，更精准 |
| 3 | 92ms | 657 | 93 | 略超 3 字，可接受 |

自检结论：

- **Markdown 污染：0**（三次都没有标题/列表/编号）
- **全角空格：0**
- **速度：89–211ms**（思考模式关闭的直接收益）
- **三次不一致**：这是模型随机性，不是格式漂移——三次都是两行、都在指出具体错误

提示词最终形态（`MAGIC_INK_SYSTEM_PROMPT`）：

```
你会收到我刚写下的一页手写内容。不要复述我写了什么，只做下面三件事之一：
1. 如果我写错了（算错、笔误、概念用反），直接指出并给出正确写法。
2. 如果我停在一半（没写完的推导、没接上的思路），替我把下一步写出来。
3. 如果都没问题，补一句真正有用的话：更简单的解法、要注意的坑，或者一个追问。
```

这三条不是装饰：手写批注最常见的失败是「复述你写了什么」，明确禁止之后回复才有增量。

### 4. 魔法笔设置项

两个参数暴露到设置页（写在「书写与绘图」分区）：

| 设置 | 范围 | 默认 | 作用 |
|:---|:---|:---|:---|
| 停笔多久后回应 | 1000–6000ms，步进 200 | **2200ms** | 太短打断思路，太长像没反应 |
| 至少新写几笔 | 1–8 | **2** | 一个点、一个逗号不值得一次请求 |

迁移时做了钳制而不是只补默认值——`idleMs = 0` 会导致每次笔画都触发。

默认值从 1600ms 提到 2200ms，原因就是上面的实测：真实的「写完停笔」通常要 2 秒，1.6 秒时手指还悬在屏幕上。

### 5. 设置页补充

- 分区切换时把设置容器滚回顶部（`containerEl.closest('.vertical-tab-content')?.scrollTo({top:0})`）——否则切换后可能停在空白处
- 卡片宽度从 20em 调到 24em：两行 45 个汉字在 20em 里会折成四行

### 本轮验证

| 项 | 结果 |
|:---|:---|
| `tsc --noEmit` | 0 错误 |
| 全量单测 | **817 通过**（与上轮一致，未引入回归） |
| i18n | **400 键，缺失 0** |
| 真实模型调用 | 6 次，全部 200；格式问题 0（第二版） |
| 构建部署 | `main.js` `25e765d7…`、`styles.css` `b35fcb58…`，与插件目录一致 |
| 产物自检 | `magicInkIdleMs`×6、`padding-top: 46px`×1 |

### 本轮没做的

| 项 | 原因 |
|:---|:---|
| 旧荧光笔批量迁移 | 不需要：任何一次保存都会整份重写 |
| 绘图嵌入的工具栏收回块内 | 无限画布上工具栏越界是合理设计，改了反而挡画布 |
| 魔法笔按书写位置浮现在笔尖旁 | 窄嵌入里会盖住刚写的字，固定在右下角更稳 |

---

## 零、第 10 轮完成清单（体验修复）

用户实测反馈的四个问题，逐条处理。

### 1. 荧光笔锁定后变灰 —— 根因是颜色回退链

现象：书写时是黄色，退出书写（锁定）后变成灰色。

根因不是一个地方，而是一条链：

| 环节 | 行为 |
|:---|:---|
| 笔刷偏好 | 选荧光笔时若当前色是 `currentColor` 才替换成 `#ffd400`；从 localStorage 读回偏好时**不替换** |
| 编辑态渲染 | `currentColor` 解析为主题文字色（浅色主题是黑） |
| 导出到 SVG | `resolvedStrokeColour()` 把 `currentColor` 一律当成 print-safe 黑 |
| 叠加不透明度 | 荧光笔 opacity 0.32 → **32% 的黑色 = 灰** |

修了三处，缺一处都会复发：

```ts
// 1. svg-export.ts —— 回退时先问笔刷自带色
const presetColour = resolveBrushPreset(stroke.style.brush).defaultColour;
if (presetColour && presetColour !== 'currentColor') return presetColour;
return DEFAULT_CONTENT_COLOUR_PRIMARY_STROKE;

// 2. brush-menu.tsx —— 读偏好时也归一化
function normalizePreferences(p) {
  const preset = getBrushPreset(p.brush);
  if (preset.defaultColour !== 'currentColor' && p.colour === 'currentColor') {
    return { ...p, colour: preset.defaultColour };
  }
  return p;
}

// 3. applyPreferences 也走同一归一化，而不是只在 selectBrush 里特判 highlighter
```

**旧笔记的处理**：已保存为 `currentColor` 的荧光笔笔迹会在**下一次保存时自动修正**——因为保存会用新的 `resolvedStrokeColour` 重写整份 SVG。打开块、画一笔或改一下再退出即可。

### 2. 书写界面 UI 重叠

定位到三处真实挤压/溢出，全部是纯 CSS：

| 问题 | 修法 | 文件 |
|:---|:---|:---|
| 工具按钮组用 `position:absolute; left:50%` 居中，窄嵌入下与左右两组叠在一起 | 书写编辑器内改为普通 flex 子项（`margin-inline:auto` 居中） | `writing-menu.scss` |
| 笔刷面板 7 笔刷 + 7 色 + 3 档，高约 300px，在小嵌入里超出块 | `max-height: min(60vh, 22em)` + 内部滚动 + `z-index:1002` | `brush-menu.scss` |
| 三组按钮之间没有间距约束 | `gap:8px`、`flex:0 0 auto`、`min-width:0` | `writing-menu.scss` |

**明确没做的一件事**：给嵌入菜单栏加全宽背景。试过，但菜单栏是 `translateY(-100%)` 移出嵌入后粘在视口顶部的，全宽填充会遮住笔记正文。只有按钮自己带背景色，这是原版正确的选择。

### 3. 魔法页边改为「写完自动浮现」

旧方案（输入框问答）保留，新增自动模式——你要的是「边写，写完它自动浮现回复」，不是打开一个对话框打字。

新增三块：

| 文件 | 职责 |
|:---|:---|
| `src/logic/ai/magic-ink.ts` | `MagicInkWatcher`：三闸门（停笔时长 / 新增笔数 / 冷却） |
| `src/components/dom-components/magic-ink/magic-ink-card.ts` | 页面内浮现卡片，逐字打出，不抢焦点 |
| `src/logic/ai/magic-prompt.ts` | `MAGIC_INK_SYSTEM_PROMPT`：无提问场景的短回复人设 |

三道闸门各自防一种失败：

```
idleMs    1600ms  —— 写到一半就回答是噪音
minNewStrokes 2   —— 一个点、一个标点不值得一次请求
cooldownMs 4000ms —— 回答后用户常常继续写，否则卡片会闪
```

实现要点：

- 触发时**只发送笔迹，不带背景图**——否则模型会把 PDF 印刷字也当成"我写的"。
- 空白页约定返回一个句号，客户端识别后**不显示卡片**，避免空浮层。
- 卡片 `pointer-events` 只在自己身上，永远不取焦点：写完接着写不会被抢走光标。
- 插入笔记是显式点击（`插入笔记`），从不自动改正文。

开关在书写工具栏（✦ 按钮），未配置 API 时点击直接提示，不会静默失败。

### 4. 设置界面重构

原来是一条 1000+ 行的长滚动，转录、笔刷、PDF、AI、文件组织全部混在一列。

改为：**品牌头 + 四个分区 + 卡片式布局**。

```
┌ 笔墨                                    v0.1.0  模型已连接 ┐
├ 连接与模型 │ 书写与绘图 │ 文件与导出 │ 关于与维护          ┤
└───────────────────────────────────────────────────────┘
```

| 分区 | 内容 |
|:---|:---|
| 连接与模型 | 界面语言、自定义 API（供应商预设 / 获取模型 / 思考模式）、Almost Useful 账户 |
| 书写与绘图 | 引导开关、书写设置、绘图设置、实验功能（Boox、指纹绘制、压感笔侧键） |
| 文件与导出 | 文件组织与子目录、tldraw SVG 迁移、vault 格式迁移 |
| 关于与维护 | 开始使用、重置设置、预发布提示、插件开发、支持按钮 |

分区是纯 show/hide，每个 section 保留自己的 DOM 与状态，切换不重建。分区选择在设置重渲染后保留（`activePane` 字段）。

品牌头带两个徽章：版本号、模型连接状态（`enabled && apiKey && model` 三者都有才显示「模型已连接」）。

### 本轮验证

| 项 | 结果 |
|:---|:---|
| `tsc --noEmit` | 0 错误 |
| 新增单测 `magic-ink-watcher.test.ts` | **8/8 通过** |
| 全量单测 | **817 通过**（上轮 809，+8） |
| 失败套件 | 15 个，与第 1 轮基线一致（上游 mock 缺 `PluginSettingTab`） |
| i18n | **392 键，缺失 0**（脚本：`06-Projects/bimo/docs/check-i18n.js`） |
| 构建 | `main.js` 4.07 MB / `styles.css` 314.9 KB |
| 部署 | md5 `82f366ad…` / `c7df32a6…` 与插件目录一致 |
| 产物自检 | `Magic margin on`×2、`bimo_settings-nav`×3、`magic-ink`×25 |

### 本轮没做的

| 项 | 原因 |
|:---|:---|
| 旧荧光笔笔迹批量重写 | 不需要：任何一次保存都会用新逻辑重写整份 SVG |
| 魔法笔的"写到哪、回到哪"定位 | 卡片固定在右下角。按书写位置浮现在窄嵌入里会盖住刚写的字 |
| 设置项分区的键盘快捷键 | 分区间切换频率低，优先保证结构正确 |

---

## 一、总体判断

原版 Ink 把「手写」做成了**一个独立文件 + 一个嵌入式图片**。这个模型决定了它的天花板：

| 限制 | 根因 |
|:---|:---|
| 转录文本"住在墙里" | 正文只有 `![alt](svg)`，完整文本在 SVG 的 `<metadata>` |
| 不能批注 PDF | 没有"背景层"概念，画布永远是白底 |
| 笔触单一 | 所有笔迹共享一套 pen/mouse 参数，SVG 导出还强制烘焙成黑色 |
| 与 AI 只有单向转录 | 只有"图 → 文字"，没有"文字 → 图" |

笔墨的改造方向是把这三层拆开：**背景层（PDF/图片/网格）× 笔迹层（多笔触、可透明）× 文本层（可编辑、可导出、可被 AI 读写）**。

---

## 二、逐项结论

### ✅ 1. 增加更多笔触

**可行性**：高。**状态：已实现（第 1 轮 5 种，第 2 轮扩到 7 种）**。

完美自由手（perfect-freehand）只有 4 个渲染参数（thinning / smoothing / streamline / size），不存在真正的"纹理笔刷"。所以笔触差异只能来自参数组合 + 不透明度 + 颜色，做不到真实铅笔的纸纹颗粒。

已实现 7 种：**钢笔、铅笔、细线笔、马克笔、荧光笔、蜡笔、毛笔**，外加 7 色色板和 3 档粗细。

| 新增（第 2 轮） | 定位 |
|:---|:---|
| 细线笔 | 压感几乎不变粗细（thinning 0.05），画示意图/标注不会被线宽干扰 |
| 蜡笔 | 宽、软、透（opacity 0.72），是这个模型能接近"蜡质"的极限 |

| 关键设计 | 说明 |
|:---|:---|
| `InkStrokeStyle.brush` | 新字段，随笔迹一起持久化进 SVG；旧文件缺这个键 = 钢笔 |
| `InkStrokeStyle.opacity` | 0–1，渲染和导出都生效 |
| 笔刷覆盖 thinning | 荧光笔必须完全不随压感变粗细，否则不像荧光笔 |
| 笔刷不覆盖 pen/mouse 的 smoothing | 鼠标输入需要更多平滑才像人画的 |
| 默认钢笔 = 原版数值 | `buildInkStrokeStyleForTreatAs` 在无 brush 时逐位复现上游，旧画不会变形 |

**验证**：单测 11 项覆盖参数映射与上游一致性（`tests/logic/brush-presets.test.ts`）；`tsc` 0 错误。

**风险**：SVG 导出此前把所有笔迹烘焙成黑色，导致"选了颜色但保存后全黑"。已改为按笔迹实际颜色导出，`currentColor` 回退黑色。

---

### ✅ 2. 在 PDF 上批注

**可行性**：中。**状态：已实现（第 2 轮，方案 C）**。

已落地的两条能力：

| 能力 | 入口 | 实现 |
|:---|:---|:---|
| **任意图片作批注底图** | 手写/绘图块的「⋯」→ 设置页面背景图… | `InkCanvasSnapshot.background` + `<image>` 渲染层 |
| **PDF 当前页 → 批注页** | `Ctrl+P` → 在 PDF 当前页上批注 | 从 Obsidian PDF 视图取 canvas → PNG → 新建手写块并把 PNG 设为背景 |

**为什么是"页面快照"而不是"叠加在 PDF 视图上"**：叠加需要接管 Obsidian 的 PDF 渲染器，版本一升级就失效。快照方案把 PDF 页变成一张图，矢量笔迹独立存在——同样的使用动线，零耦合。

**背景烘焙（第 3 轮补完）**：锁定后的预览 SVG 现在**含背景图**。

| 实现点 | 做法 |
|:---|:---|
| 不改所有导出函数为 async | 新增 `BakedBackground {markup,width,height}`，由 `bake-background.ts` 异步产出，再交给同步渲染器拼接 |
| 体积控制 | 页面重采样到宽 ≤1400px、JPEG q=0.82（先在白底上压平透明） |
| 性能 | 按 `(path, mtime, width)` 缓存 8 条；只有换图后第一次保存付代价 |
| 失败降级 | 图片读不出来 → 退回纯笔迹 SVG，**保存永不因背景失败** |
| 转录不受污染 | 转录路径**故意不烘焙背景**——否则 PDF 上的印刷文字会被当成手写一起转录 |

**第 4 轮重构：改用官方 `loadPdfJs()`**

上一轮的实现是抓 PDF 视图的 canvas。第 4 轮查 `obsidian.d.ts` 时发现官方导出了：

```ts
export function loadPdfJs(): Promise<any>;
```

这改变了整个方案的可靠性等级：

| 维度 | 旧（抓 canvas） | 新（`loadPdfJs`） |
|:---|:---|:---|
| 可渲染页 | **只有当前可见页** | 任意页 |
| 分辨率 | 受视图缩放影响 | 固定 2×（A4 → ~1224×1584） |
| DOM 变化风险 | 高（改结构就失效） | 无 |
| 白底 | 需自己填 | 已填白底再渲染 |

**多页批注**：命令现在弹出页码输入，支持 `1-3,5`、全角逗号与波浪线、逆序范围自动归一、越界页码**直接丢弃而非钳制**（把 `99` 悄悄变成"最后一页"会静默批注错页）。

**命令可在 PDF 视图触发**：改用 `callback` 而非 `editorCallback`。后者在 PDF 视图获得焦点时会被 Obsidian 完全隐藏——而那正是最想用这个命令的时刻。现在会自己找一篇打开的笔记作为插入目标。

**多页自动成组**：一次批注多页时，插入一个 `### 讲义名` 标题 + `> 批注页码: 1, 2, 3` 引用块，避免散落成一堆无关联的嵌入。

**来源追溯（第 3 轮）**：批注块记录 `sourcePdf {path, page}`，溢出菜单「打开源 PDF」可跳回。背景是扁平图片之后，没有这条信息就无法回溯原始 PDF。

**验证**：TS 0 错误；背景渲染在 camera group 内随缩放平移；`bakeBackgroundForSvg` 已在产物中确认。

---

### ⚠️ 3. 透明叠加书写

**可行性**：高。**状态：已满足（第 3 轮复核结论）**。

第 3 轮重新核对后，把这一项判定为**已达成**，理由是"透明叠加"的三种真实形态都成立：

| 形态 | 实现 | 位置 |
|:---|:---|:---|
| 笔迹叠在已有笔迹上不遮挡 | 荧光笔 opacity 0.32、蜡笔 0.72 | `brush-presets.ts` |
| 笔迹叠在图片/PDF 页上 | 背景层 + 矢量笔迹独立 | `background-image.tsx` |
| 嵌入本身不占白底 | 写作嵌入默认无背景色，笔迹直接落在笔记背景上 | 既有样式 |

**明确不做的**：把整个手写块 `position: absolute` 悬浮到正文之上。那会脱离文档流、遮挡正文点击，是排版危害而非功能增强。如果将来确实需要"盖在某段文字上"，正确做法是把它做成该段落的背景层（已有能力），而不是浮动块。

| 层级 | 是否已有 | 说明 |
|:---|:---|:---|
| 单笔迹半透明 | ✅ 已实现 | 荧光笔 `opacity: 0.32`，渲染与导出都生效 |
| 整块叠加到别的内容上 | ❌ 未实现 | 需要嵌入容器背景透明 + 宿主元素 `position: absolute` |

"透明叠加"的完整形态是：手写块悬浮在正文上方，笔迹半透明，能看见底下的字。这需要改嵌入的定位模型（`position: absolute` + 无边框 + 背景透明），风险是挡住正文的点击。

**结论**：单笔迹透明已经能做到"写的时候不遮住已有笔迹"，这一项的核心体验已覆盖。整块叠加优先级低于 PDF 批注。

---

### ✅ 4. 围绕上述方向超越原版

见本文档其余条目。当前已超越的点：多笔触、彩色笔迹导出、转录可编辑、转录镜像、AI 题注（进行中）、Excalidraw 导出、快捷插入。

---

### ✅ 5. 快捷键与右键菜单插入书写块

**可行性**：高。**状态：已实现（第 1 轮）**。

| 入口 | 实现 |
|:---|:---|
| 快捷键 | 新建手写 `Mod+Shift+H`、插入已有手写 `Mod+Shift+O`、新建绘图 `Mod+Shift+D`、插入已有绘图 `Mod+Shift+I` |
| 编辑器右键 | 四条命令加入 `editor-menu`，独立分组 `ink-insert`，不与剪切/复制混在一起 |

**一个已澄清的误判**：上一轮曾以为"命令面板里没有新建手写块"是 bug。实际原因是这四条命令用 `editorCallback` 注册，Obsidian 规定没有 Markdown 编辑器获得焦点时**不显示**。这是设计，不是缺陷。

**验证**：`tsc` 0 错误；快捷键字段随命令注册，用户可在「设置 → 快捷键」中改绑。

---

### ✅ 6. 转录的渲染与编辑

**可行性**：高。**状态：已实现（第 1 轮）**。

三层文本的实际状态（已核实）：

| 层 | 位置 | 渲染 | 可编辑 | 可搜索 |
|:---|:---|:---:|:---:|:---:|
| alt | `.md` 的 `![...]` | ❌ 纯文本单行 | ✅ | ✅ |
| transcript | `.svg` 的 `<metadata>` | ✅ 块内 `MarkdownRenderer` | ✅（本轮新增） | ❌ |
| 笔迹 | `.svg` 的 path | ✅ 图像 | ✅ | ❌ |

本轮新增：**左上角铅笔按钮 → 编辑弹窗 → 写回 SVG metadata + 同步所有笔记的 alt**。

**关键保护**：保存后写入 `transcriptEditedAt`。此后**自动转录永不覆盖**你的修改（否则模型把「己」认成「已」，下次关掉嵌入就被改回去了）。想恢复机器版本，点一次「识别」即可，那会清除标记。

> ⚠️ **第 6 轮更正**：这个保护从第 1 轮起实际上**一天都没生效过**——`buildFileStr()` 没有把 `transcriptEditedAt` 序列化进 `<ink>` 属性，标记写入内存后就被丢弃了。已修复，并有 9 项往返测试锁住。详见第四章 Bug C。

**验证**：写回链路复用既有的 `saveWriteFileTranscript`（会保留 mtime，不触发同步风暴）；编辑弹窗支持 `Ctrl/Cmd+Enter` 保存。

---

### ✅ 7. 转录默认复制到下方

**可行性**：高。**状态：已实现（第 1 轮）**。

设置项「在嵌入下方同步转录文本」，默认**关闭**（自动往笔记里加内容是很强的副作用，不能默认开）。

开启后的行为：转录完成时，在嵌入行下方插入一个折叠 callout：

```markdown
![alt](<Ink/Writing/xxx.svg>) [Edit Writing](obsidian://...)

<!-- bimo:transcript:start -->
> [!note]- 转录
> 第一行
> 第二行
<!-- bimo:transcript:end -->
```

- 再次转录时**只替换标记之间的内容**，周围正文一个字节都不碰
- 删掉这个块就停止同步
- 手动入口：溢出菜单「在下方插入转录」

**验证**：`syncTranscriptBlockInMarkdown` 是纯函数（可单测）；打开中的笔记走 CodeMirror `dispatch`，不进撤销历史。

---

### ✅ 8. AI 自动写题注

**可行性**：高。**状态：已实现（第 2 轮）**。

设置项「AI 自动生成题注」，默认关闭（每页多一次请求）。

| 子决策 | 最终方案 | 理由 |
|:---|:---|:---|
| 题注写哪 | 图片 alt | alt 是 Obsidian 唯一索引的部分，写"这张纸写了什么"比塞全文摘要更有用 |
| 独立调用还是合并 | **独立调用** | 合并成 JSON 会污染已验证的转录输出格式，且解析失败会连转录一起丢 |
| 失败怎么办 | 回退为转录摘要 | 题注是增强，不能让它拖垮转录 |

`cleanCaption()` 处理了模型的三类毛病：包引号、加「题注：」前缀、答成 Markdown 标题；同时剔除会破坏 alt 语法的 `[ ] |`。

**验证**：`cleanCaption` 8 项单测（含三种引号、前缀、截断、非法字符）。

**成本提醒**：开启后每页 2 次请求（转录 + 题注）。想省钱就关掉。

---

### ⚠️ 9. 魔法面板（AI 交互 / 手写体 / 浮现式）

**可行性**：中（分阶段）。**状态：L1 已实现（第 2 轮），L3 部分实现，L2 未开始**。

**已落地的 L1 + L3**：

| 能力 | 实现 |
|:---|:---|
| 入口 | 命令「魔法页边」；手写/绘图块溢出菜单「问问页边」（自动带上该页转录作上下文） |
| 多轮对话 | provider 层新增 `history`，Chat Completions 与 Responses 两套格式都支持 |
| 语气 | system prompt 强制第一人称、≤120 字、禁 Markdown 标题/列表、公式用 `$...$` |
| 浮现感 | 回复**逐字打出**（16ms/2 字符），点一下跳过；羊皮纸底色 + 横线 + 楷体字栈 |
| 落地 | 「插入最后一条」把回复写进光标处，不自动改笔记 |

**为什么坚持"逐字出现"**：一段文字瞬间出现会被读成"电脑答的"，逐笔出现才被读成"写上去的"。这是"魔法日记"感里成本最低、收益最直接的一环。

**L2（真笔迹描摹）仍未做，且第 3 轮复核后判定"当前不划算"**：

技术上要做出"AI 真的在纸上写字"，链路是：字体轮廓 → 沿轮廓采样成笔迹点 → 逐笔写入 `InkStroke`。但浏览器**拿不到字体轮廓**——Canvas 只能量宽高、画像素，`measureText` 不返回 path。要拿到轮廓必须引入 `opentype.js`（约 200 KB）+ 一个开源手写字体文件（霞鹜文楷完整版 >10 MB，子集化也要几百 KB）。

这与当前"零新增运行时依赖"的取舍直接冲突。三个替代方案的实测权衡：

| 方案 | 效果 | 代价 |
|:---|:---|:---|
| 楷体 CSS 字栈 + 逐字浮现（**已实现**） | 有手写气质，不是真笔迹 | 0 |
| Canvas 渲染文字 → 像素 → 轮廓提取 → 笔迹 | 是真笔迹，但边缘毛糙、字重丢失 | 工程量大、效果差 |
| opentype.js 取轮廓 → 笔迹 | 最接近"真的在写" | +依赖 +字体体积；每个汉字 1–3 KB 矢量 |

**结论**：除非明确接受"装一个字体大小的体积"，否则维持当前方案。如果要做，最小可行版是**只子集化常用 3500 字**，字体约 1.5 MB，加上 opentype.js，插件体积翻倍。

用户要的是「写一句 → AI 回应 → 像哈利波特魔法日记那样浮现」。拆成三层，每层都能独立交付：

| 层 | 内容 | 难度 | 可独立交付 |
|:---|:---|:---|:---|
| **L1 交互** | 手写块旁边一个输入条，输入文字 → 调模型 → 结果显示成"手写体"文本 | 低 | ✅ |
| **L2 手写体渲染** | 把手写字体渲染成**真的 SVG 笔迹**，写进画布，不是贴字体 | 中 | ✅ |
| **L3 浮现动效** | 笔迹逐笔出现（stroke-dasharray 动画），配合纸张纹理与轻微渐显 | 中低 | ✅ |

**L2 的关键技术判断**：不要用 CSS 字体伪装手写。要做成"AI 真的在纸上写字"，需要：
1. 取一套手写体字形的**轮廓路径**（SVG path）
2. 按字符顺序，用 perfect-freehand 把每条轮廓退化成一笔笔"描摹轨迹"
3. 逐笔加入 `InkStroke` 存储

技术上可行（字体 → opentype.js 取 glyph path → 轮廓点采样 → 生成笔迹），但需要一个字体文件（可打包开源手写字体如「霞鹜文楷」的轮廓）。

**建议顺序**：L1（一周内可交付）→ L3（动效复用 L1 的文本结果）→ L2（字体描摹，工作量最大）。

**风险**：L2 生成的笔迹会显著增加文件体积（每个汉字约 1–3 KB 矢量）。

---

### ✅ 10. 公式 / 函数由 AI 画出来

**可行性**：高。**状态：已实现（第 2 轮）**。

命令「AI 画函数图像」：输入「y = sin(x)/x, -10 到 10」或纯文字描述 → 模型只返回 `{expr, domain, title}` → **本地采样 480 点并生成 SVG** → 存到 `Ink/AI/` → 插入 `![[...]]`。

三条硬性设计：

| 设计 | 原因 |
|:---|:---|
| 模型只给表达式，不给 SVG/点/代码 | 精度 100% 由本地控制；模型写坏 SVG 也不可能发生 |
| 表达式走**标识符白名单**（只有 `x`、`Math`、数学函数名） | 防注入：`while(true)`、`document.cookie`、`require` 全部拒绝 |
| 采样前先编译校验 + 拒绝非 ASCII | "抱歉，我无法处理这个请求"这类回答会被识别为无效，而不是画出一条空图 |

**断点处理**：`1/x` 这类极点在 2%–98% 分位之外的点会被截断并断线，否则一条渐近线会把整张图压成平线。

**验证**：17 项单测（注入拒绝、`^`→`**`、`sin(` → `Math.sin(`、极点断线、反向域归一、无 NaN、标题转义）。

先回答"ob 的页面支持吗"——**支持，且分两条完全不同的路径**：

| 需求 | Obsidian 原生支持 | 结论 |
|:---|:---:|:---|
| 数学公式（`$E=mc^2$`） | ✅ MathJax | 直接插入即可，无需画 |
| Mermaid 图（流程图/时序图） | ✅ 内置 | ` ```mermaid ` 代码块 |
| 函数图像（`y=sin(x)/x`） | ❌ 没有绘图引擎 | **必须生成图片** |

函数图像的具体做法（按可靠性排序）：

| 方案 | 做法 | 优点 | 缺点 |
|:---|:---|:---|:---|
| **A. 生成 SVG 文件** | 模型返回 SVG 字符串 → 存成 `.svg` → `![[plot.svg]]` | Obsidian 原生渲染矢量，无限清晰 | 模型可能写出坏 SVG，需校验 |
| B. Mermaid `xychart-beta` | 模型返回 mermaid 代码 | 纯文本、可改 | 采样点少，曲线粗糙 |
| C. 生成 Python/matplotlib | 本地跑脚本出 PNG | 最精确 | 依赖 Python 环境，慢 |

**推荐 A**：模型只负责算点（返回 `[[x,y],...]` 数组），**由我们的代码生成 SVG 路径**。这样模型不可能写出坏 SVG，精度也完全可控。这是最稳的设计。

**验证**：生成 `y = sin(x)/x` 在 [-10,10] 的图像，检查零点与渐近线位置。

---

### ✅ 11. 转 Excalidraw / Mermaid

**可行性**：Excalidraw 高、Mermaid 中。**状态：两者均已实现（Excalidraw 第 1 轮，Mermaid 第 2 轮）**。

| 目标 | 性质 | 结论 |
|:---|:---|:---|
| **Excalidraw** | 纯几何转换，**不需要 AI** | ✅ 已实现 |
| **Mermaid** | 需要理解"图表达了什么"，**必须用 AI** | 设计已定，未实现 |

**Excalidraw 实现细节**：每条笔迹 → 一个 `freedraw` 元素，保留原始点位、压感、颜色、不透明度。输出 `.excalidraw` JSON 文件，Obsidian 的 Excalidraw 插件可直接打开，且每笔可独立选中移动。

> 注意：Excalidraw 用自己的笔迹渲染算法，形状不会像素级一致，但结构完全可编辑。这正是"转"的价值——不是截图，是可编辑对象。

**Mermaid 的正确做法**：不能从笔迹几何反推图形语义（除非写形状识别，成本极高）。应当：**把绘图截图发给视觉模型 → 让它输出 mermaid 代码 → 插入代码块**。这是"理解"而非"转换"。

**已实现**：绘图块「⋯」→ 转为 Mermaid。图片走与转录相同的 PNG 栅格化，输出经 `cleanMermaidCode()` 清洗：去 ``` 围栏、丢掉围栏外的客套话、强制首行必须是图表声明、识别 `NOT_A_DIAGRAM`。

**风险**：模型对复杂手绘图的理解准确率有限，必须允许用户手改生成的代码（所以插入代码块而不是图片）。

**验证**：Excalidraw 10 项单测（坐标归一、颜色、透明度、确定性输出）；Mermaid 8 项单测（围栏剥离、前置/后置散文剔除、多种图表族、无声明时返回 null）。

---

## 三、优先级排序（第 9 轮重排）

| 顺序 | 待办 | 类型 | 理由 |
|:---:|:---|:---|:---|
| 1 | **让 Obsidian 真正加载新代码** | 必须人工 | `data.json` 停在 01:11，`main.js` 是 02:09 —— 运行中的插件仍是旧版本 |
| 2 | UI 层实测 | 需人工看 | 渲染、手势、菜单点击无法自动化 |
| 3 | 魔法面板 L2（手写体描摹） | 需决策 | 需引入依赖与字体，见上方权衡表 |
| 4 | 题注 / 函数图的批量入口 | 打磨 | 单条命令已够用 |

> 第 1 项是当前的硬阻塞：代码全部就位且通过 809 项测试，但运行中的进程是十轮前的版本。不重载，任何验证都无意义。

已移出待办：全书批注索引页、序列化审计（第 7 轮）、索引反向链接、模式转换背景（第 8 轮）、数据链路验证、文件落点统一（第 9 轮）。

已移出待办：**整块透明叠加**（第 3 轮判定已满足）、**背景烘焙**（第 3 轮）、**PDF 多页批注**（第 4 轮）、**背景失败反馈**（第 4 轮）、**PDF 页缓存复用**（第 5 轮）、**背景即时刷新**（第 5 轮）。

---

## 四、第 9 轮完成清单

这轮不加功能，做两件更重要的事：补上运行层面的验证，并修一个会影响文件落点的结构缺陷。

| 项 | 文件 | 验证 |
|:---|:---|:---|
| **无头端到端测试** | `tests/integration/ink-file-lifecycle.test.ts` | 3 项 |
| **索引 IO 集成测试** | `tests/integration/annotation-index-io.test.ts` | 5 项 |
| **修复：PDF 页 / 函数图写到错误的目录** | `pdf-paths.ts`、`annotation-index.ts`、`figure-insert.ts` | tsc 0 错误 |

### 无头集成测试为什么必要

第 5–7 轮的三次 bug 有同一个形状：**内存对象正确，磁盘内容错误**。每层单测都通过，因为它们各自"看起来正确"。

所以这轮用内存 vault（真实 `TFile` 实例 + `Map<string,string>`）驱动真实的序列化函数，按用户实际会产生的顺序跑：

```
创建文件（含行高）
  → 设置背景
  → 画一笔保存
  → 转录（文本 + 指纹 + 手改标记）
  → 再画一笔再保存
```

每一步都从磁盘内容重新解析并断言。覆盖的三个历史失效点：

| 轮次 | 曾经丢什么 | 现在的断言 |
|:---|:---|:---|
| 第 5 轮 | `background` / `sourcePdf` | 第一次保存后仍在 |
| 第 6 轮 | `transcriptEditedAt` | 转录后能读回，再保存后仍在 |
| 第 7 轮 | `writingLineHeight` | 读回 150 |

另有一项断言「保存不会用 stub 替换整篇 SVG」，防止把 `<svg>` 重建成空壳。

### Bug F：PDF 页图和函数图写到了错误的目录

之前的实现硬编码：

```ts
const PDF_PAGE_FOLDER = 'Ink/PDF';
const FIGURE_FOLDER = 'Ink/AI';
```

但手写块的真实位置由 `getBaseAttachmentPath()` 决定。这个 vault 的配置是：

```
_system/attachments/Ink/Writing/...
```

也就是说，PDF 页图和函数图会落到 **vault 根目录下一个全新的 `Ink/` 树**，和手写块彻底分家——用户想清理时会在两个地方各找到一半。

修复：新增 `resolveInkRootFolder(plugin, instigatingFile)`，复用与写作文件完全相同的四个 helper：

```
getObsidianAttachmentFolderPath → getBaseAttachmentPath
  → getWritingSubfolderPath（取首段 'Ink'）→ normalizePath
```

于是三种文件落在同一棵树：

```
<base>/Ink/Writing/    手写块
<base>/Ink/PDF/<hash>-<讲义名>/   页面图 + index.md
<base>/Ink/AI/         函数图
```

### 一个测试替身踩的坑

索引 IO 测试最初红了两项（合并把旧条目吃掉）。原因不是产品 bug，而是我用 `{ path } as TFile` 造假文件，而产品代码分支是 `instanceof TFile` —— 假对象走了"创建新文件"分支，把整个索引覆盖了。

改成 `new TFile()` 后立刻正确。这条已写进测试注释：`instanceof TFile` 是真实分支点，不能让替身绕过它。

### 现场核对：插件尚未被重新加载

读 `data.json` 时发现：

| 事实 | 值 |
|:---|:---|
| `data.json` 最后修改 | 01:11:54 |
| 部署的 `main.js` | 02:09:51 |
| `insertTranscriptBelowEmbed` | **不存在** |
| `aiCaptionOnTranscribe` | **不存在** |

说明 **Obsidian 从第 2 轮之后就没有再加载过新代码**。磁盘上的 `main.js` 一直是新的，但运行中的插件还是旧版本。

这不影响代码正确性，但意味着：**此前所有"已部署"都只代表文件已就位，不代表已运行**。

---

## 五、第 8 轮完成清单

这轮把前几轮留下的两处"功能对但不完整"补上了。

| 项 | 文件 | 验证 |
|:---|:---|:---|
| 模式转换保留背景图 | `convert-ink-canvas-between-modes.ts`、两个 `convert*FileTo*` | tsc 0 错误 |
| 批注块回到索引 | `writing-editor.tsx` 菜单项 | 产物 `Open annotation index`×2 |

### 模式转换此前会丢预览里的底图

写↔绘图转换走的是 `convertWriteInkCanvasDataToDraw` 这类纯函数：

```ts
const svgString = renderStrokesToSvg(strokes, snapshot);  // 没传 background
```

`snapshot.background` 通过展开运算符保留在元数据里，但重新渲染的预览 SVG 不含页面图。结果：转换后锁定态看不到底图，要等下一次编辑器保存才会被烘焙补上。

修法是让包装层（已经是 `async`）先把图烘好，再传给纯函数：

```ts
const baked = background
  ? await bakeBackgroundForSvg(plugin.app, background, background.width)
  : undefined;
const converted = convertWriteInkCanvasDataToDraw(data, gridEnabled, baked);
```

纯函数保持同步，只是多了一个可选参数——和第 5 轮处理导出时同样的拆分方式。

### 批注块 → 索引

批注块菜单新增「打开批注索引」，路径由 `sourcePdf` 推导：

```
sourcePdf.path → pdfCacheFolder() → index.md
```

没有 `sourcePdf` 的块（普通手写）会提示"不是从 PDF 创建的"，而不是静默无反应。

---

## 六、第 7 轮完成清单

按上一轮定下的方法（逐字段查"写端 / 序列化 / 读端"），这轮把 `InkFileMetadata` 过了一遍。

| 项 | 文件 | 验证 |
|:---|:---|:---|
| **审计测试：每字段一个往返用例** | `tests/logic/ink-meta-field-audit.test.ts` | **8 项** |
| **修复：`writingLineHeight` 有写无读** | `extractInkJsonFromSvg.ts` | 同上 |
| 新建文件补齐 meta 行高 | `create-new-writing-file.ts`、`build-file-data.ts` | tsc 0 错误 |
| 纠正 `snapshot.camera` 的误导性注释 | `ink-canvas/types.ts` | — |
| **全书批注索引页** | `logic/pdf/annotation-index.ts`、`pdf-paths.ts` | **13 项单测** |

### 审计结果

| 字段 | 写端 | 序列化 | 读端 | 结论 |
|:---|:---:|:---:|:---:|:---|
| `pluginVersion` | ✅ | ✅ | ✅ | 正常 |
| `fileType` | ✅ | ✅ | ✅ | 正常 |
| `transcript` | ✅ | ✅ `<transcript>` | ✅ | 正常 |
| `bboxCellsAtLastTranscription` | ✅ | ✅ | ✅ | 正常 |
| `lastTranscriptionAt` | ✅ | ✅ | ✅ | 正常 |
| `transcriptEditedAt` | ✅ | ✅ | ✅ | 第 6 轮修好 |
| `writingLineHeight` | ✅ | ✅ | ❌ | **本轮修复** |
| `tldrawVersion` | — | ❌ | — | 仅内存，移植 tldraw 用 |
| `previewIsOutdated` | — | ❌ | — | 仅内存，按笔画数推导 |

### Bug E：`writingLineHeight` 写进文件但读不回来

`extractInkJsonFromSvg` 有两个分支：

| 分支 | 读 `writing-line-height` |
|:---|:---:|
| `extractTldrawFormat`（旧 tldraw 文件） | ✅ 有 |
| `extractInkCanvasFormat`（当前格式） | ❌ **没有** |

也就是说：**旧格式文件能读出行高，新格式文件反而读不出**。

`convertDrawInkCanvasDataToWrite` 把行高写进 `meta.writingLineHeight` → 序列化成属性 → 读回时丢失 → 调用方回退到全局默认。

实际显示之所以没错，是因为 `snapshot.writingLineHeight`（在 `ink-canvas` JSON 里）是权威来源，meta 这条路是死路。但一条"写了却读不回"的路径会持续误导后来的修改。

修复：把读取逻辑抽成 `readWritingLineHeightAttr()`，两个分支共用。

### 索引页

多页批注现在会自动维护一个索引文档：

```
Ink/PDF/<hash>-<讲义名>/index.md
```

内容：

```markdown
---
title: Lecture 3 · 批注索引
date: 2026-10-23
tags:
  - ink/pdf
  - annotation
---

# Lecture 3 · 批注索引

源文件: [[讲义/Lecture 3.pdf|Lecture 3]]

<!-- bimo:pdf-index:start -->
- 第 1 页 → [[Ink/Writing/xxx.svg|第 1 页]]
- 第 3 页 → [[Ink/Writing/yyy.svg|第 3 页]]
<!-- bimo:pdf-index:end -->
```

三条设计约束：

1. **只改标记之间**——用户在索引页写的心得、补充链接都保留
2. **同页覆盖**——重新批注第 3 页，索引指向新的那个块，不堆旧链接
3. **按页码排序**——无论添加顺序

### 一个 i18n 细节

索引行里的页码标签用 `t('Page {n}')`，而不是 `t('Page label')` 再拼数字。

原因：本插件的英文模式是"key 即译文"，`t('Page label')` 在英文下返回字面量 `Page label`，`{n}` 不会被替换，索引里就只剩一个没有页码的行——而解析器也正是按数字匹配的，于是合并逻辑会静默失效。

把占位符写进 key 里，两种语言都能正确插值。

---

## 七、第 6 轮完成清单

第 5 轮修的是「静默丢数据」，这轮顺着同一条线索排查，又发现**两个同类型且更隐蔽的 bug**。

| 项 | 文件 | 验证 |
|:---|:---|:---|
| **修复：手改保护从未生效** | `buildFileStr.ts`、`extractInkJsonFromSvg.ts` | 9 项往返测试 |
| **修复：编辑器保存清空转录指纹** | `build-file-data.ts`、两个 editor 的 `inkMetaRef` | 同上 |
| AI 功能进编辑器右键菜单 | `main.ts#registerInkEditorMenus` | 产物 `ink-ai`×2 |

### Bug C：`transcriptEditedAt` 从来没被写进文件

第 1 轮承诺了「手改转录后自动转录不再覆盖」，实现是：

```ts
pageData.meta.transcriptEditedAt = new Date().toISOString();
```

但 `buildFileStr()` 生成的 `<ink>` 元素属性是**手写列表**：

```
plugin-version / file-type / writing-line-height /
bbox-cells-at-last-transcription / last-transcription-at
```

没有 `transcript-edited-at`。

于是：标记设进内存对象 → 序列化时被忽略 → 文件里没有 → 下次读取读不到 → 自动转录照常覆盖。

**这个保护从第 1 轮起就没有一天真正生效过。** 而且它不会报错——用户改完字，看到提示"转录已保存"，以为安全了。

修复涉及两端，缺一不可：

| 端 | 改动 |
|:---|:---|
| 写 | `buildInkElementAttributes` 输出 `transcript-edited-at` |
| 读 | `readBboxCellsAtLastTranscriptionAttrs` 读回该属性 |

### Bug D：编辑器保存清空转录指纹

`buildInkCanvasWritingFileData` 原本构造的 meta 只有四个字段：

```ts
{ pluginVersion, tldrawVersion, fileType, transcript }
```

`bboxCellsAtLastTranscription` 和 `lastTranscriptionAt` 每次保存都被抹掉。

后果：自动转录的「变化不足 20% 就不重跑」判定，每次画一笔就被重置为"无历史"→ 每次关闭都判定超过阈值 → 每次关闭都调一次 API。

修复：两个 builder 接受可选 `meta` 参数并展开合并；两个 editor 在加载文件时把 `data.meta` 存进 `inkMetaRef`，保存时原样传回。

`transcript` 的取值顺序是 `传入值 ?? 存量值`，避免"保存时没传 transcript"把已有转录清空。

### 9 项往返测试

`tests/logic/ink-meta-roundtrip.test.ts` 覆盖「构造 → 序列化 → 解析」全链路：

| 测试 | 锁住 |
|:---|:---|
| 指纹保留 | Bug D |
| 用户编辑标记保留 | Bug D |
| 显式 transcript 覆盖存量 | 合并优先级 |
| 无 transcript 时回退存量 | 不静默清空 |
| fileType / version 不被 meta 篡改 | 合并顺序 |
| 写入并读回 `transcript-edited-at` | Bug C 两端 |
| 指纹往返 | 既有行为不回归 |
| 背景页与 sourcePdf 往返 | 第 5 轮修复 |
| 未手改时不产生该属性 | 不制造脏属性 |

---

## 八、第 5 轮完成清单

这一轮修掉了一个**会让背景图直接消失的 bug**，并补上三处使用体验。

| 项 | 文件 | 验证 |
|:---|:---|:---|
| **修复：`getSnapshot()` 丢弃 background** | `ink-canvas/ink-svg-canvas.tsx` | 见下方专项说明 |
| 背景即时刷新（不重开就生效） | `ink-canvas/types.ts#setBackground`、`logic/ink-editor-registry.ts`、两个 editor 注册 | 产物 `setBackground:`×1 |
| PDF 页缓存复用 | `logic/pdf/pdf-page-to-image.ts` | 固定路径 `p<page>@2x.png` |
| 背景浓淡调节 | `set-background.ts#cycleBackgroundOpacity` | 100/70/45/25% 循环 |
| 背景导出回归测试 | `tests/logic/svg-export-background.test.ts` | **7 项**：图层顺序、viewBox、字段往返 |

构建产物：`dist/main.js` 4.24 MB，md5 `1d527acf…` 与部署一致。i18n：315 键，缺失 0。全量单测：**771 通过**（较第 4 轮 +7）。

### 专项：那个会吞掉背景图的 bug

第 3 轮实现背景烘焙时，保存路径是：

```ts
const snapshot = editor.getSnapshot();          // ← 这里
const svg = await renderSnapshotSvg(snapshot);   // 有 background 才会烘焙
```

而 `getSnapshot()` 当时返回的是**手写的字段白名单**：

```ts
{ version, strokes, gridEnabled, writingLineHeight }
```

没有 `background`，也没有 `sourcePdf`。

后果：**打开一个带 PDF 底图的批注块，随便画一笔触发自动保存，metadata 里的 `background` 就被覆盖成不存在了** —— 底图消失，且不可恢复（除非重新设置）。

它不报错、不提示，只在第二次打开时才暴露。这正是第 3、4 轮我反复说"设置背景后需要重开才生效"的真正原因之一：不是渲染没刷新，是**数据已经被抹掉了**。

修复方式是让 `getSnapshot()` 带上两者，并加注释说明为什么不能省：

```ts
...(backgroundRef.current ? { background: backgroundRef.current } : {}),
...(sourcePdfRef.current ? { sourcePdf: sourcePdfRef.current } : {}),
```

`background` 改为 state（原先是从 `initialSnapshot` 每次渲染时读的常量），这样才能被 `setBackground()` 在运行时替换。

### 背景即时刷新

新增按文件路径登记活跃编辑器的注册表，同一个文件可能在多处同时打开（两篇笔记的嵌入 + 独立视图），所以每个路径维护一个 Set：

- 设置背景 → `applyBackgroundToOpenEditors()` → 所有打开该文件的编辑器立即换图
- 换图时同时 `invalidateBakedBackground()`，否则烘焙缓存还按旧图返回

### PDF 页缓存

页面图路径从「时间戳命名」改为**确定性路径**：

```
Ink/PDF/<路径hash>-<文件名>/p<page>@2x.png
```

同一页批注两次只产生一张图。路径 hash 用 djb2 取 7 位 base36，避免不同目录下的同名 PDF 互相覆盖。

代价明确：**PDF 内容更新后，旧页面图不会自动重生**。删掉那个文件夹即可强制重渲染。

---

## 九、第 4 轮完成清单

| 项 | 文件 | 验证 |
|:---|:---|:---|
| PDF 渲染改用 `loadPdfJs()` | `logic/pdf/pdf-page-to-image.ts`（重写） | 产物含 `loadPdfJs`×2 |
| 多页批注 + 页码解析 | `logic/pdf/pdf-page-selection.ts` | **13 项单测** |
| 命令可在 PDF 视图触发 | `main.ts#findMarkdownEditor` + `callback` | tsc 0 错误 |
| 多页自动成组 | `pdf-page-to-image.ts` 标题/引用块 | — |
| 背景读取失败提示 | `ink-canvas/bake-background.ts#warnBackgroundUnreadable` | 每次会话每路径一次 |

构建产物：`dist/main.js` 4.24 MB，md5 `76f295d9…` 与部署一致。i18n：312 键，缺失 0。全量单测：**764 通过**（较第 3 轮 +13，失败数与基线一致）。

---

## 十、第 3 轮完成清单

| 项 | 文件 | 验证 |
|:---|:---|:---|
| 背景烘焙进导出 SVG | `ink-canvas/svg-export.ts`（`BakedBackground`）、`ink-canvas/bake-background.ts`、两个 editor 的保存流程 | tsc 0 错误；产物含 `bakeBackgroundForSvg`/`createImageBitmap` |
| 转录不吃背景 | 两个 editor 的 `handleTranscribe` 显式注释并保持 ink-only | 代码路径分离 |
| PDF 来源追溯 | `types.ts#sourcePdf`、`set-background.ts`、`pdf-page-to-image.ts`、菜单「打开源 PDF」 | 产物 `sourcePdf`×7 |
| 新命令热键 | `main.ts`：魔法页边 `Mod+Shift+M`、画函数 `Mod+Shift+F`、PDF 批注 `Mod+Shift+P` | 产物确认 |
| 项 3 复核 | 结论写入本文档 | — |

构建产物：`dist/main.js` 4.23 MB，md5 `52141ce2…` 与部署一致。i18n：303 键，缺失 0。全量单测：751 通过（失败数与基线一致）。

---

## 十一、第 2 轮完成清单

| 项 | 文件 | 验证 |
|:---|:---|:---|
| AI 题注 | `logic/ai/caption.ts`、`client.ts`、`build-embeds.ts`、queue 接线 | 8 项单测；设置项 + 迁移 |
| 函数绘图 | `logic/ai/expression.ts`、`figure.ts`、`figure-insert.ts`、`PromptModal` | 17 项单测 |
| 魔法面板 | `modals/magic-panel/`、`logic/ai/magic-prompt.ts`、provider `history` | tsc 0 错误；多轮请求体已构造 |
| 背景图层 | `ink-canvas/background-image.tsx`、`types.ts`、`logic/background/set-background.ts`、`image-picker-modal` | 渲染在 camera group 内 |
| PDF 页批注 | `logic/pdf/pdf-page-to-image.ts` + 命令 | 脆弱点已标注 |
| Mermaid | `logic/ai/mermaid.ts` + 绘图菜单 | 8 项单测 |
| 新增笔触 | `brush-presets.ts`（细线笔、蜡笔） | 11 项单测（遍历校验） |

构建产物：`dist/main.js` 4.23 MB，md5 `544ac953…` 与部署文件一致。

i18n 覆盖率：`node ../bimo-dev/check-i18n.js` → **301 个 `t()` 键，缺失 0**（第 2 轮补了 6 条设置区块说明）。

全量单测：751 通过 / 1 失败 / 15 套件失败 —— 与第 1 轮基线完全一致（均为上游 mock 缺 `PluginSettingTab` 与一处过时的 `stroke-opacity` 断言）。

---

## 十二、第 1 轮完成清单

| 项 | 文件 | 验证 |
|:---|:---|:---|
| 笔触系统 | `ink-canvas/brush-presets.ts`、`stroke-presets.ts`、`types.ts`、`svg-export.ts`、`tools/draw-tool.ts` | 单测 11 项；tsc 0 错误 |
| 笔触 UI | `jsx-components/brush-menu/`、`drawing-menu/ink-canvas-drawing-menu.tsx` | 构建通过 |
| 快捷键 + 右键菜单 | `main.ts`（4 条命令 + `editor-menu`） | tsc 0 错误 |
| 转录可编辑 | `modals/transcript-edit-modal/`、`ink-transcript-view.tsx`、3 个 embed 调用点 | tsc 0 错误 |
| 转录镜像 | `logic/transcript-block.ts`、`settings-tab.ts`、两个 editor 的溢出菜单 | tsc 0 错误 |
| Excalidraw 导出 | `logic/export/excalidraw-export.ts`、`export-actions.ts` | 单测 10 项 |

构建产物：`dist/main.js` 4.0 MB，md5 已核对与部署文件一致。

---

## 十三、已知问题与待办

| 问题 | 状态 |
|:---|:---|
| ~~锁定态看不到背景图~~ | **已解决（第 3 轮烘焙）** |
| ~~手改转录保护不生效~~ | **已解决（第 6 轮）**：`transcriptEditedAt` 现在会写进 `<ink>` 属性并能读回 |
| ~~编辑器保存清空转录指纹~~ | **已解决（第 6 轮）**：`meta` 透传 + `inkMetaRef` |
| ~~其他 meta 字段可能同样缺写端~~ | **已审计（第 7 轮）**：8 个字段逐个核对，仅 `writingLineHeight` 缺读端，已修 |
| `snapshot.camera` 无写入路径 | 已知：绘图视角由嵌入 viewBox 管理。注释已改为说明现状，避免误以为它生效 |
| ~~索引页不反向链接~~ | **已解决（第 8 轮）**：块菜单「打开批注索引」 |
| ~~模式转换丢预览底图~~ | **已解决（第 8 轮）**：包装层先烘焙再转换 |
| ~~PDF 页图 / 函数图写错目录~~ | **已解决（第 9 轮）**：统一走 `resolveInkRootFolder` |
| 运行中的插件是旧版本 | 已知：`data.json`（01:11）早于 `main.js`（02:09）。需在 Obsidian 里重载插件 |
| ~~设置背景后需重开该块才显示~~ | **已解决（第 5 轮）**：`setBackground` + 编辑器注册表，即时生效 |
| ~~保存一次就丢失 background~~ | **已解决（第 5 轮）**：`getSnapshot()` 原白名单漏了 `background`/`sourcePdf` |
| PDF 内容更新后页面图不重生 | 已知：缓存按 `(路径hash, page, scale)` 固定，删掉 `Ink/PDF/<hash>-<名>/` 可强制重渲染 |
| ~~背景图读取失败时无可见提示~~ | **已解决（第 4 轮）**：每会话每路径提示一次，失败不缓存以便文件的同步完成后自愈 |
| ~~PDF canvas 提取依赖 DOM 结构~~ | **已解决（第 4 轮）**：改用官方 `loadPdfJs()` |
| ~~PDF 一次只能批注当前可见页~~ | **已解决（第 4 轮）**：任意页码，支持 `1-3,5` |
| `loadPdfJs()` 在极旧版本 Obsidian 上不可用 | 风险：该方法在较新版本才公开。失败时给「无法打开这个 PDF」提示，不会崩溃 |
| 题注与转录是两次请求 | 已知，成本翻倍；设置里可关 |
| 魔法面板 L2 未做 | 计划中，见优先级第 3 |
| 新增英文文案是否都进字典 | 已用 `check-i18n.js` 校验：301 键，缺失 0。以后加文案跑一次即可 |
| 笔触在真机上的观感 | 未验证（需人眼在 Obsidian 里看） |
| Excalidraw 导出的实际打开效果 | 未验证（需装了 Excalidraw 插件） |
| 函数图 / Mermaid 的真实生成质量 | 未验证（需真实 API 调用） |
| 上游 Ink 更新需手动 merge | 长期问题，热点文件：settings / queue / main / 两个 editor |
| ~~工具栏三组按钮形状不一致~~ | **已按上游还原（第 18 轮）**：对照 `daledesilva/obsidian_ink` 的 `git diff HEAD`，根因不是「形状不统一」，而是**上游 `.ink_other-menu` 是空槽位（连 `gap` 都没有）**，本仓库往里放了 ✦ 魔法笔和笔刷两个按钮却没有规格，才退回 Obsidian 默认 button 盒。处理方式：quick / tool / extended 三组全部 `git checkout HEAD` 还原（tool 恢复正圆 2.5em），只给 `.ink_other-menu` 补 `gap: 8px` + 沿用 quick-menu 的 `2.5em / 0.8em` 规格。第 14 轮的全局变量与 6px gap 已删除。**教训：这一排的基准是上游文件，不是审美判断，改之前先 `git diff`** |
| 块内工具栏被改到块顶部 | **已按上游还原（第 18 轮）**：第 4 轮起 `writing-embed.scss` 把工具栏从「悬浮在块外」改成「块内顶部 + 46px padding + 分隔线」，配套改了 `primary-menu-bar.tsx` 和 `secondary-menu-bar.tsx` 的滚动补偿。用户要求回到作者的悬浮方案，三处已全部 `git checkout HEAD`，仅保留 `writing-embed.scss` 之外的块功能改动 |
| ~~PDF 批注强制要求先开笔记~~ | **已解决（第 14 轮）**：`ensureMarkdownTarget()` 优先用活动的 Markdown 视图，其次在 PDF 同目录建/复用 `{名} - Annotations.md`（后台打开，不抢焦点），最后才回退到任意已开笔记。`annotate-pdf-page` 改为 `async callback` |
| ~~批注无法跳回 PDF~~ | **已解决（第 14 轮）**：索引页每条目追加 `[[pdf#page=N\|PDF]]`；插入正文的 heading 追加 `在 PDF 中查看: [[pdf#page=N\|N]]`。新增命令 `open-pdf-annotation-index`（PDF 视图 → 批注索引，索引不存在时自动创建） |
| `upsertAnnotationIndex` 用 `getActiveFile()` 算 Ink 根 | **已修复（第 14 轮）**：新增 `instigatingFile` 参数，避免 PDF 在前台时索引落到讲义目录 |
| 批注目标笔记名写死 | **已解决（第 15 轮）**：设置新增「PDF 批注」一节——目标笔记模式（在 PDF 旁新建 / 始终用一个笔记）、命名模板（`{pdf}` `{date}`）、指定笔记路径、插入后前台/后台、批注副本后缀。逻辑在 `logic/pdf/annotation-target.ts`，单测 9 项 |
| 批注无法写回 PDF | **已撤回（第 16 轮，按用户要求）**：第 15 轮用 pdf-lib 做过一版 `export-annotated-pdf.ts`，但叠加对齐无法在真机确认，且 pdf-lib 让 bundle 从 4.1 → 4.9MB。整模块、命令、两个设置项、`pdf-lib` 依赖已全部删除，bundle 回到 4.1MB |
| PDF++ 选区无法变成可手写块 | **已实现（第 16 轮）**：`logic/pdf/pdf-plus-link.ts` 解析 `#page=N&rect=x1,y1,x2,y2`（PDF 用户空间，左下原点）；`renderPage` 新增 `cropCanvas` 做 Y 轴翻转裁剪，裁切图按 rect 哈希单独缓存；命令「从 PDF 选区创建批注块」读剪贴板完成交接。单测 10 项 |
| jest 的 obsidian mock 缺 `Plugin` / `PluginSettingTab` | **已修复（第 15 轮）**：`tests/__mocks__/obsidianMock.js` 补两个基类。此前 `migrate-legacy-ink-on-open` 和 `keyboard-handler` 两个套件因 import 链崩在 module scope，全量逻辑测试一直是 2 红 |
| 改完代码要重启 Obsidian 才能生效 | **已解决（第 17 轮）**：`logic/utils/reload-plugin.ts` 用 `app.plugins.disablePlugin()` + `enablePlugin()` 原地重载；设置页品牌头的徽章旁有「重载插件」按钮，命令面板也有「重载插件（开发用）」可绑快捷键。注意必须先 disable——对已加载的插件调 enable 是空操作，旧代码会继续跑 |
| 笔刷按钮在外侧、且是圆角方块 | **已解决（第 19 轮）**：`InkCanvasBrushMenu` 从 `.ink_other-menu` 移入 `.ink_tool-menu`，自动继承作者的 `border-radius: 2.5em` 正圆，与选择/画笔/橡皮同一组。副作用：`.ink_tool-menu button` 是后代选择器，会命中笔刷面板内的 brush/swatch/size 三个按钮，故在 `brush-menu.scss` 用 `.ink_tool-menu .ddc_ink_brush-panel button`（特异性 0,2,1 > 0,1,1）重置宽高与 padding，`.ink_tool-menu` 本身一字未改 |
| ✦ 与右侧 ✓/⋮ 不对齐 | **已解决（第 19 轮）**：`.ink_other-menu` 与 `.ink_extended-writing-menu` 是 `.ink_primary-menu-bar` 下的两个兄弟容器，前者 `flex-grow: 1` 贴住后者左缘，两者间距为 0，而 extended 内部是 `gap: 4px`，所以魔法笔看起来和另外两个方块不是一排。修法：`.ink_other-menu` 改 `gap: 4px` + `margin-right: 4px`，尺寸沿用 `2.5em / 0.8em`。未改 `primary-menu-bar.scss` 和 `extended-writing-menu.scss` |
| ✦ / ✓ / ⋮ 宽度与基线仍不一致 | **已修复（第 20 轮）**：根因是 `em` 的解析基准不同。按钮尺寸全写成 `2.5em`，但 `em` 相对**元素自身** `font-size` 解析，而 Obsidian 基础 `button` 规则会设 font-size，各组容器又没有统一值，于是同样的 `2.5em` 算出三种宽度。修法：`.ink_menu-bar` 显式 `font-size: var(--font-ui-medium, 1em)`，`.ink_menu-bar button` 设 `font-size: inherit` + `box-sizing: border-box` + `line-height: 1`。另补两处结构性缺陷：`.ink_extended-writing-menu` 缺 `align-items: center`（其兄弟 `.ink_other-menu` 有，两者基线因此不同）；`.ddc_ink_overflow-button-and-menu` 包着 ⋮ 却没有 `display:flex`，导致容器被行高拉伸。⋮ 在该容器内从作者的 `1.9em` 改为 `2.5em`（作者做窄是为按钮组省空间，单独立在 ✓ 旁边显得塌） |
| 笔刷按钮看不出含义 | **已修复（第 20 轮）**：原用 Material `BrushIcon`（斜向笔刷），与旁边的 Draw 图标语义重叠，在 1.5em 下只剩两团灰。改为**显示当前笔触本身**：一条跟随 `preferences.size` 粗细、`preferences.colour` 颜色、`activePreset.opacity` 透明度的横线，下方一个 chevron。用 `<span>` + `border` 画 chevron 而非 svg，因为 `.ink_tool-menu button svg` 强制所有 svg 为 `1.5em`。tooltip 从「笔刷」改为「笔触样式」（i18n 已加键） |
| 组件层测试 9 套件红 | **既有缺陷，非本轮回归**：`WritingEmbed*` / `DrawingEmbed*` 系列崩在 `use-ink-file-transcript.ts:25` 的 `.read`（`tests/__mocks__/obsidianMock.js` 没实现 `vault.getFileByPath().read()`）；`ConvertInkCanvasBetweenModes` 的失败是断言 `<line stroke-opacity="0.5">` 引导线没渲染，属渲染逻辑既有问题。本轮只改 scss / brush-menu markup / i18n，与这两处无交集。逻辑层 41 套件 471 项全绿 |
| 工具栏整体变大一圈 | **已修复（第 20 轮补）**：第 20 轮把 `.ink_menu-bar` 的 font-size 钉成 `var(--font-ui-medium)`，但按钮尺寸写的是 `2.5em`，`em` 随它缩放——Obsidian 的 `button` 默认用 `--font-ui-small`（13px），改成 medium（15px）等于每个按钮从 32.5px 涨到 37.5px，整排放大 15%。证据在作者自己的 `src/styles/ink-workspace-chrome.scss:20-25`：偏移量算的是 `2 * 2.5 * var(--font-ui-small)`，说明 2.5em 的基准就是 small。已改为 `var(--font-ui-small, 1em)`。教训：统一 `em` 基准时，要沿用作者假定的那个字号变量，而不是挑一个「看起来正确」的 |
| 笔刷面板七条预览线分不出区别 | **已修复（第 21 轮）**：旧公式 `height = max(2, round(sizeMultiplier * 2.4))` 把前三个压到同一档——钢笔 2.4→2px、铅笔 1.56→2px、细线笔 1.92→2px，三根一模一样的灰条。改为按 `kind` 直接给尺寸和头型（`.ddc_ink_brush-panel__stroke[data-brush=…]`），不再从 `sizeMultiplier` 推导：细线笔 1.5px 方头 / 钢笔 2.5px 圆头 / 铅笔 1.8px / 蜡笔 4.5px / 毛笔 6px 锥形 / 马克笔 7px 方头 / 荧光笔 11px 满宽。颜色改由 `preset.defaultColour` 决定，荧光笔因此显示真实的黄色而不是灰色叠加。标签字号 0.66em（≈8.6px）→ 0.82em（≈10.7px），颜色 `--text-muted` → `--text-normal`；卡片最小高度 3.2em → 3.7em 容纳荧光笔色带 |
| 「半透明 — 覆盖在已有笔迹之上」看不懂 | **已删除（第 21 轮）**：`activePreset.opacity < 1` 时在面板底部渲染的提示行。它解释的是「半透明」这个实现属性，而预览线本身已经按真实透明度画出来了，等于用一行字重复眼睛能看到的事，还让面板看起来少了一个控件。整块 JSX 与 `.ddc_ink_brush-panel__hint` 样式一并移除 |
| 色板与粗细两行「太小」 | **已修复（第 22 轮）**：根因不是尺寸写得小，而是第 19 轮为防圆形穿透加的 `.ink_tool-menu .ddc_ink_brush-panel button { width/height: auto !important }` **无差别命中面板里每一个按钮**，把 `.ddc_ink_brush-panel__swatch` 的 1.3em 和 `__size` 的 2.2em 一起压成 auto，色点只剩 1px 边框、粗细格子只剩内容宽度。修法：把那条重置收窄为 `... button.ddc_ink_brush-panel__brush`（只有笔刷卡片是卡片，不是按钮），通用块只留 `padding: 0`。同时做视觉调整：色板 1.3em → 1.75em 且 `justify-content: space-between` 铺满整行；粗细按钮 `flex: 1 1 0` + 高 2.7em，三等分同宽；两行 `padding-inline` 统一 0.6em，与上方笔刷网格左右对齐；圆点直径 `4 + size*1.6`（8/10/15px）→ `7 + size*2`（12/15/21px） |
| 面板子控件的 CSS 被祖先规则压住 | **教训（第 22 轮）**：`.ink_tool-menu button` 是后代选择器，凡是搬进 `.ink_tool-menu` 的组件，其内部所有 `<button>` 都会继承 2.5em 圆形。用一条大范围 `!important` 重置来"抵消"会把子控件原本的尺寸一起抹掉。正确做法是重置规则精确到需要重置的那一个类，而不是整个容器 |
| **笔记上书写完全无反应（用户实测）** | **已修复（第 25 轮）——四个叠加根因，缺一不可**：①`md-ink.scss` 里只有 `pointer-events: none`，注释写着「Only a drawing tool flips it to auto」，但**那条规则从来没写**，图层永远收不到 pointerdown；②`mdInkMouseDrawing` 默认 `false`，鼠标落笔在 `onPointerDown` 第一行就被 return，桌面用户必然踩中；③`resolveNotePath` 依赖 `leaf.view.editor.cm === view`，而 ViewPlugin 构造时 MarkdownView 通常还没把 editor 赋好，返回 null 后**没有任何重试**，笔记只要不被编辑就永远不挂载；④图层挂在 `.cm-content`（contenteditable）内，**CodeMirror 每次编辑重建该子树时会把外来节点一并删掉**——这是跨编辑测试抓到的，不是推测。修法：补 auto 规则（pen/highlighter/eraser/lasso，pan 不动）；默认值改 `true` 并用 `mdInkMouseDrawingMigrated` 标记做一次性纠正（用户显式关掉后不再覆盖）；`resolveNotePath` 增加 DOM leaf 回退 + 60ms×20 次挂载重试；图层改挂 `.cm-scroller`，`syncLayerSize` 里按 content 相对 scroller 的偏移 + 滚动量重算 left/top |
| 图层挂在 contentDOM 里会静默消失 | **教训（第 25 轮）**：CM6 的 `.cm-content` 是它自己渲染的文档子树，任何非它创建的节点都可能在下一次编辑时被清掉。手写层必须挂在 `.cm-scroller`（CM 不管辖、且仍是滚动坐标系）。判断方法是写一个「编辑后图层仍在」的运行时测试，静态检查看不出来 |
| 悬浮工具条位置固定、无法调整 | **已实现（第 25 轮）**：pill 本体即拖拽把手（按钮自身 stopPropagation，所以拖动只能从按钮间隙开始）。拖动时清 `right` 改 `left/top`，按 host 尺寸 clamp，松手写入 `localStorage`（笔记 `bimo-md-ink-pill-position`，PDF `bimo-pdf-ink-pill-position`），新建 overlay 时恢复并重新 clamp。CSS 加 `cursor: grab` / `.is-dragging` |
| 用户不知道要先选铅笔 | **已缓解（第 25 轮）**：默认工具仍是 pan（选 pen 会让图层全屏拦截、无法点选文字），但 pill 静息透明度 0.3 → 0.7，并在首次挂载时弹一次 Notice 说明「点铅笔书写、手掌切回编辑、工具条可拖动」（localStorage 标记，只弹一次） |
| 诊断命令看不出「挂载了但不可用」 | **已增强（第 25 轮）**：`diagnose()` 增加 `pe=`（图层的 computed pointer-events）与 `box=`（图层实际尺寸），命令侧追加 `enabled=` / `mouse=`。挂载成功但 `pe=none` 与 `box=0x0` 是两种完全不同的故障 |
| PDF 页面选择器单点失败 | **已加固（第 25 轮）**：`[data-page-number]` 为空时回退 `.pdfViewer .page` / `.pdf-container .page`，页码按文档序推断；`pageEl` 为 static 时补 `position: relative`，否则绝对定位的 SVG 会跑到远处祖先上 |
| **仍未验证** | 以上四条修复全部通过 jsdom 运行时测试（527 项）与产物规则核对，但**没有在真实 Obsidian 里跑过**：jsdom 的 `getBoundingClientRect()` 恒为 0，坐标换算与真实 pdf.js DOM 结构仍待用户实测确认 |
| PDF 页面探测只有一条选择器 | **已加固（第 26 轮）**：`findPageElements()` 三级回退——`[data-page-number]` → `.pdf-page / .pdfViewer .page / .pdf-container .page / .view-content .page` → **任何包含 canvas 的元素宿主**。第三级覆盖所有 pdf.js 布局，因为页面渲染必然有 canvas。新增 `tests/logic/pdf-ink-mount.test.ts` 6 项运行时断言：三种 DOM 结构各挂一次、页面补 `position: relative`、pen 下 `pointer-events=auto` / pan 下 `none`、destroy 清干净 |
| `getComputedStyle(...).position` 判空不严 | **已修复（第 26 轮）**：原判断只认 `=== 'static'`，但无样式表或 jsdom 环境返回空串，页面就拿不到定位上下文，绝对定位的 SVG 会跑到远处祖先上。改为 `!position || position === 'static'`。md 侧 `.cm-scroller` 同一处一并修正 |
| 切到工具条上双击没法复位 | **已实现（第 26 轮）**：pill 本体双击恢复默认角落——清 `localStorage` 里位置并从内联样式移除 `left/top/right`。拖动容易，撤销拖动不该需要翻设置。笔记与 PDF 各一份 |
| 插件重载后已打开的笔记没有图层 | **已修复（第 26 轮）**：`registerEditorExtension` 只影响之后创建的编辑器，已开着的笔记除非被编辑否则永不 update，也就永不重试挂载。新增 `watchActiveNotes()`：在 `active-leaf-change` / `layout-change` 时对活动 MarkdownView 的 `cm.dispatch({})` 发一个空事务，逼所有 ViewPlugin.update 重跑一次（重试逻辑就在 update 里）。从此不必关掉重开笔记 |
| PDF 诊断信息不足以区分故障 | **已增强（第 26 轮）**：`diagnose()` 输出 `pages / candidates / canvas / iframe / layers / box / pe / attached`。`candidates=0` 说明 DOM 完全没命中，`iframe>0` 说明 PDF 在 iframe 里（此路不通，需换方案），`layers>0 box=0x0` 说明挂上了但尺寸为 0，`pe=none` 说明指针没接管——四种故障对应四种改法 |
| **「还是写不了」的真正原因：插件根本没重载（第 27 轮定位）** | **诊断证据链**：①`.obsidian/community-plugins.json` 启用的是 `bimo`（不是同目录的 `ink`），部署位置正确；②`main.ts:366` 的 `loadSettings()` 在非新安装时**必定** `saveSettings()`，因此 `data.json` 的 mtime 就是最后一次插件加载时间——它是 **12:57**，而修复代码 13:14 才写入 `main.js`；③`data.json` 缺 `mdInkMouseDrawingMigrated`，该字段只在含迁移的新版本加载时写入；④`main.js` 里能搜到 `mdInkMouseDrawingMigrated` / `bimo-md-ink-pill-position` / `cm-scroller`，`node --check` 语法通过，说明产物完整。四条合起来：磁盘是新代码，进程是旧代码，用户实测跑的是修复前版本。**教训：用户报「还是不行」时，先证明新代码有没有进进程，再改代码**——否则会连续几轮在一个根本没被加载的版本上修 bug |
| 没有调试端口，无法从外部触发重载 | **确认无法自动**：`obsidian.exe` 启动参数无 `--remote-debugging-port`，`netstat` 无 9222 监听；Obsidian 是单实例，再启动带参数的新实例只会把参数转给已有实例后退出。插件代码只在加载时从 `main.js` 读取，改文件不触发重载。因此「重载一次」这一步**只能由人在 Obsidian 里完成** |
| 重载后仍要逐个切标签才有图层 | **已修复（第 27 轮）**：`watchActiveNotes()` 增加 `onLayoutReady` 启动时 `nudge()` + 900ms 后补一次，重载后的活动笔记立即挂载，无需切换标签。另加最后兜底 `resolveWithActiveFallback()`：20 次重试全部匹配不到 leaf 时，若该编辑器正是活动笔记的编辑器，直接用活动文件路径挂载 |
| 把从未被选择的设置值预置回来 | **已处理（第 27 轮）**：直接改写 `data.json`，`mdInkMouseDrawing: false → true` 并写入 `mdInkMouseDrawingMigrated: true`。这样即便迁移逻辑因任何原因没跑，重载后鼠标也能立刻书写 |
| 本轮验证范围（第 27 轮） | `tsc` 0 错误；逻辑层 **48 套件 / 534 项全过**；`main.js 8b055db5…`，dist 与部署 md5 一致；产物内 `Reattach the ink layer` 命中 2 次。**仍缺真机证据**——但这次阻塞点已从「代码可能有问题」收敛为「新代码尚未被加载」 |
| PDF 页面探测的「权威选择器」从真实插件中取得（第 28 轮） | **从 PDF++ 提取实证**：`pdf-plus/main.js` 里有 `d.target.closest("div.page[data-page-number]")`、`view.pdfViewer.dom.viewerEl`、`view.pdfViewer.pdfViewer`、`view.pdfViewer.pdfThumbnailViewer.container`。这说明真实 Obsidian PDF 视图的正确入口是 **`leaf.view.pdfViewer.dom.viewerEl`**，页面元素是 **`div.page[data-page-number]`**。此前用的裸 `[data-page-number]` 会同时匹配侧边栏缩略图 `div.thumbnail[data-page-number]`，首个命中若是缩略图，图层就会挂到无关位置。修法：`findPageElements()` 首选 `div.page[data-page-number]`；后备过滤 `.thumbnail`；`sync()` 优先把 `view.pdfViewer.dom.viewerEl` 作为扫描根；`diagnose()` 增加 `exact=` / `thumbs=` / `viewer=` / `viewerPages=` 四项 |
| `vscode-editor` 是否干扰 Markdown 书写（第 28 轮排除） | **排除**。`vscode-editor/main.js` 里 `cm-scroller` / `cm-content` / `cm-editor` 出现次数均为 **0**，manifest 描述为「Edit Code Files like VSCode」，只作用于代码文件，不碰 Markdown 编辑器 DOM |
| `handwriting` 插件是否与 bimo 抢指针事件（第 28 轮排除） | **排除**。`community-plugins.json` 启用列表里**没有** `handwriting`（目录存在但未启用）。此前「两插件打架」的假设不成立，不必让路 |
| 「写不了」无法从外部观测（第 28 轮解决） | **新增运行时诊断回传** `src/logic/md-ink/diagnostics.ts`：把实际操作中的 DOM 状态写入 vault 内的 `.bimo/diagnostics.txt`。内容包含每个 Markdown leaf 的 `scroller/content/layers/svg/pill/tool/pe/box/parent`，以及每个 PDF leaf 的 `pdfViewer/viewerEl/pages/exact/thumbs/viewerPages/canvas/iframe/layers/box/pe/pagePos`。触发时机：`onLayoutReady` + 每次 `layout-change`/`active-leaf-change`（3 秒防抖），另有命令「写出运行时诊断」。**意义：从此不必让用户读 Notice 复述，直接读文件即可区分「没挂载 / 挂载了但指针没接管 / 尺寸为 0 / 事件被吃」四种故障** |
| 用户不记得「要先点铅笔」（第 28 轮） | **已缓解**：`MdInkOverlay` 增加 `pencilHintResolved` 与 `updatePencilHint()`——只要当前工具是 `pan` 且本次会话从未选过别的工具，pill 加 `.is-hinting`，铅笔按钮做 1.8s 脉冲（`@keyframes bimo-md-ink-hint`，opacity 0.45↔1）。选中任意其他工具后永久停止。首次使用 Notice 已见过的情况下，这是新的提示通道 |
| 重载只能靠设置页关开（第 28 轮） | **新增独立通道**：`_system/templates/!reload-bimo.md`，Templater 模板（Templater 已启用，模板目录 `_system/templates`）。内容直接调 `app.plugins.disablePlugin('bimo')` + `enablePlugin('bimo')`，**不依赖 bimo 自身的重载命令**——即使那个命令失效也能用。命令面板 → Templater: Open Insert Template modal |
| 本轮验证范围（第 28 轮） | `tsc` 0 错误；逻辑层 **49 套件 / 542 项全过**（新增 `md-ink-diagnostics.test.ts` 8 项：空工作区不抛错、layer 有无可区分、tool/parent 可读、多笔记都列出、PDF 页面与缩略图可区分、viewerEl 有无都可读）；`main.js 37857183…`、`styles.css ffc5a621…`，dist 与部署 md5 一致；产物核对 `div.page[data-page-number]` 6 次、`bimo/diagnostics.txt` 5 次、`is-hinting` 1 次。**仍缺真机证据**，但这次诊断文件会把真机状态带回来 |
| **`.bimo/` 里三个 `strokes=0` 文件 = 第一手失败证据（第 29 轮）** | 现场检查 `.bimo/md-ink/7c858eda.json`、`.bimo/pdf-ink/72076d1b.json`、`86b0ef74.json`：**文件存在（12:58 创建）但 `strokes` 全是空数组**。结合 12:57 那版代码可还原完整因果链：`onPointerDown` 里 `if (pointerType === 'mouse' && !mouseDrawing) return;` 而当时 `mdInkMouseDrawing = false` → **鼠标落笔被直接丢弃，一笔都画不上**；文件之所以出现，是因为切换笔记时 `teardown()` **无条件** `storage.save(overlay.getDocument())`，把空文档写盘。用户"写不了"的判断由此得到实证，不再是推测 |
| **空文档会覆盖磁盘真实笔迹（第 29 轮修复，数据丢失级）** | 根因：`teardown()` 里 `void storage.save(this.overlay.getDocument())` 无任何条件；`loadFor()` 的 `replaceDocument(doc)` 也是无条件替换。前者在加载未完成时销毁 overlay 会把**空文档覆盖到真实文件上**；后者会删掉用户在异步读盘期间画下的笔迹。修法：新增 `hydrated` 标志，只有磁盘文档合并完成后才允许 `scheduleSave` / `teardown` 写盘；`loadFor` 改为 `hydrateFromDisk()`，本地已有笔迹时**合并而非替换**（`mergeMdInkDocuments` 纯函数，本地优先、按 id 去重）；切换文件时显式传 `replace=true` 并重置 `hydrated`，避免旧笔记笔迹串到新笔记 |
| 鼠标落笔被静默丢弃（第 29 轮修复） | `md-ink-overlay.ts` 与 `pdf-ink-overlay.ts` 两处 `mouseDrawing` 门槛都会直接 `return`，用户只看到"点了没反应"。新增 `explainMouseDrawingDisabled()`（一次性，`mouseDrawingNoticeShown` 守卫）：鼠标按下被拒时提示「鼠标绘制已关闭。在 bimo → 在笔记上书写 里打开「允许鼠标绘制」，或改用触控笔」 |
| PDF 图层被 textLayer 截走指针（第 29 轮修复） | pdf.js 的文本层同样是 `z-index: 2`，而原实现给的也是 `2`。z-index 相同时**后插入者在上**，而 pdf.js 每次重渲染都会重新 append 文本层 → 笔迹只在"下次滚动之前"能画。改为 `z-index: 3`，pen/highlighter 时 `pointer-events: auto` 接管、pan 时 `none` 放行文本选择 |
| **工具条滚动后消失（第 29 轮修复，这是"不能调整位置"的真正底因）** | 原实现 `position: absolute` 挂在 `.cm-editor` 上，而 `.cm-editor` 的高度等于**整篇文档**，所以 `top: 0.4em` 只在文档顶部有效——用户往下滚一屏，工具条就滚出视口，看起来像"没了/动不了"。改为 `position: fixed` 并**由 JS 设置坐标**：`restorePillPosition()` 把初始位置算到本编辑器可见区域的右上角（`requestAnimationFrame` 二次放置，避开刚 append 时 `offsetWidth = 0`）；拖拽全部改用视口坐标；新增 `clampPillToEditor()`，clamp 范围取**编辑器矩形与窗口的交集**而不是编辑器矩形本身（否则允许拖到视口外）。双击复位同样改为重新计算默认角落，而不是清空内联样式（清空会让 fixed 元素跑到窗口 0,0）。PDF pill 用 `.bimo-md-ink-pill--pdf { position: absolute }` 显式覆盖回来，因为它挂在固定尺寸的 `.view-content` 上 |
| 本轮验证范围（第 29 轮） | `tsc` 0 错误；逻辑层 **50 套件 / 547 项全过**（新增 `md-ink-hydrate.test.ts` 5 项：空本地取磁盘副本、读盘期间画的笔迹不被删、两侧不重叠时都保留、同 id 不重复、保留磁盘元数据；更新双击复位测试以匹配 fixed 定位）；`main.js 37da8e11…`、`styles.css d16903ee…`，dist 与部署 md5 一致；产物核对 `hydrateFromDisk` 2 次、`Mouse drawing is turned off` 2 次、`zIndex = "3"` 1 次、`.bimo-md-ink-pill { position: fixed }` 与 `.bimo-md-ink-pill--pdf { position: absolute }` 各自就位。**仍缺真机证据**，但失败链已从"猜"变成"三个空文件 + 一行 return" |
| **打破"无法验证"死结：独立 CDP 实例（第 30 轮）** | 六轮以来所有修复都卡在"改完无法进进程验证"。办法：用**独立 user-data-dir** 启动第二个 Obsidian，带 `--remote-debugging-port=9333`。第一步先用 PowerShell 写好 `obsidian.json`（`{"vaults":{"bimotest01":{"path":"D:\ErnestVault","open":true}}}`），否则新 profile 会停在库选择界面。之后用 Node 22 的全局 `WebSocket` 连 CDP，`Runtime.evaluate` 取状态、`Input.dispatchMouseEvent` 派发**真实指针事件**、`Page.bringToFront` 尝试前置。**关键坑**：Git Bash 里 `exe &` 启动的子进程会随命令结束被杀，必须用 `Start-Process`。验证完必须 `Stop-Process` 按 `CommandLine -like '*9333*'` 精确回收，并恢复 `workspace.json` |
| **MD 手写实际可用（第 30 轮实测）** | 真实鼠标事件跑到 `_system/bimo-test.md` 上，`g.bimo-md-ink-strokes` 里出现 **5 条 `path`**（`d` 长度 665 / 2074 / 2178 / 1283 / 1805），`.bimo/md-ink/*.json` 同步落盘。图层 `layers=1 svg=1 pill=1`，切到 pen 后 `data-tool=pen`、`inlinePE=auto`、`computedPE=auto`、`z-index=3`。**结论：第 25 轮那四个根因修复是对的，此前"写不了"就是因为进程里跑的仍是 `mdInkMouseDrawing=false` 的旧代码** |
| **PDF 手写实际可用（第 30 轮实测）** | `_system/templates/blank.pdf` 上派发真实指针事件，`.bimo-pdf-ink-svg[data-tool=pen]` 的 `pointer-events=auto`、`z-index=3`、`.page[data-page-number]` 的 `position=relative`，画后 path 从 3→4 且 `.bimo/pdf-ink/*.json` 落盘。同时证伪一个假设：**这个版本里 `view.pdfViewer` 根本不存在**（`hasPdfViewer=false`），所以第 29 轮照抄 PDF++ 的 `dom.viewerEl` 入口在 1.14.5 上无效；实际生效的是 `div.page[data-page-number]` 这条选择器回退 |
| **PDF 工具条被 viewer 重建清掉（第 30 轮修复）** | 实测 `hasPill: true`（对象存在）但 `document.querySelectorAll('.bimo-md-ink-pill--pdf').length === 0`，且 `.view-content` 的子元素只有 `pdf-toolbar` 和 `pdf-container` —— pdf.js 文档加载完成后会重建该子树，外来的 pill 一并丢失。修法：host 从 `.view-content` 改为 **`.workspace-leaf-content`**（在 leaf 生命周期内稳定），并新增 `repairPills()` 在每次 `sync()` 末尾检查 `pill.isConnected`，不在就重新 append。实测修复后 `pdfPill: 1`、`pillHost: workspace-leaf-content`，5 个按钮齐全 |
| **重载后图层重复挂载（第 30 轮修复）** | 实测重载两次后出现 **3 个 SVG 全部标记 `page=1`**。根因有二：①`disablePlugin()` **根本不会调用 `onunload()`**（实测 `rightAfterDisable` 数量不变），所以依赖卸载钩子清理不可行；②即便调用，旧实例的 manager 已被丢弃，`attached` 为空，里面的图层成为无人认领的孤儿。修法三件套：`PdfInkManager.destroy()` 的 `sweepOrphans()` 按类名清扫、`MdInkController.destroyAll()` 同样按类名清扫、以及**启动即清扫** —— `sweepStaleInkDom()` 在 `onload` 最前面扫描所有 leaf 的 `containerEl` 移除残留。实测重载后 `svgCount: 1` |
| **隐藏窗口下笔迹不重绘（第 30 轮修复）** | 实测 `document.visibilityState === 'hidden'` 时，`requestAnimationFrame` 排定的回调**完全不执行**（`rafRan: false`，`setTimeout` 600ms 后依旧 false），于是 `requestRender()` 永不落地：`doc.strokes` 从 3 涨到 4 而 `strokeGroup.children` 仍是 3。真实影响：在失焦窗口里用触控笔画（平板模式、副屏），笔迹会被记录却看不见，直到切回前台。修法：`requestRender()` 同时排 `requestAnimationFrame` 与 `window.setTimeout(run, 120)`，`renderQueued` 保证只跑一次。实测修复后隐藏窗口下 `strokes 3→4` 且 `dom 3→4`，`rendered: true` |
| 本轮验证范围（第 30 轮） | `tsc` 0 错误；逻辑层 **50 套件 / 547 项全过**；`main.js c1fcfb86…`，dist 与部署 md5 一致。**这次不是静态检查，是真机端到端**：独立 Obsidian 实例 + CDP 派发真实指针事件，MD 与 PDF 双向验证通过。收尾时测试实例与用户实例一并退出，已 `Start-Process` 重新拉起，`community-plugins.json` 确认 `bimo` 仍在启用列表，新实例自动写出的诊断显示 `layers=1 svg=1 pill=1 mdInkMouseDrawing=true` |

---

## 第 31 轮（2026-10-23）：接手复审 —— 六个缺陷、两处性能问题

**背景**：另一段对话把插件推进到「MD/PDF 直接书写」阶段并留下 `DEVELOPMENT.md`。本轮不复述文档，而是把文档逐条对照源码，再用 `tsc` + `jest tests/logic` 建立基线后逐项修。

**基线**：`tsc` 0 错误；`tests/logic` 51 套件 / 559 项通过；`dist/main.js 8a926784…` 与部署逐字节一致。

| # | 缺陷 | 根因（定位到行） | 修法 |
|:--|:--|:--|:--|
| 1 | 长文档滚动后，视口外的笔迹全部堆到第一行 | `lineTopInContent()` 依赖 `view.coordsAtPos()`；CodeMirror 只对视口内已渲染的行返回坐标，其余为 `null`，调用方一律 `?? 0` | 回退到高度图 `view.documentTop + view.lineBlockAt(from).top`，并对 `documentTop` 做类型防御（缺失返回 `null`，避免 `translate(0 NaN)`） |
| 2 | 关闭再打开「在笔记上书写」后，图层只挂不存 | `teardown()` 无条件 `disposed = true`，而 ViewPlugin 与编辑器同生命周期；重新启用后 `loadFor()` 因 `disposed` 直接 return，`hydrated` 永为 false | `teardown(permanent)` 区分「销毁」与「设置项挂起」；挂起保留实例、重置重试预算 |
| 3 | 重命名笔记后笔迹消失，旧 JSON 成孤儿 | 存储键是路径的 FNV 哈希；扩展里那句「the ink file key must follow it」描述的正是**未实现的行为** | `MdInkStorage.move()`（幂等、不覆盖）+ `vault.on('rename')` + `controller.noteRename()/awaitMove()`；编辑器侧用 10 秒时间窗区分「重命名」与「同标签换文件」，改名走合并而非替换。PDF 侧同样加 `moveInk()` 与 `pendingMoves` |
| 4 | 重新挂载瞬间可能用空文档覆盖磁盘 | `tryMount()` 未重置 `hydrated`，挂起/恢复后它仍是 `true` | 挂载时显式 `hydrated = false` |
| 5 | 每篇笔记的纸张只写不读 | `setPaper()` 写 `doc.paper`，但渲染读 `options.paper`（全局设置），加载时从不回填 | 新增纯函数 `resolvePaperStyle(doc, fallback)`：空文档且未选过纸时继承设置，否则以文档为准 |
| 6 | PDF 上选「套索」会变成画笔 | `PdfInkOverlay` 只排除 `pan`，套索落进 pen 分支 | 套索在 PDF 上与 pan 同组：不接管指针、不画线、不显示圆环 |

**顺带修的两处性能问题**

| 位置 | 原状 | 现状 |
|:--|:--|:--|
| `eraseAt()` | 每条笔迹各取一次 `contentOrigin()` 与行顶，等于每笔两次强制重排，橡皮拖动按笔迹数放大 | 每次事件读一次布局，按行号缓存 |
| `findPageElements()` | 每帧先遍历整棵子树找 shadow root，再查页面；pdf.js 滚动时 childList 频繁变动 | 先走光 DOM 快路径，未命中才做 shadow 扫描 |

另：`md-ink-cycle-brush` 原来只更新当前 overlay，多窗格下其它窗格仍是旧笔刷，改走 `refreshOptions` 广播。

**本轮验证范围**：`tsc` 0 错误；逻辑层 **51 套件 / 559 项通过**（新增 `md-ink-lifecycle.test.ts` 12 项：迁移成功/不覆盖目标/无源文件/同路径空操作、改名判定、时间窗过期、等待移动、纸张归属三例）；`main.js 8a926784…`、`styles.css d16903ee…`，dist 与部署 md5 一致。**第 1 项仍缺真机滚动证据**——jsdom 无布局，`coordsAtPos` 的行为无法复现，需在 Obsidian 里滚动验证。

**确认存在但本轮未修**（已写入 `DEVELOPMENT.md` 8.4）：跨行套索复制粘贴丢失行间距、`.bimo/` 孤儿文件无清理、渲染无视口裁剪、32 位哈希无回读校验、版本号不一致。

---

## 第 32 轮（2026-10-23）：浮动工具条拖动异常

**用户反馈**：拖动工具条有异常。没有细节，所以把两套拖动实现（笔记 / PDF）逐行对照，找出四个确定性缺陷并统一重写。

| # | 缺陷 | 根因 | 修法 |
|:--|:--|:--|:--|
| 1 | 拖到边缘后不跟手，往回拖要"空走"一段才动 | 每帧用 `base + client - start` 计算，同时结果被 clamp。超出边界的行程被丢弃但基准不变，于是反向移动要先抵消这段隐形行程 | 改为增量式：`current + (client - lastClient)`，clamp 后的实际值写回 `current`。被夹住时 overshoot 不累积 |
| 2 | 拖出工具条后松手，拖动状态卡住 | `pointerup` 只绑在 pill 上。快速拖动时松手往往落在 pill 之外，up 事件收不到 | 拖动期间在 `window` 上以捕获阶段监听 `pointermove / pointerup / pointercancel`，并补 `blur`（Alt-Tab 时永远收不到 up） |
| 3 | 撤销 / 清空按钮点了没反应 | 只有 5 个工具按钮在 `pointerdown` 里 `stopPropagation`，`undo` 和 `clear` 没有。在它们上面按下会启动拖动，`setPointerCapture` 又把 click 吞掉 | 由统一的 `attachPillDrag` 在按下时检查 `closest('button, a, input, …')`，任何控件都不启动拖动，不再依赖按钮自己拦截 |
| 4 | 拖动位置"记不住"，换个窗口宽度就跑掉 | 存的是 viewport 绝对坐标，恢复时用它去 clamp | 改为存**相对 host 的偏移**，恢复时用 `hostRect + offset`，侧栏或窗口尺寸变化后仍贴着编辑器同一相对位置 |
| 5 | 拖动时工具条会从指针下方跳走 | `position: fixed` 只有在没有祖先建立包含块时才相对视口。Obsidian 的编辑器外层可能为了滚动性能加 `transform` / `contain`，一旦有，坐标就切到该祖先的盒子 | 笔记工具条改挂 `document.body`；`.cm-editor:hover` 的提亮规则随之失效，改为 pill 自身的 `:hover` |
| 6 | 编辑器尺寸变化后工具条可能留在可视区外 | 没有尺寸监听 | 用 `ResizeObserver` 观察 `view.dom`，调用 `reclamp()`；从未拖动过时重算默认角，避免首帧在无布局时被夹到左上角后一直留在那 |

**新增文件**：`src/logic/md-ink/pill-drag.ts`（约 330 行，含注释）。两处调用点都删掉了各自的副本：
- `md-ink-overlay.ts`：删 `bindPillDrag` 的 95 行实现与 `restorePillPosition` / `clampPillToEditor`
- `pdf-ink-manager.ts`：删本地 `bindPillDrag`，工厂改为返回 `{ pill, drag }`，`AttachedPdf` 增加 `pillDrag` 以便 `detach()` 销毁监听

**顺带修的两处配套问题**：
- `sweep-stale.ts` 原来只在 leaf container 内查 pill。笔记 pill 改挂 body 后成了"幽灵"，每次重载会留下一个叠在同一点。补了一次 `document.querySelectorAll('.bimo-md-ink-pill')` 清理
- `diagnostics.ts` 的 `pill=` 改为 `容器内/全局`，否则诊断永远报 0，排障会误判成"工具条没挂上"

**新增测试** `tests/logic/pill-drag.test.ts`：12 项，每个缺陷一项回归。其中最关键的是「夹到边界后反向移动 10px，位置必须立刻减少 10px」——旧实现在这条上会完全不动。

**本轮验证范围**：`tsc` 0 错误；逻辑层 **52 套件 / 572 项通过**（+13）；`main.js 4185b4b7…`、`styles.css 39b62230…`，dist 与部署 md5 一致；产物含 `reclamp`、`pointercancel`、`bimo-md-ink-pill` 规则与 `z-index: 40`。**拖动是纯交互行为，jsdom 无布局，仍需真机确认手感**。

---

## 第 33 轮（2026-10-23）：移除账号体系 + 修复露出的 Edit Writing 链接

### 一、用户看到的「Edit Writing」

手写嵌入在 markdown 里是一行：

```
 ![alt](<_system/attachments/Ink/Writing/xxx.svg>) [Edit Writing](https://youtu.be/2arL1jh8ihA?type=inkWriting&aspectRatio=3.810)
```

`[Edit Writing](…)` 不是给人看的，是 CM6 扩展用来定位嵌入的**解析锚点**，正常由 widget 整个接管。但它有两个失效出口：

| 出口 | 后果 |
|:--|:--|
| 阅读模式/转写渲染不跑 CM6 扩展 | 链接以普通外链形式露出来 |
| 原 CSS 用 `visibility: hidden` | 保留占位、仍可能可见，且不覆盖绘图类链接 |

更糟的是 URL 指向一个 YouTube 视频（原作者的演示片），所以只要露出来，点一下就会跳到无关内容。

**修法**：
- `INK_EMBED_BASE_URL` → `https://bimo.invalid/embed`（`.invalid` 是 RFC 2606 保留域，点击到不了任何站点；`type=inkWriting` 等参数保持不变，所有解析正则不受影响）
- CSS 改为 `a[href*="type=inkWriting"], a[href*="type=inkDrawing"] { display: none !important; }`
- vault 内两篇已存在的笔记做了 URL 替换（备份在 `_system/backups/bimo-embed-link-fix-2026-10-23/`）

### 二、账号体系整体移除

删除清单（源码备份在 `_system/backups/bimo-removed-almostuseful-2026-10-23/`）：

| 文件 | 内容 |
|:--|:--|
| `src/logic/almostuseful/`（12 个文件） | device-code 登录、token 持久化、refresh、usage 图表、门户 HTTP |
| `almostuseful-account-section.ts/.scss` | 设置页顶部的整块账号 UI（绑定、额度燃尽图、数据处理说明） |
| `almostuseful-link-account-button.ts` | 账号按钮外观 |
| `auto-transcribe-account-notice.ts` | 关闭嵌入时邀请「绑定账号」的弹窗 → 重写为 `auto-transcribe-endpoint-notice.ts`，提示改填自己的端点 |
| `handwriting-transcription-variants.ts` | 门户专用的媒体准备（产品代码已不用） |
| 4 个测试文件 | 账号 device/login、门户 live、variants |

行为变化：

| 场景 | 之前 | 现在 |
|:--|:--|:--|
| 未配置 API 点「识别」 | 静默走门户 → 无账号则失败 | 明确提示「尚未配置识别 API」，并指出设置路径 |
| 队列准入 | 自定义 API **或** 账号会话 | 只看自定义 API |
| 版本更新弹窗 | 带「创建账号 / 绑定账号」CTA | 只留说明与关闭 |
| 设备设置里的账号轮询 | 有 | 已删 |

`transcribeWriting` 的门户 fallback 整段移除；`HandwritingTranscriptionJobError` 与提示函数迁到 `src/logic/transcription-errors.ts`（不再依赖账号模块），新增 `TranscriptionNotConfiguredError`。

### 三、体积与验证

| 项 | 之前 | 现在 |
|:--|--:|--:|
| `main.js` | 4,421,445 B | 4,335,147 B |
| `styles.css` | 323 KB | 308.3 KB |
| 字典键 | 497 | 483（删掉 26 行账号条目与品牌词） |

- `tsc` 0 错误；`tests/logic` **49 套件 / 546 项通过**（删 4 套账号测试，新增 `transcribe-writing` 5 项：未配置抛错、禁用抛错、正常调用、SVG→PNG 重试、不重试无关错误）
- 产物自检：`almostuseful` / `AlmostUseful` / `Almost Useful` / `Link account` / `api/jobs/handwriting-transcription` 全部 **0**；`bimo.invalid/embed` 存在；CSS 含 `display: none !important`
- `main.js 3a4995ac…`、`styles.css 80fc63b7…`，dist 与部署 md5 一致
