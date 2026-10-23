---
title: 笔墨开发文档
date: 2026-10-23
tags:
  - bimo
  - project
  - docs
---

# 笔墨（bimo）开发文档

> 覆盖截至 **2026-10-23** 的开发进展。
> 编写依据：仓库源码、`dist/` 产物、`ROADMAP.md`、`.obsidian/plugins/bimo/` 部署状态，以及一次真实 Obsidian 实例上的端到端验证记录。
> 凡无法从现有材料确认的内容，标注为「**待补充**」。未标注的一律有代码或实测证据支撑。

---

## 目录

1. [项目概述与目标](#一项目概述与目标)
2. [技术栈与运行环境](#二技术栈与运行环境)
3. [仓库位置与目录结构](#三仓库位置与目录结构)
4. [已实现的功能模块](#四已实现的功能模块)
5. [关键接口与数据结构](#五关键接口与数据结构)
6. [本地启动与构建](#六本地启动与构建)
7. [测试与验证方法](#七测试与验证方法)
8. [已知问题与限制](#八已知问题与限制)
9. [后续待办事项](#九后续待办事项)
10. [待补充信息清单](#十待补充信息清单)

---

## 一、项目概述与目标

### 1.1 定位

**笔墨（插件 id `bimo`）** 是一个 Obsidian 手写插件，从 Dale de Silva 的 **Ink** 改造而来（上游许可 CC BY-NC-ND 4.0，仅个人使用，不得分发）。

它在原有「块内手写」能力之上，新增了 **Handwriting 类插件的核心能力**：在 Markdown 正文和 PDF 页面上**直接落笔**，笔迹以覆盖层形式存在，**不修改笔记文件的任何一个字节**。

### 1.2 要解决的问题

| 原有问题 | 本项目做法 |
|:--|:--|
| 块内手写会占正文位置，插入后把文章顶下去 | 新增浮在编辑器之上的笔迹层，不占位 |
| 想在讲义 PDF 上批注，得来回切窗口 | PDF 直接书写层 + 双向跳转 |
| 想抄 Handwriting 的功能，但那是闭源打包产物 | 从 `data.json` 反推能力面，在本仓库原生实现 |

### 1.3 当前状态（截至本文件）

- **可用且已实测**：Markdown 直接书写、PDF 直接书写、工具条拖拽与固定定位、图层重载清理
- **有代码但需持续观察**：PDF 批注（页图转笔记）、AI 函数作图
- **明确不做**：见 [9.2](#92-明确不做的项及理由)

---

## 二、技术栈与运行环境

### 2.1 运行时

| 项 | 值 | 备注 |
|:--|:--|:--|
| 目标宿主 | Obsidian `>= 1.8.7` | 由 `manifest.json` 的 `minAppVersion` 决定 |
| 实测宿主版本 | **1.14.5**（Electron 43.1.1 / Chrome 150） | 真机验证环境 |
| 平台 | 桌面优先；`isDesktopOnly: false` | 触屏 / 触控笔 / Apple Pencil 均支持 |
| 开发机 | Windows 11 Pro 10.0.26300 | |

### 2.2 主要依赖

| 类别 | 包 |
|:--|:--|
| 编辑器 | `@codemirror/view` `@codemirror/state` `@codemirror/language` |
| 绘图层（原有） | `@tldraw/tldraw` `@tldraw/assets` |
| 笔迹拟合 | `perfect-freehand` |
| UI | `react` `react-dom` `jotai` `@reduxjs/toolkit` `react-redux` |
| 弹层 | `tippy.js` `@tippyjs/react` |
| SVG | `canvg` `@xmldom/xmldom` `xml-formatter` `react-inlinesvg` |
| 其他 | `nanoid` `semver` `classnames` |

> 注：`pdf-lib` 曾作为「批注写回 PDF」的依赖被引入（bundle +800KB），后按用户要求**已完全移除**。**PDF 批注回写功能当前不存在**。

### 2.3 构建

- 打包器：**esbuild 0.14.47**（配置在 `esbuild.config.mjs`）
- 样式：`esbuild-sass-plugin`（`src/styles/*.scss`）
- 类型检查：TypeScript 5.7，`tsc --noEmit --skipLibCheck`

---

## 三、仓库位置与目录结构

### 3.1 关键路径

| 角色 | 路径 |
|:--|:--|
| **源码仓库** | `D:\bimo-src\` |
| **开发记录** | `D:\bimo-src\docs\ROADMAP.md` |
| **i18n 覆盖检查脚本** | `scripts/check-i18n.js`（`npm run check` 会一并跑类型检查） |
| **构建产物** | `D:/bimo-src/dist/{main.js, styles.css, manifest.json}` |
| **部署目标** | `D:\ErnestVault\.obsidian\plugins\bimo\` |
| **插件运行时数据** | `D:\ErnestVault\.bimo\` |

### 3.2 源码结构（`src/`）

```
src/
├── main.ts                     插件入口：onload / 设置 / 命令注册
├── manifest 对应              manifest.json（插件元信息）
├── commands/                 命令实现
├── components/               React 组件（工具栏、画布等）
├── connections/              Boox / 外部连接
├── ddc-library/              上游通用库
├── graphics/                 SVG 图形资源
├── i18n/                     多语言；`zh-cn.ts` 为中文文案
├── ink-canvas/               画布引擎、笔刷预设、笔迹渲染管线
├── logic/
│   ├── md-ink/               ★ 本项目新增：笔记与 PDF 的直接书写
│   │   ├── types.ts              数据结构 + 锚点解析 + 吸附 + 文档合并
│   │   ├── md-ink-store.ts       笔记笔迹的读写（FNV-1a 路径哈希）
│   │   ├── md-ink-overlay.ts     笔记图层：渲染 / 指针 / 工具 / 工具条
│   │   ├── md-ink-extension.ts   CodeMirror ViewPlugin，负责挂载与重载
│   │   ├── md-ink-controller.ts  全局工具状态 + overlay 注册表
│   │   ├── md-ink-commands.ts    约 17 条命令
│   │   ├── pdf-ink-manager.ts    PDF 图层生命周期、保存、工具条
│   │   ├── pdf-ink-overlay.ts    PDF 页内 SVG 图层
│   │   ├── pdf-ink-types.ts      PDF 笔迹数据结构
│   │   ├── diagnostics.ts        运行时诊断（写 `.bimo/diagnostics.txt`）
│   │   └── sweep-stale.ts        启动时清扫上一实例残留的 DOM
│   ├── pdf/                  ★ PDF 批注：页图转笔记 + 双向跳转
│   │   ├── annotation-index.ts   批注索引页
│   │   ├── annotation-target.ts  目标笔记命名模板
│   │   ├── pdf-page-selection.ts 页码解析（支持 `1-3,5`）
│   │   ├── pdf-page-to-image.ts  页渲染
│   │   ├── pdf-paths.ts          落点路径推导
│   │   └── pdf-plus-link.ts      解析 PDF++ 的 `&rect=` 选区链接
│   └── utils/                reload-plugin / 其他
├── stores/                   jotai 状态
├── styles/                   全部 scss；`md-ink.scss` 为新增层样式
└── types/                    设置类型（版本化：`plugin-settings_0_5_0.ts`）+ 迁移
```

### 3.3 运行时数据目录（`.bimo/`，相对 vault）

```
.bimo/
├── md-ink/<8位hash>.json     每篇笔记一个笔迹文件
├── pdf-ink/<8位hash>.json    每份 PDF 一个笔迹文件
└── diagnostics.txt           最近一次运行时状态快照（自动写）
```

> `.bimo/` 与块内手写的 `_system/attachments/Ink/`（`Writing/` `AI/` `PDF/`）**互不相干**，后者归块内手写与 PDF 批注功能使用。

---

## 四、已实现的功能模块

### 4.1 笔记直接书写（`md-ink`）— 已实测可用

**能力**：在 Markdown 正文上方叠加一层 SVG，笔迹覆盖在文字上，不占正文位置，不写入 `.md` 文件。

| 子能力 | 状态 | 实现位置 |
|:--|:--|:--|
| 钢笔 / 荧光笔 / 橡皮 / 套索 / 手掌 | ✅ | `md-ink-overlay.ts` `MdInkTool` |
| 笔刷种类（7 种） | ✅ | `mdInkBrush`：pen / pencil / technical / marker / highlighter / crayon / brush |
| 撤销 / 重做 | ✅ | `undoStack` / `redoStack` |
| 复制 / 剪切 / 粘贴笔迹 | ✅ | 剪贴板 JSON |
| 删除选中笔迹 | ✅ | 仅在有套索选中时接管 `Delete` |
| 纸张：横线 / 网格 / 点阵 | ✅ | `MdInkPaper` + `renderPaper()` |
| 压感 | ✅ | 触控笔 `event.pressure`，鼠标固定 0.5 |
| 形状吸附 | ✅ | 先判矩形再判直线，`snapStrokePoints()` |
| 笔尖光标（reticle） | ✅ | 圆环半径 = 真实落笔/橡皮半径 |
| 鼠标书写开关 | ✅ | `mdInkMouseDrawing`，默认 `true` |
| 导出 SVG | ✅ | 命令 `md-ink-export-svg` |
| 单点成点 | ✅ | `dotPath()`，避免 perfect-freehand 对单点返回空轮廓 |

**关键设计**：

- **挂载点**：图层挂 `.cm-scroller`（不是 `.cm-content`）。CodeMirror 重建 `.cm-content` 子树时会删掉外来节点，这是实测出来的。
- **锚点**：笔迹按「行」+ 行文本指纹（`MdInkAnchor`）定位。行号变化时用文本重匹配；文字本身被改则保持原位不下跳。
- **坐标**：`points` 相对锚点行左上角，CSS px @ zoom 1。
- **落盘节流**：700ms 防抖。
- **hydration 闸门**：只有磁盘文档合并完成（`hydrated = true`）后才允许写盘，防止空文档覆盖真实笔迹。

### 4.2 PDF 直接书写（`pdf-ink`）— 已实测可用

**能力**：在 Obsidian 的 PDF 视图页面上叠加 SVG，按页存笔迹。

| 子能力 | 状态 | 说明 |
|:--|:--|:--|
| 页面定位 | ✅ | 选择器回退链见下 |
| pen / highlighter / eraser / pan | ✅ | 工具条 + 命令 |
| 每页独立图层 | ✅ | SVG 挂在 `div.page[data-page-number]` 内 |
| 滚动 / 缩放跟随 | ✅ | `ResizeObserver` + `MutationObserver` 重扫 |
| 保存 | ✅ | 700ms 防抖，写 `.bimo/pdf-ink/<hash>.json` |
| 清空当前 PDF 笔迹 | ✅ | 工具条垃圾桶 + 命令 |

**页面探测回退链**（`pdf-ink-overlay.ts::findPageElements`）：

1. `div.page[data-page-number]` ← **首选**（PDF++ 同款，真机验证有效）
2. `[data-page-number]`（过滤 `.thumbnail`，因为侧边栏缩略图带同一属性）
3. `.pdfViewer .page` / `.pdf-container .page` / `.pdf-page` / `.view-content .page`
4. 任何包含 `<canvas>` 的元素宿主
5. Shadow DOM 根（`querySelectorAll` 不跨 shadow boundary）

> **重要事实**：在实测的 Obsidian 1.14.5 上，`leaf.view.pdfViewer` **不存在**。不要依赖 `view.pdfViewer.dom.viewerEl` 作为入口——代码里有该分支但实际走不到。

**层级**：SVG `z-index: 3`，压在 pdf.js 文本层（`z-index: 2`）之上。同级时后插入者在上，而 pdf.js 每次重渲染都会重新 append 文本层，所以必须高于它。

### 4.3 悬浮工具条（笔记 + PDF）

| 项 | 行为 |
|:--|:--|
| 笔记工具条定位 | `position: fixed` + JS 计算到**本编辑器可见区域**右上角 |
| PDF 工具条定位 | `position: absolute`，host 是 `.workspace-leaf-content` |
| 拖拽 | 按住本体（按钮除外）拖动；松手写入 `localStorage` |
| 拖动边界 | 编辑器矩形与窗口的**交集**内 clamp |
| 双击复位 | 重新计算默认角落并清 localStorage |
| 静息透明度 | 0.7；悬停 / 焦点 / 绘制中为 1 |
| 铅笔提示 | 未选过其他工具且当前是 `pan` 时，铅笔按钮做 1.8s 脉冲 |

localStorage 键：
- 笔记：`bimo-md-ink-pill-position`
- PDF：`bimo-pdf-ink-pill-position`

### 4.4 PDF 批注（页图 → 笔记）

把 PDF 页面渲染成图片，作为手写块背景插入笔记，并可双向跳转。

| 子能力 | 状态 |
|:--|:--|
| 多页选择（`1-3,5`） | ✅ |
| 页图渲染插入 | ✅ |
| 目标笔记：PDF 旁自动建 / 固定笔记 | ✅ 设置项 |
| 命名模板（`{pdf}` `{date}`） | ✅ |
| 插入后打开/留在 PDF | ✅ |
| 索引页 → PDF 指定页 | ✅ `[[x.pdf#page=3\|PDF]]` |
| 正文块 → PDF 原页 | ✅ |
| PDF++ 选区 `&rect=` 裁剪成批注块 | ✅ 命令驱动（剪贴板） |
| **笔迹写回 PDF** | ❌ **已移除**（依赖 `pdf-lib` 太重，见 9.2） |

### 4.5 设置页

设置项归属 **设置 → bimo → 文件 / 在笔记上书写 / …**。

与直接书写相关的字段（默认值取自 `plugin-settings_0_5_0.ts`）：

| 字段 | 类型 | 默认 |
|:--|:--|:--|
| `mdInkEnabled` | boolean | `true` |
| `mdInkBrush` | 7 选 1 | `pen` |
| `mdInkSize` | number | `4` |
| `mdInkColour` | string | `currentColor` |
| `mdInkMouseDrawing` | boolean | **`true`** |
| `mdInkPaper` | none/ruled/grid/dots | `none` |
| `mdInkEraserRadius` | number | `14` |
| `mdInkShapeSnap` | boolean | `true` |

PDF 批注相关：

| 字段 | 类型 | 默认 |
|:--|:--|:--|
| `pdfAnnotationNoteMode` | `auto-create` \| `fixed` | `auto-create` |
| `pdfAnnotationNoteTemplate` | string | `{pdf} - 批注` |
| `pdfAnnotationFixedNotePath` | string | `''` |
| `pdfAnnotationOpenMode` | `background` \| `foreground` | `foreground` |

> **设置迁移是逐字段补默认值的**（`plugin-settings-migrations.ts`）。新增字段如果不加进迁移，老用户的 `data.json` 里该字段会一直是 `undefined`，功能静默失效。这是第 34 轮的教训，新增设置项时务必同步加迁移。

### 4.6 诊断系统

**目的**：把「画不出来」从四种互相看不出区别的故障中区分开。

自动写入 `.bimo/diagnostics.txt`，触发时机：

- `onLayoutReady`
- 每次 `layout-change` / `active-leaf-change`（3s 防抖）

也可手动触发：命令 **「写出运行时诊断」**。

输出示例（真机实测）：

```
md[1] 03-Maps/Home.md scroller=1 content=1 layers=1 svg=1 pill=1 tool=pan pe=none box=460x9629 parent=cm-contentContainer
pdf[1] ....pdf pdfViewer=0 viewerEl=0 pages=2 exact=2 thumbs=1 viewerPages=0 canvas=2 iframe=0 layers=2 box=612x792 pe=auto pagePos=relative
```

判读表：

| 读到 | 含义 |
|:--|:--|
| `layers=0` | 扩展没挂上 → 挂载时机问题 |
| `layers=1 pe=none` | 挂上了但指针没接管 → 工具是 `pan`，或 CSS 未生效 |
| `layers=1 box=0x0` | 挂上了但尺寸为 0 → 坐标换算问题 |
| `pe=auto box=WxH` 仍画不出 | 事件被遮挡 → 层级问题 |
| PDF `iframe>0` | PDF 在 iframe 里，当前方案不适用 |

### 4.7 热重载

| 入口 | 依赖 |
|:--|:--|
| 快捷键 `Ctrl/Cmd+Shift+R` | bimo 自身命令 `reload-plugin` |
| 命令「重载插件（开发用）」 | 同上 |
| Templater 模板 `_system/templates/!reload-bimo.md` | **不依赖 bimo**，直接调 `app.plugins.disablePlugin/enablePlugin` |

> **实测事实**：`app.plugins.disablePlugin()` **不会调用插件的 `onunload()`**。因此清理残留不能依赖卸载钩子，必须用 `sweepStaleInkDom()` 在下次 `onload` 开头清扫。

### 4.8 原有 Ink 能力（继承）

块内手写 / 绘图、tldraw 画布、Excalidraw 导出、AI 转录（可接 OpenAI 兼容 API）、魔法边栏等，来自上游 `obsidian_ink`，不在本次改造范围内，行为保持原样。

---

## 五、关键接口与数据结构

### 5.1 笔记笔迹

```ts
export type MdInkTool = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'pan';
export type MdInkPaper = 'none' | 'ruled' | 'grid' | 'dots';

export interface MdInkAnchor {
  line: number;      // 1-based 文档行号
  lineText: string;  // 绘制时该行文本（截断），用于行号漂移后重匹配
}

export interface MdInkStroke {
  id: string;
  points: InkPoint[];              // 相对锚点行左上角，CSS px @ zoom 1
  style: InkStrokeStyle;           // 来自 ink-canvas/types
  anchor: MdInkAnchor;
  offset: { x: number; y: number }; // 套索平移量
  createdAt: number;
}

export interface MdInkDocument {
  version: 1;
  notePath: string;
  paper: MdInkPaper;
  strokes: MdInkStroke[];
  updatedAt: number;
}
```

**合并规则**（`mergeMdInkDocuments`）：本地为空则取磁盘；否则取「磁盘中本地没有的」+「本地全部」，按 `id` 去重，本地优先。

### 5.2 PDF 笔迹

```ts
export interface PdfInkDocument {
  version: 1;
  pdfPath: string;
  strokes: PdfInkStroke[];   // 每条带 page（1-based），坐标归一化到页面 0–1
  updatedAt: number;
}
```

坐标归一化到页面框（0–1），线宽同样归一化，因此缩放 / 改窗口 / 换显示器都能重投影到同一视觉位置。

### 5.3 存储路径与哈希

- 算法：**FNV-1a 32 位**，输出 8 位十六进制
- 笔记：`.bimo/md-ink/{hash(notePath)}.json`
- PDF：`.bimo/pdf-ink/{hash(pdfPath)}.json`

### 5.4 内部类职责

| 类 | 文件 | 职责 |
|:--|:--|:--|
| `MdInkController` | `md-ink-controller.ts` | 全局工具状态、overlay 注册表、`pdfSink` 转发、`destroyAll()` |
| `MdInkOverlay` | `md-ink-overlay.ts` | 单篇笔记的图层：渲染、指针、工具、工具条、undo/redo |
| `MdInkStorage` | `md-ink-store.ts` | 笔记笔迹读写 |
| `createMdInkExtension` | `md-ink-extension.ts` | CM6 `ViewPlugin`；负责 `resolveNotePath`、重试挂载、hydration 闸门、保存 |
| `watchActiveNotes` | `md-ink-extension.ts` | 切标签时发空事务，逼已打开笔记重新挂载 |
| `PdfInkManager` | `pdf-ink-manager.ts` | PDF leaf 生命周期、`attach/detach`、保存、工具条、`repairPills()`、`sweepOrphans()` |
| `PdfInkOverlay` | `pdf-ink-overlay.ts` | 单份 PDF 的页内 SVG 层 |
| `sweepStaleInkDom` | `sweep-stale.ts` | 启动时清扫上一实例残留 DOM |

### 5.5 命令清单（`md-ink-commands.ts`）

| id | 用途 |
|:--|:--|
| `md-ink-toggle-drawing` | 切换手写开/关（`Mod+Shift+D`） |
| `md-ink-tool-{pen,highlighter,eraser,lasso,pan}` | 切换工具 |
| `md-ink-undo` / `md-ink-redo` | 撤销 / 重做 |
| `md-ink-delete-selection` | 删除选中笔迹 |
| `md-ink-copy-selection` / `md-ink-cut-selection` / `md-ink-paste` | 剪贴笔迹 |
| `md-ink-clear-note` | 清空本篇笔迹 |
| `md-ink-clear-pdf` | 清空打开的 PDF 笔迹 |
| `md-ink-cycle-paper` | 循环纸张样式 |
| `md-ink-cycle-colour` / `md-ink-cycle-size` / `md-ink-cycle-eraser-size` / `md-ink-cycle-brush` | 循环切换 |
| `md-ink-toggle-mouse` | 鼠标书写开关 |
| `md-ink-export-svg` | 导出本篇笔迹 SVG |
| `md-ink-remount` | 重挂载已打开笔记的书写层 |
| `md-ink-diagnose` | 检查笔记书写状态 |
| `md-ink-pdf-diagnose` | 检查 PDF 书写支持 |
| `md-ink-write-diagnostics` | 写出运行时诊断到文件 |
| `reload-plugin` | 重载插件（`Mod+Shift+R`） |

另有 PDF 批注相关命令（`annotate-pdf-page`、`from-pdf-selection`、`open-pdf-annotation-index` 等），见 `main.ts`。

---

## 六、本地启动与构建

### 6.1 前置

```bash
cd D:\bimo-src
npm install
```

### 6.2 开发（watch）

```bash
npm run dev
```

### 6.3 生产构建

```bash
npm run build
```

执行两件事：`tsc -noEmit --skipLibCheck`（类型检查）+ `node esbuild.config.mjs production`。

产物：`dist/main.js`、`dist/styles.css`、`dist/manifest.json`。

### 6.4 部署到 vault

```bash
npm run deploy
```

等价于 `npm run build` + 把 `main.js` / `styles.css` / `manifest.json` 复制到
`.obsidian/plugins/bimo/`，并逐文件比对 md5。任一侧不一致以非零码退出，
避免「以为部署了其实没落地」。

### 6.5 让新代码生效

插件代码只在加载时读一次，改磁盘不会自动重载。三种方式任选：

1. `Ctrl+Shift+R`
2. 命令「重载插件（开发用）」
3. Templater 模板 `!reload-bimo`
4. 设置 → 第三方插件 → `bimo` 关掉再打开（最保险）

> **改完务必确认新代码进了进程**，否则会在旧版本上反复排查。判断方法：`data.json` 的 mtime 就是最近一次插件加载时间（`loadSettings()` 非新装时必定写盘）；或看 `.bimo/diagnostics.txt` 是否刷新。

### 6.6 当前构建基线（2026-10-23 迁入项目目录后）

| 项 | 值 |
|:--|:--|
| 版本 | `0.4.0`（`package.json` 与 `manifest.json` 已对齐） |
| `dist/main.js` | 4,350,014 字节，md5 `7ff538dd4017a9bd88bb0513f4c4e528` |
| `dist/styles.css` | 314,599 字节，md5 `725594453c9b9305f02c46737157487c` |
| 构建确定性 | 连续两次 `npm run build` 产物 md5 相同 |
| 测试基线 | `tsc` 0 错误；`tests/logic` **49 套件 / 546 项通过** |
| i18n | 450 词条，缺失 0（`npm run check`） |
| 部署一致性 | `dist` 与 `.obsidian/plugins/bimo/` 的 md5 逐字节相同 |

---

## 七、测试与验证方法

### 7.1 单元 / 逻辑测试

```bash
npx tsc --noEmit --skipLibCheck
npx jest tests/logic
```

基线（2026-10-23 复审后）：**51 套件 / 559 项通过**，另有 1 套件 skip。

新增套件 `md-ink-lifecycle.test.ts`（12 项）覆盖重命名迁移、改名判定时间窗与纸张归属。
`md-ink-mount.test.ts` 的 plugin mock 需带 `wasRenamed` / `awaitMove`，否则挂载即抛错——这是本轮新增的接口契约。

`tests/logic/` 下与本次改造相关的套件：

| 文件 | 覆盖 |
|:--|:--|
| `md-ink.test.ts` | 锚点解析、吸附等纯逻辑 |
| `md-ink-mount.test.ts` | **真实 CM6 编辑器 + jsdom**，验证图层是否真的挂上、销毁是否干净 |
| `md-ink-pointer-css.test.ts` | 指针契约（pen 时 `pointer-events: auto`） |
| `md-ink-hydrate.test.ts` | 文档合并（防覆盖丢数据） |
| `md-ink-snap.test.ts` | 形状吸附 |
| `md-ink-diagnostics.test.ts` | 诊断报告 |
| `md-ink-settings-migration.test.ts` | 设置迁移补默认值 |
| `pdf-ink.test.ts` / `pdf-ink-mount.test.ts` | PDF 坐标与挂载 |
| `pdf-plus-link.test.ts` | PDF++ 链接解析 |
| `pdf-annotation-*.test.ts` / `pdf-page-selection.test.ts` | PDF 批注 |

### 7.2 真机验证（CDP，推荐给后续接手者）

静态测试证明不了「真的能画」。已验证可行的方法：

1. 用**独立 user-data-dir** 启动第二个 Obsidian，带 `--remote-debugging-port=9333`
2. 先写好该 profile 的 `obsidian.json`（指向 vault），否则停在库选择界面
3. **必须用 PowerShell `Start-Process`**——Git Bash 里 `exe &` 启动的子进程随命令结束被杀
4. Node 22 内置 `WebSocket` 即可连 CDP：
   - `Runtime.evaluate`（`awaitPromise:true`、`returnByValue:true`、`userGesture:true`）执行任意 JS，`app` 全局可用
   - `Input.dispatchMouseEvent`（`pointerType:'mouse'`）派发**真实指针事件**
5. 收尾：按 `CommandLine -like '*9333*'` 精确 `Stop-Process`，恢复 `workspace.json`

**已知假象，不要当成 bug**：

| 现象 | 原因 |
|:--|:--|
| `visibilityState === 'hidden'` 时 `requestAnimationFrame` 完全不执行 | 浏览器对隐藏窗口暂停 rAF（代码已加 `setTimeout` 兜底） |
| 一次拖动只有 2 个采样点 | CDP 每次 `dispatchMouseEvent` 的 `pointerId` 可能不同，真实鼠标不会 |
| `Page.bringToFront` 无法把隐藏窗口变可见 | CDP 限制 |

### 7.3 实测结论（2026-10-23）

| 验证项 | 结果 |
|:--|:--|
| Markdown 手写 | `g.bimo-md-ink-strokes` 出现 5 条 `path`（`d` 长度 665/2074/2178/1283/1805），同步落盘 |
| PDF 手写 | path 数量 3 → 4，落盘 `.bimo/pdf-ink/*.json` |
| 工具条拖拽 | `left 449.8 → 299.8`、`top 16.7 → 106.7`，写入 localStorage |
| 滚动后工具条 | 滚 1200px 后 `y` 不变，仍在视口 |
| 重载清理 | 重载后 `svgCount: 1`（此前会累积到 3） |
| 隐藏窗口渲染 | 兜底生效后 `strokes 3→4` 且 `dom 3→4` |

---

## 八、已知问题与限制

### 8.1 当前确认存在

| # | 问题 | 影响 | 备注 |
|:--|:--|:--|:--|
| 1 | `package.json` 版本 `0.3.3` 与 `manifest.json` 版本 `0.1.0` 不一致 | 发布/排障时容易混淆 | 需统一，见 9.1 |
| 2 | 工具默认是 `pan` | 新用户首次落笔什么都不发生 | 已有铅笔脉冲 + 首次 Notice 缓解；这是刻意的设计取舍（pen 默认会全屏拦截、无法点选文字） |
| 3 | `view.pdfViewer` 在 Obsidian 1.14.5 不存在 | 依赖该入口的分支走不到 | 已由选择器回退链覆盖，但**其他版本是否可用未验证** |
| 4 | PDF 批注当前不上传回 PDF | 想要「PDF 里能看到笔迹」做不到 | 按用户要求移除 `pdf-lib` 后如此 |
| 5 | PDF++ 选区 → 批注块需要手动按命令 | 没有「粘贴即转换」 | 刻意不做，避免拦住正常 PDF++ 链接粘贴 |
| 6 | 重载会中断正在编辑的手写块 | 编辑器实例被销毁 | Obsidian 行为；内容不丢 |
| 7 | 逻辑层测试中 `WritingEmbed*` 等 9 个组件套件为红 | 与本次改造无交集 | 根因是 jest 的 obsidian mock 缺 `vault.getFileByPath().read()` |

### 8.2 明确不做的项及理由

| 项 | 理由 |
|:--|:--|
| 笔迹写回 PDF | `pdf-lib` 使 bundle +800KB，且首次实测未对齐；用户明确要求删除 |
| 笔迹预测（stroke prediction） | 外推时长必须实机调参，盲调只会让线条甩尾 |
| 幻灯片书写 | 投屏演示场景，笔记图层不参与 |
| 在 PDF 版面上直接落笔的「批注块」形态 | 已改为「页图搬进笔记」拓扑，坐标锚点用页码即可 |

### 8.3 2026-10-23 复审：发现并修复的缺陷

复审方法：把本文档逐条对照源码（不是对文档本身做校对），再用 `tsc` + `jest tests/logic` 建立基线。以下六项均先定位到具体行，再改，再验证。

| # | 缺陷 | 根因 | 修法 | 验证 |
|:--|:--|:--|:--|:--|
| 1 | **长文档滚动后，视口外的笔迹全部堆到第一行** | `lineTopInContent()` 用 `view.coordsAtPos()`，而 CodeMirror 只对视口内已渲染的行返回坐标，视口外返回 `null`；调用方一律 `?? 0` | 回退到高度图：`view.documentTop + view.lineBlockAt(from).top`，并对 `documentTop` 做类型防御（缺失时返回 `null` 而不是拼出 `NaN`） | 代码级 + 类型检查。**需真机滚动验证**（jsdom 无布局，单测覆盖不到） |
| 2 | **关闭再打开「在笔记上书写」，图层从此只挂不存** | `teardown()` 无条件设 `disposed = true`，而 ViewPlugin 实例与编辑器同生命周期；重新启用后 `loadFor()` 因 `disposed` 直接 return，`hydrated` 永远是 false，于是既不加载也不保存 | `teardown(permanent: boolean)` 区分「被销毁」与「被设置项挂起」；挂起时保留实例、重置重试预算，重新启用可正常挂载 | 代码级；`md-ink-mount.test.ts` 覆盖挂载路径 |
| 3 | **重命名笔记后笔迹消失，旧 JSON 成为孤儿** | 存储键是路径的 FNV 哈希，重命名后没有任何逻辑搬文件；扩展里那句「the ink file key must follow it」的注释描述的正是**没有实现的行为** | `MdInkStorage.move()`（幂等、不覆盖已有目标）+ `vault.on('rename')` 钩子 + `controller.noteRename()/awaitMove()`；编辑器侧用 10 秒时间窗区分「重命名」与「同标签切换文件」，改名时合并而非替换 | 新增 `md-ink-lifecycle.test.ts` 12 项（迁移、不覆盖、无源文件、同路径空操作、改名判定、时间窗过期、等待移动、纸张归属） |
| 4 | **重新挂载瞬间可能用空文档覆盖磁盘** | `tryMount()` 创建新 overlay 前没有重置 `hydrated`；挂起/恢复后它仍是 `true` | 挂载时显式 `hydrated = false` | 代码级（与第 29 轮同类，属于该闸门的遗漏出口） |
| 5 | **每篇笔记的纸张只写不读** | `setPaper()` 写 `doc.paper`，但渲染读的是 `options.paper`（全局设置值），`replaceDocument()` 从不回填 | 新增纯函数 `resolvePaperStyle(doc, fallback)`：空文档且未选过纸时继承设置，否则以文档为准 | `md-ink-lifecycle.test.ts` 3 项 |
| 6 | **PDF 上选「套索」会变成画笔** | `PdfInkOverlay` 只判断 `tool !== 'pan'`，套索落进了 pen 分支 | 套索在 PDF 上与 pan 同组：不接管指针、不画线 | 代码级 |

顺带修的两处：

- `eraseAt()` 原来在**每条笔迹**上各取一次 `contentOrigin()` 和行顶（每次都是强制重排），橡皮拖动时按笔迹数放大；现在每次事件只读一次布局并按行号缓存。
- `findPageElements()` 原来每帧都先遍历子树找 shadow root，再查页面；现在先走光 DOM 快路径，未命中才做 shadow 扫描。
- `md-ink-cycle-brush` 原来只更新当前 overlay，多窗格下其它窗格仍是旧笔刷；改走 `refreshOptions` 统一广播。

### 8.4 2026-10-23 追加：浮动工具条拖动异常（已修）

用户只报"拖动工具条有异常"，没有细节。两套实现（笔记 pill / PDF pill）逐行对照后确认四个确定性缺陷，已合并为 `src/logic/md-ink/pill-drag.ts` 统一实现：

| 缺陷 | 根因 | 现状 |
|:--|:--|:--|
| 拖到边缘后不跟手 | 每帧用按下点为基准，clamp 丢弃的行程不作补偿 | 改增量式，clamp 值写回当前位 |
| 松手在 pill 外则状态卡住 | `pointerup` 只绑在 pill 上 | 拖动期间在 `window` 捕获监听，并补 `blur` |
| 撤销/清空按钮点了没反应 | 这两个按钮没有在 `pointerdown` 拦截，误触发拖动后被 pointer capture 吞掉 click | 统一控件白名单，任何按钮都不启动拖动 |
| 位置记不住 / 换宽度后跑掉 | 存 viewport 绝对坐标 | 改存相对 host 偏移 |

另外两处配套：pill 改挂 `document.body`（避免编辑器祖先的 `transform` 劫持 `fixed` 定位），`sweep-stale.ts` 补全局清理、`diagnostics.ts` 的 `pill=` 改为「容器内/全局」。

回归测试 `tests/logic/pill-drag.test.ts` 12 项，其中「夹紧后反向 10px 必须立刻回 10px」直接对应旧实现的粘滞行为。

### 8.5 2026-10-23 追加：账号体系移除 + Edit Writing 链接

用户截图里出现的 `Edit Writing ↗` 来自 `build-embeds.ts` 写入的解析锚点
`[Edit Writing](https://youtu.be/2arL1jh8ihA?type=inkWriting…)`。它是 CM6 扩展的定位标记，
正常被 widget 整体接管；阅读模式或扩展未接管时就会以普通外链形式露出，而原来的 CSS 用的是
`visibility: hidden`（保留占位、不覆盖绘图类链接）。

现在：
- `INK_EMBED_BASE_URL = 'https://bimo.invalid/embed'`（保留 `type=` 参数，所有解析正则不变）
- CSS 改为 `display: none !important`，同时覆盖 `type=inkWriting` 与 `type=inkDrawing`
- vault 内已有的两篇笔记做了 URL 替换

Almost Useful 账号体系已整体删除（源码备份在 `_system/backups/bimo-removed-almostuseful-2026-10-23/`）：
`src/logic/almostuseful/` 全部 12 个文件、设置页账号区块、账号按钮、邀请绑定弹窗、
门户专用媒体准备、以及 4 个相关测试。`transcribeWriting` 不再有门户 fallback ——
未配置 API 时抛 `TranscriptionNotConfiguredError`，提示具体设置路径。

`HandwritingTranscriptionJobError` 与 `handwritingTranscriptionNoticeForError` 迁到
`src/logic/transcription-errors.ts`，不再依赖任何账号模块。

### 8.5 复审中确认存在、但本轮**未**修复的项

这些需要改动数据结构或产品决策，留待确认：

| 项 | 说明 |
|:--|:--|
| 跨行套索复制/粘贴会丢失行间距 | 笔迹的 `y` 相对各自锚点行，粘贴时统一改锚到光标行，跨行选区的相对位置因此被压缩。修法要存绝对 `y` 或每笔保留锚点，属于数据结构变更 |
| `.bimo/` 里的孤儿笔迹无人清理 | 删除笔记不会删除对应 JSON；`.bimo` 以点开头，Obsidian 界面中不可见。需要删除钩子或启动期扫描（比对 vault 文件列表） |
| 笔迹渲染无视口裁剪 | 每次滚动都重建全部 `<path>`。几百笔可接受，上千笔会拖慢滚动 |
| 32 位哈希碰撞无校验 | 理论概率极低，但存储格式里没有记录 `notePath` 用于回读校验，碰撞时会串数据 |
| `package.json` 0.3.3 与 `manifest.json` 0.1.0 不一致 | 见 9.1，仍未统一 |

---

## 九、后续待办事项

### 9.1 建议优先处理

1. **真机验证 8.3 的第 1 项**：打开一篇超过两屏的笔记，在首行附近写一笔，滚到底部再滚回来，笔迹应回到原位而不是贴在首行。这是本轮唯一无法用 jsdom 证明的修复。
2. **统一版本号**：`package.json`（0.3.3）与 `manifest.json`（0.1.0）对齐，避免 `versions.json` 与实际产物脱节。
3. **PDF 页面探测的多版本验证**：在 1.8.x / 1.9.x / 1.13.x 上各跑一次 `md-ink-pdf-diagnose`，确认选择器回退链足够。
4. **`pdfInk` 的 `repairPills()` 覆盖范围**：目前只在 `sync()` 末尾修；可考虑接入 `MutationObserver` 更及时。
5. **补全 jest 的 obsidian mock**：`vault.getFileByPath().read()`、`Plugin`、`PluginSettingTab`，让组件层 9 个红套件转绿。
6. **手写层的跨版本回归**：CM6 层级（`.cm-scroller` / `.cm-contentContainer`）在 Obsidian 大版本间可能变，建议把「编辑后图层仍在」写成冒烟测试。
7. **`documentTop` 的运行时确认**：本轮用它修复视口外定位；1.8.x 的 CM6 是否有该 getter 未验证（代码已有 `NaN` 防御，缺失时退回旧行为而非崩溃）。若要在最低版本上支持，需要换成 `lineBlockAt` + 内容盒偏移的写法。

### 9.2 功能层面

| 项 | 说明 |
|:--|:--|
| AI 识别 → 生成函数图 | `figure.ts` 已具备表达式采样出 SVG 的能力；缺的是「写完笔迹 → 识别 → 一键插入」的动线 |
| 图层（layers） | 数据结构已有设计（`InkLayer`），渲染三条路径需按层遍历 |
| 工具条位置/顺序可配 | 当前固定右上角，无旋钮 |
| PDF 选区粘贴自动转换 | 可加开关，默认关 |
| 批注块命名显示 | `buildWritingEmbed()` 无 caption 参数，块头标签未实现 |

---

## 十、待补充信息清单

以下内容无法从现有材料确认，需要补充后才能写进文档：

### 10.1 工程与流程

- [ ] **Git 仓库状态**：源码目录是否为 git repo、远程地址、分支策略。当前判定为「否」，需确认是否要初始化。
- [ ] **发布流程**：`scripts/internal-release.sh` / `beta-release.sh` / `public-release.sh` 的实际作用与凭据需求。
- [ ] **CI**：无 CI 配置文件被确认；是否需要在 GitHub Actions 上跑 `tsc + jest`。
- [ ] **E2E 测试**：`wdio.conf.mts` + `qa-test-vault/` 的用法与当前是否可跑通未验证。

### 10.2 上游与许可

- [ ] **上游同步策略**：`obsidian_ink` 上游更新如何合并；当前与上游的差异清单已在 ROADMAP 记录，但无自动化 sync 机制。
- [ ] **分发边界**：CC BY-NC-ND 4.0 下，个人改造版能否分享给他人、以何种形式。

### 10.3 功能细节

- [ ] **`md-ink-overlay.ts` 的 `MIN_POINT_DISTANCE = 1.1`** 是否对所有笔刷都合适（仅确认它不会过滤正常采样）。
- [ ] **PDF 批注索引页**的最终呈现格式，是否还需要索引页以外的汇总视图。
- [ ] **AI 转录对接**：`transcription-providers` 支持哪些具体服务、凭据存哪里。
- [ ] **Boox 连接**（`connections/`、`build:boox`）：是否需要维护，当前状态未确认。

### 10.4 兼容性

- [ ] **移动端**：`isDesktopOnly: false`，但手写层在移动端 WebView 的实际表现未验证。
- [ ] **Obsidian 最低版本实测**：`minAppVersion: 1.8.7` 是否真的能跑（只在 1.14.5 验过）。
- [ ] **与其他插件共存**：已排除 `handwriting`（未启用）与 `vscode-editor`（不碰 md DOM）；但 `editing-toolbar`、`pdf-plus` 的交互只做了部分确认。

---

## 附录 A：本次改造的时间线锚点

完整记录见 `D:\bimo-src\docs\ROADMAP.md`。关键节点：

| 轮次 | 内容 |
|:--|:--|
| 1–28 | UI 对齐（工具条按钮、笔刷面板、色板粗细）、PDF 批注与双向跳转、移除 pdf-lib、PDF++ 选区接入 |
| 29 | 从 Handwriting 的 `data.json` 反推能力面，原生实现直接书写层 |
| 25 | 定位并修复「写不了」的四个叠加根因（pointer-events 缺失、mouseDrawing 默认 false、挂载无重试、挂在 contentDOM 会被 CM 删掉） |
| 27 | 证明「磁盘是新代码、进程是旧代码」，确立「先验证是否重载，再改代码」的排查纪律 |
| 30 | 建立 CDP 真机验证通道，实测 MD/PDF 双向可写；修复 PDF 工具条被重建清掉、重载图层重复、隐藏窗口不重绘 |

## 附录 B：常见误判（交接必读）

| 现象 | 先查什么，而不是先改代码 |
|:--|:--|
| 「改了没反应」 | 新代码有没有进进程？看 `data.json` mtime / `.bimo/diagnostics.txt` |
| 「画不出来」 | 工具是不是 `pan`？`mdInkMouseDrawing` 是不是被关了？ |
| 「笔迹位置偏」 | 滚动后再测一次；`layer top` 为负说明点在视口外 |
| 「PDF 笔迹没了」 | 页面元素是否被 pdf.js 重建（`layers` 数量） |
| 「笔迹存了但不显示」 | `strokes` 与 `strokeGroup.children` 数量是否一致 |

---

*文档基于 2026-10-23 的仓库与部署状态编写。改动代码后请同步更新本文件与 ROADMAP。*

---

## 附录 C：迁入 vault 项目目录（2026-10-23）

### C.1 位置变更

源码从 `outputs/ink-src`（临时目录）迁到 **`06-Projects/bimo/`**，与插件本身成为一个自包含项目：

| 内容 | 位置 |
|:--|:--|
| 源码 | `06-Projects/bimo/src/` |
| 构建产物 | `06-Projects/bimo/dist/` |
| 开发文档 | `06-Projects/bimo/docs/` |
| 插件运行时 | `.obsidian/plugins/bimo/` |
| 设置数据 | `.obsidian/plugins/bimo/data.json` |
| 用户内容 | `_system/attachments/Ink/`、`.bimo/` |

同步执行的三项清理：

1. **移除上游产物**：`.git`（50 MB 上游提交历史）、`.github/`、`.cursor/`、`docs/`（47 MB 上游文档与演示图）、`qa-test-vault/`、`coverage/`、`manifest-beta.json`、`versions.json`、发布脚本。
2. **品牌统一**：界面文案、命令名、日志前缀里的产品名统一为「笔墨」；指向原作者社媒与赞助页的组件、外链区块整体删除。
3. ~~**Obsidian 排除**：`userIgnoreFilters` 加入 `06-Projects/bimo/{...}`~~ —— **此方案已废弃**，工程整体迁出 vault 后这些规则已清空，见附录 D。

### C.2 磁盘上刻意保留的旧标识

以下三项**不能**改名，否则已有笔记全部失效：

| 保留项 | 位置 |
|:--|:--|
| 附件目录名 `Ink/` | `src/constants.ts` → `ATTACHMENT_SUBFOLDER_NAME` |
| 嵌入键 `handwritten-ink` / `handdrawn-ink` | `src/constants.ts` |
| SVG 元数据 `inkWriting` / `inkDrawing` / `inkCanvas` | 文件内部 |

产品名与磁盘格式是两件事：前者改了没风险，后者改了等于丢掉旧数据。

### C.3 构建与部署

```bash
npm run check     # tsc + i18n 覆盖率（缺失键会失败）
npm run build     # 生产构建
npm run deploy    # 构建 + 复制到 .obsidian/plugins/bimo + md5 校验
npm test          # tests/logic（核心逻辑，应全绿）
```

`scripts/deploy.mjs` 会打印两侧 md5，任何一侧不一致直接以非零码退出。

### C.4 本轮修复的测试基础设施

| 问题 | 影响 | 修法 |
|:--|:--|:--|
| `jest.config.ts` 的 `^src/(.*)$` 排在 `^src/main$` 之前 | 插件 mock **从未生效**，测试加载真实插件后在 `app.vault.read` 崩溃 | 调整顺序，具体规则在前 |
| `tests/__mocks__/mainMock.js` 的 `vault` 是空对象 | 所有依赖 plugin 的组件测试全挂 | 补齐 `read` / `cachedRead` / `on` / `offref` / `getResourcePath` |
| 测试的 `makeTFile()` 缺 `vault` | 嵌入组件测试全挂 | 补齐同名方法 |
| 迁移测试 fixture 随 `qa-test-vault/` 一起被删 | 15 项迁移测试失败 | 恢复到 `tests/fixtures/`，测试路径同步改写 |

### C.5 测试现状

| 范围 | 结果 |
|:--|:--|
| `tests/logic` | **49 套件 / 546 项全部通过** |
| `tests/components/formats` | 24 套件通过、5 套件 10 项失败 |

组件测试的剩余失败是**上游遗留债务**：这些测试不通过 props 传 `plugin`，而是依赖 jotai 默认值，组件又调用了 vault 上未被 mock 的方法。它们与构建、运行无关，不阻塞功能。要继续修需先决定「组件是否应显式接收 plugin」，属于设计决策而非缺陷修复。

---

---

---

## 附录 D：工程在 vault 外（2026-10-23 最终方案）

### D.1 目录

| 角色 | 路径 |
|:--|:--|
| 源码工程 | `D:imo-src`（本目录） |
| 依赖 | `D:imo-src
ode_modules`（`npm ci` 生成，不入库，不链接） |
| 部署目标 | `D:\ErnestVault\.obsidian\plugins\bimo` |
| 用户数据 | `_system/attachments/Ink/`、`.bimo/` |

工程**完全不在 vault 里**。vault 内只留一页 `06-Projects/笔墨插件.md` 作为项目卡。

### D.2 部署目标怎么解析

`scripts/deploy.mjs` 按顺序取：

1. 环境变量 `BIMO_PLUGIN_DIR`
2. 工程根的 `.bimo-target` 文件（一行绝对路径，用正斜杠）
3. `../../.obsidian/plugins/bimo`（仅当工程确实位于 vault 内时才正确）

`.bimo-target` 当前内容：

```
D:/ErnestVault/.obsidian/plugins/bimo
```

换 vault、换机器时只改这一行。**注意别用 `printf` 写这个文件**——`\E`、`` 会被 shell 当转义吃掉，路径变成不可用的乱码。用编辑器或 `Write` 工具写。

### D.3 为什么不用 Junction

试过「依赖移到 `D:imo-deps`、项目内建目录联接」的方案，**结果 Obsidian 打不开**。

原因：`.obsidian/app.json` 的 `userIgnoreFilters` 只影响索引与搜索，**不影响文件系统 watcher**。Windows 上 Obsidian 的 watcher 会跟随 Junction 递归进去，启动时要遍历三万多个文件。

现在连源码也不放 vault 了。`node_modules` 无论实体还是链接，都不要再出现在 vault 路径下。

### D.4 启动慢的真正元凶：IndexedDB 元数据缓存

2026-10-23 排查记录。

把 `node_modules` 放进 vault 那段时间，Obsidian 不仅扫描了文件系统，还把三万个文件写进了元数据缓存：

| 位置 | 体积 | 正常值 |
|:--|--:|:--|
| `%APPDATA%\obsidian\IndexedDB` | **151 MB** | 十几 MB |
| `%APPDATA%\obsidian\Cache` | 190 MB | 可随时清 |

特征：`app_obsidian.md_0.indexeddb.leveldb/` 下短时间内写入大量 2.1 MB 的 `.ldb` 分片。

**文件删掉后缓存不会自己缩**。启动时要加载并反序列化这个 151 MB 数据库，于是越用越慢，最终打不开。

修复：

```powershell
# 必须先退出 Obsidian
$app = "$env:APPDATA\obsidian"
Copy-Item "$app\IndexedDB" "D:\obsidian-cache-backup-$(Get-Date -f yyyy-MM-dd)" -Recurse
Remove-Item "$app\IndexedDB" -Recurse -Force
Remove-Item "$app\Cache","$app\Code Cache","$app\GPUCache" -Recurse -Force
```

删 IndexedDB 的代价：Obsidian 重建一次索引（2,450 个文件，很快）；若装了建向量索引的插件（如 copilot），它会重新索引。

### D.5 自检

```bash
cd /d/ErnestVault
find . -type f -not -path "./.obsidian/*" | wc -l    # 应在 2,400 上下
find . -type l | head                                # 应为空
ls -d 06-Projects/bimo 2>/dev/null                   # 应报不存在
du -sm "$APPDATA/obsidian/IndexedDB"                 # 应十几 MB
```

### D.6 换机器

```bash
git clone <仓库> D:/bimo-src     # 或用压缩包
cd D:/bimo-src
npm ci
node scripts/deploy.mjs          # 会读 .bimo-target
```

`.bimo-target` 若指向别的 vault，改一行即可。
