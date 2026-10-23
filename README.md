---
title: 笔墨（bimo）
date: 2026-10-23
tags:
  - bimo
  - project
  - readme
---

# 笔墨（bimo）

Obsidian 手写与批注插件。在笔记段落之间手写、画无限画布，或者直接在笔记正文和 PDF 页面上落笔；写完可以让模型把笔迹识别成 Markdown。

插件本体安装在 `.obsidian/plugins/bimo/`，源码就是这个文件夹。

## 它和普通手写插件的区别

| 能力 | 说明 |
|:--|:--|
| 段落间手写 | 一行嵌入，写完整页可按 `Aa` 切换成识别后的文本 |
| 笔记上直接书写 | 不占正文、不插入占位符，笔迹浮在 Markdown 文字上方，笔记文件零改动 |
| PDF 批注 | 任意页渲染成底图，多页一次生成，自动维护批注索引 |
| 手写识别 | 接任意 OpenAI 兼容端点（Chat Completions 或 Responses），不依赖任何官方后端 |
| AI 边注 | 停笔后自动在纸边浮现一句回应 |
| 函数绘图 | 说一句「画 y = sin(x)/x」，本地采样生成 SVG |
| 导出 | Excalidraw（可编辑矢量）、Mermaid（AI 解读） |

## 目录结构

```
06-Projects/bimo/
├── src/                 插件源码
│   ├── components/      UI：嵌入块、编辑器、设置页、弹窗
│   ├── ink-canvas/      自研 SVG 绘图引擎
│   ├── logic/           业务逻辑（md-ink 书写层、pdf 批注、ai、转录）
│   └── i18n/            中英文字典
├── tests/               单元测试与集成测试
├── scripts/             构建、部署、检查脚本
├── dist/                构建产物（main.js / styles.css）
├── docs/                开发文档
├── manifest.json        插件清单（Obsidian 读取）
└── package.json         构建依赖
```

## 开发

```bash
npm install          # 首次
npm run dev          # 监听构建
npm run build        # 类型检查 + 生产构建
npm run deploy       # 构建并复制到 .obsidian/plugins/bimo，校验 md5
npm run check        # 类型检查 + i18n 覆盖率
npm test             # 逻辑层单元测试
```

> **不要在 vault 里常驻 `node_modules`。** 它有 3.2 万个文件，留在 vault 里会让
> Obsidian 启动扫描卡死；用目录联接指向外部同样不行——Obsidian 的 watcher 会跟随
> 链接递归进去。正确做法是临时安装、用完删除：
>
> ```bash
> npm ci && npm run deploy && rm -rf node_modules
> ```
>
> 详见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 附录 D。

改代码之后必须 `npm run deploy`（或手动复制 `dist/` 三件套），再在 Obsidian 里
`Ctrl+P` → **Reload app without saving**。**插件不会自动热更新源码**——只改文件不部署，跑的还是旧代码。

## 磁盘格式：为什么有些标识仍叫 `Ink`

为了不破坏已有笔记，以下三项**故意保留原样**，改掉会让旧数据全部失效：

| 保留项 | 位置 | 后果（若改名） |
|:--|:--|:--|
| 附件子目录 `Ink/` | `src/constants.ts` | 所有笔记里的 `![[.../Ink/Writing/x.svg]]` 全部断链 |
| 文件标识 `handwritten-ink` / `handdrawn-ink` | 嵌入语法 | 旧嵌入无法识别 |
| SVG 元数据 `inkWriting` / `inkCanvas` | 文件内部 | 旧文件读不出内容 |

产品名、界面文案、命令名都是「笔墨」，只有**落在磁盘上的路径和格式标识**保持原值。

## 数据位置

| 内容 | 路径 |
|:--|:--|
| 段落间手写的 SVG | `<附件目录>/Ink/Writing/` |
| 绘图 SVG | `<附件目录>/Ink/Drawing/` |
| PDF 页图与索引 | `<附件目录>/Ink/PDF/<hash>-<文件名>/` |
| AI 生成的函数图 | `<附件目录>/Ink/AI/` |
| 笔记上的笔迹 | `.bimo/md-ink/`、`.bimo/pdf-ink/` |
| 插件设置 | `.obsidian/plugins/bimo/data.json` |

## 开发文档

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 架构、数据流、调试方法、排查纪律
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 逐轮开发记录与决策依据
