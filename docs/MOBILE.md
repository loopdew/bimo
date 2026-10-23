# 移动端（Android 平板 / iPad）

本文记录笔墨在触屏设备上的行为约定、代码位置，以及尚未验证的部分。

## 1. 触摸模型：笔书写，手指滚动

这是整套移动端适配的核心决定，也是最容易做错的地方。

| 输入 | 行为 |
|:--|:--|
| **手写笔**（`pointerType === 'pen'`） | 总是书写，压感生效 |
| **手指**（`pointerType === 'touch'`），默认 | 滚动 / 缩放页面，**不画** |
| **手指**，开启「允许手指书写」后 | 书写 |
| **鼠标** | 由「允许鼠标书写」单独控制 |
| **第二根手指落下** | 取消进行中的笔画，转为双指缩放 |

### 为什么默认不让手指画

手写插件在平板上最常见的失败不是画不出来，而是**画得出来却滚不动**：

- `touch-action: none` 会让图层抢走整个触摸流
- 一旦选中笔，单指滑动被解释成一条线
- 想翻页只能靠双指，但双指又被当成两笔

所以默认反过来：**手指的语义是导航，笔的语义是书写**。这与 GoodNotes、Notability、Squid 一致。

### 代码位置

| 目的 | 位置 |
|:--|:--|
| 触摸分流判定 | `src/logic/md-ink/md-ink-overlay.ts` → `onPointerDown` |
| PDF 层同理 | `src/logic/md-ink/pdf-ink-overlay.ts` → `bindPointer` |
| 双指取消 | `abortActiveStroke()`（同文件） |
| `touch-action` 切换 | `src/styles/md-ink.scss`，键为 `[data-finger-draws]` |
| 设置项 | `mdInkFingerDraws`，默认 `false` |

CSS 契约：

```scss
.bimo-md-ink-layer            { touch-action: pan-y pinch-zoom; }  /* 默认：能滚 */
.bimo-md-ink-layer[data-finger-draws='true'] { touch-action: none; } /* 手指画时才抢触摸流 */
```

`data-finger-draws` 由 `applyToolCursor()` 写入，所以切换设置立即生效，不需要重开笔记。

## 2. PDF 渲染按平台降分辨率

| 平台 | Scale | 单页 RGBA 占用（A4） |
|:--|--:|--:|
| 桌面 | 2.0 | ≈ 7.8 MB |
| 移动端 | 1.5 | ≈ 4.4 MB |

移动 WebView 的 canvas 后备存储上限约为 16 MB，2× 渲染连续三页就会被系统杀掉。降到 1.5× 后仍能在正常缩放下看清正文。

Scale 被写进缓存文件名（`p<page>@<scale>x.png`），所以桌面与平板各自缓存，互不覆盖。

代码：`src/logic/pdf/pdf-page-to-image.ts` → `renderScale()`。

## 3. base64 编码分块

移动端没有 `Buffer`，走 `btoa` 分支。原实现是逐字节拼接字符串：

```ts
for (const byte of bytes) binary += String.fromCharCode(byte);
```

这种写法在部分引擎上是 O(n²)，一页手写 SVG 有几 MB 时会在平板上明显卡顿。现改为 8 KB 分块 `String.fromCharCode(...chunk)`。

代码：`src/logic/transcription-providers/media.ts` → `encodeUtf8TextToBase64()`。

## 4. 保存失败会明确提示

页面书写层的数据写在 `.bimo/md-ink/*.json`，通过 Obsidian 的 `vault.adapter` 落盘。移动端的 vault 是沙盒目录，写失败不是不可能。

原实现只 `console.warn`，用户画完、看到墨迹、重开发现全没了，且毫无提示。现在失败会弹一次 Notice（30 秒内不重复，避免每笔都弹）。

代码：`src/logic/md-ink/md-ink-store.ts` → `save()`。

## 5. 在 Android 平板上安装

笔墨不在社区插件市场，需要手动放置文件：

```
<vault>/.obsidian/plugins/bimo/
├── main.js
├── styles.css
└── manifest.json
```

三个文件都要，缺一不可。之后在 Obsidian 设置里启用。

`.bimo-target` 只用于桌面端 `npm run deploy`，不需要复制到平板。

> **注意**：`.obsidian/` 是点开头目录，部分 Android 文件管理器默认隐藏。用支持显示隐藏文件的（如 Material Files、Solid Explorer）。

## 6. 需要在真机上验证的清单

以下是**代码层面已处理、但没有在真机上跑过**的部分。安卓平板到手后按顺序验：

| # | 验证项 | 失败意味着 |
|:--|:--|:--|
| 1 | 用笔写一笔 → 锁定 → 重开笔记，笔迹还在 | `.bimo/` 写不进去，或保存失败提示未出现 |
| 2 | 手指单指上下滑动页面 | 触摸分流没生效，`touch-action` 没应用上 |
| 3 | 笔写的同时用手指滚动 | 双指/多指取消逻辑有问题 |
| 4 | 双指捏合缩放 | `pinch-zoom` 被某层覆盖 |
| 5 | PDF 批注：选 3 页生成 | 内存不足（把 scale 再降到 1.25） |
| 6 | 手写转录一次（需配置 API） | 移动端 `btoa` 路径或网络权限问题 |
| 7 | 工具栏拖动 | `pill-drag` 的指针捕获在触屏上的表现 |

第 1 项是生死线：如果它失败，页面书写功能在平板上等于不可用。

## 7. 已知限制

| 限制 | 说明 |
|:--|:--|
| 手机屏幕 | 块内手写基本无法使用；阅读与转录视图正常 |
| 手掌误触 | 未做专门的 palm rejection。笔的 `pointerType` 分流能挡掉大部分，但没有按接触面积判定 |
| 工具栏位置 | 存的是相对编辑器的偏移，横竖屏切换后会重新夹紧，可能不是原来的角 |
| 折叠屏 | 未测试 |
