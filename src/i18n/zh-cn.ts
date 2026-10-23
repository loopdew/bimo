/**
 * 简体中文词典。
 *
 * 键是英文原文（见各调用点的 `t('…')`），值是对应中文。英文模式下无需此表。
 * 专有名词保留原文：Markdown、SVG、PNG、Boox、tldraw、ink-canvas、API。
 */
export const ZH_CN: Record<string, string> = {
	// ── 通用 ──────────────────────────────────────────────
	'Hand write or draw directly between paragraphs in your notes.':
		'在笔记的段落之间直接手写或绘图。',
	'Interface language': '界面语言',
	'Auto follows Obsidian. The change applies immediately.':
		'「自动」会跟随 Obsidian 的界面语言。修改后立即生效。',
	'Auto (follow Obsidian)': '自动（跟随 Obsidian）',
	'Cancel': '取消',
	'Done': '完成',
	'Reset': '重置',
	'Test': '测试',
	'Testing…': '测试中…',
	'Left': '左手',
	'Right': '右手',

	// ── 设置页：引导与开发 ────────────────────────────────
	'Getting started': '开始使用',
	'Tips for using 笔墨, compatibility with other processes, and migrating from older versions.':
		'笔墨的使用技巧、与其他程序共存时的注意事项，以及从旧版本迁移的说明。',
	'View recent changes': '查看最近更新',
	'Rewatch welcome tips': '重看欢迎提示',
	'Show migration options…': '显示迁移选项…',
	'Developer: Migrate tldraw SVG to ink-canvas': '开发者：把 tldraw SVG 迁移到 ink-canvas',
	'Migrate tldraw SVGs…': '迁移 tldraw SVG…',
	'Reset settings…': '重置设置…',
	'Reload plugin': '重载插件',
	'Reload plugin (development)': '重载插件（开发用）',
	'Write runtime diagnostics to .bimo/diagnostics.txt': '写出运行时诊断到 .bimo/diagnostics.txt',
	'Diagnostics written to .bimo/diagnostics.txt': '诊断已写入 .bimo/diagnostics.txt',
	'Mouse drawing is turned off. Enable “Draw with the mouse” in Writing on notes, or use a stylus.':
		'鼠标绘制已关闭。在「在笔记上书写」里打开「允许鼠标绘制」，或改用触控笔。',
	'reloaded': '已重载',
	'Could not reload the plugin.': '无法重载插件。',

	// ── 设置页：总开关 ────────────────────────────────────
	'Enable writing': '启用书写',
	'If disabled, you will not be able to add new writing embeds and those already embedded will appear as raw code. Existing writing files will be hidden in Obsidian but still exist on disk. Changing this setting will require a restart of Obsidian to take effect.':
		'关闭后无法再插入新的书写区块，已有的书写区块会显示为原始代码。磁盘上的书写文件仍然保留，只是在 Obsidian 中不再显示。修改此项需要重启 Obsidian 才会生效。',
	'Enable drawing': '启用绘图',
	'If disabled, you will not be able to add new drawing embeds and those already embedded will appear as raw code. Existing drawing files will be hidden in Obsidian but still exist on disk. Changing this setting will require a restart of Obsidian to take effect.':
		'关闭后无法再插入新的绘图区块，已有的绘图区块会显示为原始代码。磁盘上的绘图文件仍然保留，只是在 Obsidian 中不再显示。修改此项需要重启 Obsidian 才会生效。',
	'Enable finger drawing': '允许手指绘制',
	'Shows a toolbar toggle while editing so you can draw with your finger on touch devices. When off, fingers scroll the note as usual.':
		'编辑时在工具栏显示开关，让你在触屏设备上用手指绘制。关闭时，手指仍按正常方式滚动笔记。',
	'Dominant hand': '惯用手',
	'Which side undo/redo and extend controls appear on while editing.':
		'编辑时撤销/重做与延伸控件出现在哪一侧。',
	'High contrast user interface': '高对比度界面',
	'Uses high-contrast borders and controls across 笔墨 embeds and editors — suited to e-ink and grayscale displays.':
		'在笔墨的区块与编辑器中使用高对比度边框和控件，适合墨水屏与灰度显示屏。',
	'Experimental changes': '实验性功能',
	'Features under active testing. They may not work on all devices and might be removed or changed in the next release. Expand for details.':
		'仍在测试中的功能，可能无法在所有设备上正常工作，也可能在下个版本被移除或更改。展开查看详情。',
	'Enable Boox companion app': '启用 Boox 伴侣应用',
	'Connects to the Boox companion app for passing through smoother pen strokes on supported tablets.':
		'连接 Boox 伴侣应用，在受支持的平板上获得更顺滑的笔迹。',
	'Side button temporary eraser': '笔身侧键临时橡皮',
	'While held, the pen barrel button (button 2) erases instead of panning. May conflict with right-click pan on some setups.':
		'按住笔身侧键（按键 2）时改为擦除而非平移。某些环境下可能与右键平移冲突。',
	'Show grid in new drawings': '新绘图默认显示网格',
	'Show frame around drawing when not editing': '非编辑状态显示绘图边框',
	'Show background when not editing': '非编辑状态显示背景',
	'Automatically transcribe drawings': '自动识别绘图',
	'Automatically transcribe writing': '自动识别书写',
	'Show ruled lines when not editing': '非编辑状态显示横线',
	'Line height': '行高',
	'Height in pixels of each ruled line. Only affects new writing embeds.':
		'每条横线的像素高度，仅影响新建的书写区块。',
	'Buffer lines when editing': '编辑时的缓冲行数',
	'Number of empty lines shown below your writing while editing. Writing reaches the last line before the embed extends in height.':
		'编辑时在书写内容下方显示的空行数量。写到最后一行后，区块会自动向下延伸。',
	'Writing files subfolder': '书写文件子目录',
	'Drawing files subfolder': '绘图文件子目录',
	'Customise file organisation': '自定义文件组织方式',
	'Smoothing and pressure': '平滑与压感',
	'Drawing': '绘图',
	'Writing': '书写',
	'While editing a Markdown file, run the action \'insert new hand drawn section\' to embed a drawing canvas.':
		'编辑 Markdown 文件时，执行「插入手绘区块」即可嵌入绘图画布。',
	'While editing a Markdown file, run the action \'new handwriting section\' to embed a section for writing with a pen.':
		'编辑 Markdown 文件时，执行「插入手写区块」即可嵌入可手写的区块。',
	'This plugin is in beta': '本插件处于测试阶段',
	'Always back up your files. Expand for details.': '请务必定期备份文件。展开查看详情。',
	'Enable debug logging': '启用调试日志',
	'When enabled, debug information is written to an ink-debug.md file in your vault root. This includes writing and drawing activity, so do not enable this unless you are actively troubleshooting a bug to provide logs for a bug report. Disable it again once you\'re done.':
		'启用后，调试信息会写入库根目录的 ink-debug.md，其中包含书写与绘图活动记录。除非正在排查问题并需要提供日志，否则不要开启；排查结束后请关闭。',
	'Re-transcribe when ink file changes significantly': '笔迹变化较大时才重新识别',
	'0% always transcribes on close or sync; 95% only when ink is almost entirely different. Manual triggered  transcriptions ignore this.':
		'0% 表示每次关闭或同步都重新识别；95% 表示只有笔迹几乎完全不同时才识别。手动触发的识别不受此项影响。',
	'Where should 笔墨 files be saved when created in a note?': '在笔记中新建的笔墨文件应保存到哪里？',
	'Obsidian attachment folder': 'Obsidian 附件文件夹',
	'Vault root': '库根目录',
	'Next to the note': '笔记所在目录',

	// ── 转录 API（本插件新增）────────────────────────────
	'Transcription API': '识别 API',
	'Provider preset': '常用供应商',
	'Custom / manual': '自定义 / 手动填写',
	'Fill in the address and a suggested model for a known provider. Choose "Custom" to keep your own values.':
		'选择常用供应商，自动填好接口地址和一个建议模型。选「自定义 / 手动填写」则保留你自己填的值。',
	'API format': 'API 格式',
	'Chat Completions is the safest choice — every compatible provider implements it. Responses is OpenAI’s newer native format, needed by some reasoning models that reject images on the legacy endpoint.':
		'Chat Completions 最稳妥，几乎所有兼容服务都实现了它。Responses 是 OpenAI 较新的原生格式，部分推理模型只在这个端点上接受图片。',
	'Chat Completions — /chat/completions': 'Chat Completions — /chat/completions',
	'Responses — /responses': 'Responses — /responses',
	'Base URL': '接口地址',
	'Root URL, e.g. https://api.openai.com/v1. A full …/chat/completions or …/responses URL also works.':
		'根地址，例如 https://api.openai.com/v1。直接粘贴完整的 …/chat/completions 或 …/responses 地址也可以。',
	'API key': 'API 密钥',
	'Stored as plain text in data.json, which normally syncs with the vault. Use a dedicated low-quota key, and leave this blank for endpoints that need no auth.':
		'以明文保存在 data.json 中，通常会随库一起同步。建议使用单独的、低额度的密钥；无需鉴权的接口留空即可。',
	'Model': '模型',
	'Click "Fetch models" to list what this key can access, or type an ID directly.':
		'点「获取模型」可列出这个密钥能用的模型并下拉选择；也可以直接手填模型 ID。',
	'Fetch models': '获取模型',
	'Fetching…': '获取中…',
	'Image format': '图片格式',
	'PNG is required by the official OpenAI API, which rejects SVG image inputs. Only choose SVG for endpoints that explicitly document SVG vision support.':
		'OpenAI 官方接口只接受 PNG，会拒绝 SVG 图片输入。只有明确支持 SVG 视觉的接口才选 SVG。',
	'PNG — rasterised, widest support': 'PNG — 栅格化，兼容性最好',
	'SVG — smallest payload, exotic endpoints only': 'SVG — 体积最小，仅特殊接口可用',
	'Max output tokens': '最大输出 token 数',
	'0 = do not send a token limit field.': '0 表示不发送该字段。',
	'Temperature': '温度',
	'Blank = do not send. Some reasoning models only accept their default.': '留空表示不发送。部分推理模型只接受默认值。',
	'blank': '留空',
	'Timeout (ms)': '超时（毫秒）',
	'How long the queue waits before treating the request as failed. 0 = no limit.':
		'排队等待多久后判定请求失败。0 表示不限制。',
	'Transcription prompt': '识别提示词',
	'Leave blank to use the built-in prompt. It is sent as a system message; the image goes in a separate user turn.':
		'留空则使用笔墨内置提示词。它作为 system 消息发送，图片单独放在用户消息里。',
	'Thinking mode': '思考模式',
	'Transcription is recognition, not reasoning — thinking only adds latency. Measured on DeepSeek: turning it off was 2x faster and 20% fewer tokens with identical accuracy. Use "Provider default" if your model rejects the switch.':
		'转录是识别，不是推理，思考只会拖慢速度。DeepSeek 实测：关闭后快 2 倍、少用 20% token，准确率不变。如果模型不支持关闭，选「默认」。',
	'Provider default — send nothing': '默认 — 不发送任何参数',
	'Off — fastest': '关闭 — 最快',
	'Low': '低',
	'Medium': '中',
	'High': '高',
	'Extra body JSON': '额外请求体 JSON',
	'Optional object merged into the request body last — wins over every default. Example: {"reasoning_effort":"low"}':
		'可选。会最后合并进请求体，优先级高于所有默认字段。示例：{"reasoning_effort":"low"}',
	'Extra headers JSON': '额外请求头 JSON',
	'Optional object of extra request headers. Azure OpenAI example: {"api-key":"…"}':
		'可选。附加请求头对象。Azure OpenAI 示例：{"api-key":"…"}',
	'Test connection': '测试连接',
	'Sends a 1×1 image through the real request path: URL, auth, model, format, and vision support.':
		'发送一张 1×1 的图片，走完整请求链路，验证地址、鉴权、模型、格式与视觉能力。',

	// ── 识别相关提示 ─────────────────────────────────────
	'Transcription already in progress for this file': '该文件正在识别中',
	'Transcription will start when the current job finishes': '当前任务完成后会自动开始识别',
	'Resuming handwriting transcription ({count} {word})': '继续识别手写内容（{count} {word}）',
	'file': '个文件',
	'files': '个文件',
	'Could not read ink file for transcription': '无法读取该笔墨文件，识别失败',
	'Nothing to transcribe': '没有可识别的内容',
	'This file can\'t be transcribed currently because it is too long. This will be fixed in a future update to 笔墨.':
		'该文件太长，目前无法识别。后续版本会解决这个问题。',

	// ── 命令面板 ─────────────────────────────────────────
	'New handwriting section': '新建手写区块',
	'Existing handwriting section': '插入已有手写区块',
	'New drawing': '新建绘图',
	'Existing drawing': '插入已有绘图',
	'Transcribe': '识别',
	'Update transcript': '更新识别结果',

	// ── 笔输入与自动识别说明 ─────────────────────────────
	'Pen': '笔',
	'Mouse': '鼠标',
	'None': '无',
	'writing': '书写',
	'drawing': '绘图',
	'Automatically detect pen or mouse from pressure (auto), use pen pressure and faithful smoothing (pen), or simulated pressure with higher smoothing (mouse).':
		'根据压感自动判断是笔还是鼠标（自动）；或固定按笔处理，使用真实压感与忠实平滑（笔）；或按鼠标处理，用模拟压感换取更高平滑度（鼠标）。',
	'Last detected input: ': '上次识别到的输入：',
	'If detection is incorrect, choose Pen or Mouse manually.': '如果判断有误，请手动选择「笔」或「鼠标」。',
	"When you lock a {kind} embed or close a dedicated {kind} view, queue the {kind} file to be transcribed automatically. Manual Transcribing in the ink file's menu always stays available.":
		'锁定{kind}区块或关闭独立的{kind}视图时，自动把该{kind}文件加入识别队列。笔墨文件菜单中的手动识别始终可用。',

	// ── 校验提示 ─────────────────────────────────────────
	'Base URL is empty.': '接口地址不能为空。',
	'Model is empty.': '模型不能为空。',
	'{label} must be a JSON object.': '{label} 必须是 JSON 对象。',
	'{label} is not valid JSON.': '{label} 不是合法的 JSON。',

	"'s servers, then to ": ' 的服务器，再转发给 ',
	'Transcription Queue': '识别队列',

	// ── 迁移 ─────────────────────────────────────────────
	'Bulk-convert v2 SVG files still on <tldraw> metadata (referenced by embeds) to ink-canvas in place. Drawing embed viewBox is refit to stroke bounds.':
		'把仍在使用 <tldraw> 元数据的 v2 SVG 文件（被嵌入引用的那些）就地转换为 ink-canvas，并根据笔迹边界重新适配绘图区块的 viewBox。',

	// ── 其余界面文案 ─────────────────────────────────────
	'"笔墨: new drawing"':
		'"笔墨：新建绘图"',
	'"笔墨: new handwriting section"':
		'"笔墨：新建手写区块"',
	'( Cmd+P or swipe down )':
		'（ Cmd+P 或下拉 ）',
	'Auto-transcribe your ink':
		'自动识别你的笔墨内容',
	'Beta means the plugin is still evolving. Changes to embed formats and file-handling features, even when thoroughly tested, may occasionally introduce issues that affect your vault. Always keep backups of your data.':
		'测试版意味着插件仍在演进。嵌入格式与文件处理方式的改动即使经过充分测试，也可能偶尔影响你的库。请始终保留数据备份。',
	'Better selections and transformations.':
		'更完善的选区与变换。',
	'Changes in this version':
		'本次更新内容',
	'Convert':
		'转换',
	'Convert to Drawing':
		'转换为绘图',
	'Convert to Writing':
		'转换为书写',
	'Converting older SVG files…':
		'正在转换旧版 SVG 文件…',
	'Converting…':
		'转换中…',
	'Copy embed':
		'复制嵌入',
	'Copy transcript':
		'复制识别结果',
	'Could not find the note for this embed':
		'找不到该嵌入所属的笔记',
	'Could not read embed Markdown to copy':
		'无法读取嵌入的 Markdown 内容',
	'Delete':
		'删除',
	'Delete embed':
		'删除嵌入',
	'Drawing embed framing':
		'绘图嵌入的取景',
	'Drawing file duplicated':
		'绘图文件已复制',
	'Drawing sections...':
		'绘图区块…',
	'Duplicate and convert copy':
		'复制并转换副本',
	'Embed copied to clipboard':
		'嵌入已复制到剪贴板',
	'Embeds':
		'嵌入',
	'Erase all':
		'全部擦除',
	'Erase all strokes?':
		'擦除所有笔迹？',
	'Failed to copy embed to clipboard':
		'复制嵌入到剪贴板失败',
	'Failed to copy transcript to clipboard':
		'复制识别结果到剪贴板失败',
	'Fuller full screen mode.':
		'更完整的全屏模式。',
	'Grid on/off':
		'网格开关',
	'Here\'s a quick rundown to help you get started...':
		'下面快速介绍一下，帮你上手…',
	'Hiding old strokes helps keep pen latency down and the writing experience smooth.':
		'隐藏旧笔迹有助于降低笔的延迟，保持书写流畅。',
	'High contrast mode.':
		'高对比度模式。',
	'Hold cmd/ctrl to switch to eraser temporarily.':
		'按住 Cmd/Ctrl 可临时切换到橡皮。',
	'If satisfied, delete test conversions folder.':
		'确认无误后，删除测试转换文件夹。',
	'If using "Obsidian Sync", turn on "sync all other types" in the Obsidian Sync settings.':
		'如果使用「Obsidian Sync」，请在同步设置中开启「同步所有其他类型」。',
	'If using Obsidian Sync, turn on "sync all other types" in the Obsidian Sync settings.':
		'如果使用 Obsidian Sync，请在同步设置中开启「同步所有其他类型」。',
	'In any Markdown note, run the following command to begin writing where your Cursor is.':
		'在任意 Markdown 笔记中执行以下命令，即可在光标处开始书写。',
	'笔墨 drawing file not found.':
		'找不到 笔墨 绘图文件。',
	'笔墨 files live in your vault and can sync with it to other devices.':
		'笔墨 文件存放在你的库中，会随库同步到其他设备。',
	'笔墨 is all about enabling pen use directly in your Markdown notes.':
		'笔墨 的目标是让你直接在 Markdown 笔记里用笔。',
	'笔墨 plugin settings reset':
		'笔墨设置已重置',
	'笔墨 writing file invalid.':
		'笔墨 书写文件无效。',
	'Inserting handwriting sections...':
		'插入手写区块…',
	'Layout changes':
		'布局变化',
	'Legacy 笔墨 file':
		'旧版 笔墨 文件',
	'Legacy tldraw format: layout adjustment does not apply. Only metadata and embed type will change.':
		'旧版 tldraw 格式：布局调整不适用，只会更改元数据与嵌入类型。',
	'Lines disappearing?':
		'横线消失了？',
	'Locked embeds':
		'锁定的嵌入',
	'Migrate':
		'迁移',
	'Migrate Legacy 笔墨 Files':
		'迁移旧版 笔墨 文件',
	'Migrate Permanently':
		'永久迁移',
	'Migrate legacy ink embeds to ink-canvas':
		'把旧版 ink 嵌入迁移到 ink-canvas',
	'Migrate legacy ink files to new format':
		'把旧版 ink 文件迁移到新格式',
	'Migrate tldraw SVG files to ink-canvas':
		'把 tldraw SVG 文件迁移到 ink-canvas',
	'Migrate to new format':
		'迁移到新格式',
	'Migrated to the new SVG format.':
		'已迁移到新的 SVG 格式。',
	'Migrating…':
		'迁移中…',
	'Never fear though, all your strokes still exist and will become visible again later.':
		'别担心，所有笔迹都还在，稍后会重新显示。',
	'No legacy 笔墨 files were found in your vault. Nothing to migrate.':
		'库中没有找到旧版 笔墨 文件，无需迁移。',
	'No transcript to copy':
		'没有可复制的识别结果',
	'No v2 tldraw SVG files referenced by embeds were found. Nothing to migrate.':
		'没有找到被嵌入引用的 v2 tldraw SVG 文件，无需迁移。',
	'Nothing to copy':
		'没有可复制的内容',
	'Obsidian Sync':
		'Obsidian Sync',
	'Open 10 random notes':
		'打开 10 篇随机笔记',
	'Open drawing':
		'打开绘图',
	'Open writing':
		'打开书写',
	'Please confirm':
		'请确认',
	'Preview unavailable':
		'预览不可用',
	'Remove and delete file':
		'移除并删除文件',
	'Remove embed':
		'移除嵌入',
	'Right click or tap and hold on a locked embed to copy or delete it.':
		'在锁定的嵌入上右键或长按，可复制或删除。',
	'Run migration again permanently.':
		'再次执行永久迁移。',
	'Scanning for .writing / .drawing files…':
		'正在扫描 .writing / .drawing 文件…',
	'Scanning for older tldraw SVG files…':
		'正在扫描旧版 tldraw SVG 文件…',
	'Scanning vault for ink files…':
		'正在扫描库中的 ink 文件…',
	'Scanning vault for legacy embeds…':
		'正在扫描库中的旧版嵌入…',
	'Scanning vault for notes that embed this file…':
		'正在扫描嵌入了该文件的笔记…',
	'Scanning vault for tldraw SVG files…':
		'正在扫描库中的 tldraw SVG 文件…',
	'Search by filename...':
		'按文件名搜索…',
	'Syncing with your vault...':
		'正在与你的库同步…',
	'Temporary eraser':
		'临时橡皮',
	'Test Migration':
		'测试迁移',
	'Test migration complete':
		'测试迁移完成',
	'The drawing embed viewbox in affected notes will be recalculated to fit the ink. Stroke positions are unchanged.':
		'受影响笔记中的绘图嵌入 viewBox 会重新计算以贴合笔迹，笔迹位置不会改变。',
	'There was an error finding a non-conflicting filename.':
		'寻找不冲突的文件名时出错。',
	'These can be added too and can be resized right in your Markdown file. Use the purple lock icon to save framing, or the standard lock icon to save the drawing but revert the framing.':
		'绘图也可以插入，并直接在 Markdown 文件中调整尺寸。紫色锁图标会保存取景，标准锁图标会保存绘图但还原取景。',
	'This file is not embedded in any notes.':
		'该文件没有被任何笔记嵌入。',
	'This is a legacy 笔墨 file and won\'t support all the newest features. You can migrate it to the new SVG format now.':
		'这是旧版 笔墨 文件，无法使用全部最新功能。你可以现在就把它迁移到新的 SVG 格式。',
	'This version of 笔墨 uses a new SVG format. Migrate legacy .writing/.drawing files and older 笔墨 SVG files still on the previous format to unlock newer features.':
		'此版本 笔墨 使用新的 SVG 格式。迁移旧版 .writing/.drawing 文件以及仍处于旧格式的 笔墨 SVG 文件，即可使用新功能。',
	'To help keep writing smooth...':
		'为了保持书写流畅…',
	'Transcript copied to clipboard':
		'识别结果已复制到剪贴板',
	'Two fingers or right mouse button to reframe. Cmd + right mouse button to zoom, or Cmd + scroll wheel.':
		'双指或鼠标右键可重新取景；Cmd + 右键或 Cmd + 滚轮可缩放。',
	'Unified redo':
		'统一重做',
	'Unified undo':
		'统一撤销',
	'Use "Duplicate and convert copy" to convert a copy and update only this note\'s embed. Other notes keep the original file.':
		'使用「复制并转换副本」只转换一份副本并更新当前笔记的嵌入，其他笔记仍保留原文件。',
	'Welcome to ink':
		'欢迎使用笔墨',
	'What\'s next:':
		'接下来：',
	'When you lock or save the embed, those strokes become visible again.':
		'锁定或保存该嵌入后，这些笔迹会重新显示。',
	'Writing file duplicated':
		'书写文件已复制',
	'You may have noticed that your handwriting lines have started disapearing...':
		'你可能已经注意到手写横线开始消失了…',

	// Brush presets / 笔触
	'Brush': '笔刷',
	'Brush style': '笔触样式',
	'Fountain pen': '钢笔',
	'Pencil': '铅笔',
	'Marker': '马克笔',
	'Technical pen': '细线笔',
	'Crayon': '蜡笔',
	'Highlighter': '荧光笔',
	'Brush pen': '毛笔',
	'Translucent — draws over existing ink': '半透明 — 覆盖在已有笔迹之上',
	'Opaque': '不透明',

	// Custom API settings block / 自定义 API 设置区块
	'Fill in the address and a suggested model for a known provider. ':
		'选择已知服务商后，会自动填入地址和推荐模型。 ',
	'Chat Completions is the safest choice — every compatible provider implements it. ':
		'Chat Completions 最稳妥——几乎所有兼容服务商都实现了它。 ',
	'Stored as plain text in data.json, which normally syncs with the vault. ':
		'以明文存放在 data.json 里，通常会随库一起同步。 ',
	'PNG is required by the official OpenAI API, which rejects SVG image inputs. ':
		'OpenAI 官方 API 只接受 PNG，会拒绝 SVG 图像输入。 ',
	'Transcription is recognition, not reasoning — thinking only adds latency. ':
		'转录是识别而不是推理，思考只会增加延迟。 ',

	// AI / AI 能力
	'Plot a function with AI': 'AI 画函数图像',
	'Plot a function': '画函数图像',
	'Describe the function in words, or write it directly. The model only decides the expression; the curve is drawn locally, so it is exact.':
		'用文字描述这个函数，或直接写式子。模型只负责确定表达式，曲线由本地绘制，因此是精确的。',
	'Figure inserted': '图像已插入',
	'Enable a custom API in settings first.': '请先在设置里启用自定义 API。',
	'The model did not return a usable function.': '模型没有返回可用的函数。',
	'The function produced no drawable points in this range.': '这个函数在该范围内没有可绘制的点。',
	'Could not create the Ink/AI folder.': '无法创建 Ink/AI 文件夹。',
	'Could not draw the function': '绘制函数失败',
	'OK': '确定',
	'Magic margin': '魔法页边',
	'Write a line; I will answer in the margin.': '写一句，我在页边答你。',
	'Ask anything…': '问点什么…',
	'Ask the margin': '问问页边',
	'Send': '送去',
	'Insert last reply': '插入最后一条',
	'Inserted into the note': '已插入笔记',
	'Could not reach the endpoint. Check the settings and the key.': '没能连上。检查一下设置里的接口和密钥。',

	// PDF annotation / PDF 批注
	'Annotate PDF pages': '在 PDF 页面批注',
	'Could not read the PDF page image from the viewer.': '无法从 PDF 阅读器读取页面图像。',
	'Could not create the Ink/PDF folder.': '无法创建 Ink/PDF 文件夹。',
	'PDF page is ready to annotate': 'PDF 页面已就绪，可以批注了',
	'PDF pages are ready to annotate': 'PDF 页面已就绪，可以批注了',
	'Could not prepare this PDF page': '准备这一页 PDF 失败',
	'Could not open this PDF.': '无法打开这个 PDF。',
	'Could not prepare any of the selected pages.': '无法准备所选的页面。',
	'No valid page numbers.': '没有有效的页码。',
	'Pick a PDF': '选择 PDF',
	'Pick a file': '选择文件',
	'Annotated pages': '批注页码',
	'Page {n}': '第 {n} 页',
	'Annotation index': '批注索引',
	'Source document': '源文件',
	'Open annotation index': '打开批注索引',
	'Open annotation index for this PDF': '打开这个 PDF 的批注索引',
	'Open a PDF first.': '请先打开一个 PDF。',
	'View in PDF': '在 PDF 中查看',
	'reused cached page images': '复用了已有页面图',
	'Page image could not be loaded; saving without it.':
		'页面背景图无法读取，本次保存不含背景图。',
	'This PDF has {n} pages.': '这个 PDF 共 {n} 页。',
	'Enter pages, e.g. 1-3,5': '输入页码，例如 1-3,5。',
	'Create annotation pages': '生成批注页',
	'Create annotation block from PDF selection': '从 PDF 选区创建批注块',
	'Could not read the clipboard.': '无法读取剪贴板。',
	'Copy a PDF++ selection first.': '请先复制一个 PDF++ 选区链接。',

	// PDF annotation settings / PDF 批注设置
	'PDF annotation': 'PDF 批注',
	'Annotating a PDF turns its pages into handwriting blocks. These settings decide where those blocks land.':
		'批注 PDF 会把页面变成手写块。这里决定这些块落到哪里。',
	'Where annotations go': '批注放到哪里',
	'Create a note beside the PDF': '在 PDF 旁边新建笔记',
	'Always use one note': '始终用同一个笔记',
	'New note name': '新笔记命名',
	'{pdf} becomes the PDF name, {date} becomes today. A note that already exists is reused, not duplicated.':
		'{pdf} 会替换成 PDF 文件名，{date} 替换成今天的日期。已存在的同名笔记会被复用，不会重复创建。',
	'Note to use': '使用的笔记',
	'Vault path of the shared note, e.g. “03-Maps/物理批注”. Created on first use if missing.':
		'共用笔记在 vault 中的路径，例如「03-Maps/物理批注」。不存在时首次使用会自动创建。',
	'Path to a note': '笔记路径',
	'After inserting': '插入之后',
	'Open the note': '打开这篇笔记',
	'Stay on the PDF': '留在 PDF',

	// Background page image / 背景图层
	'Set page image…': '设置页面背景图…',
	'Remove page image': '移除页面背景图',
	'Open source PDF': '打开源 PDF',
	'Fade page image': '页面背景淡一点',
	'This block has no page image.': '这个块没有页面背景图。',
	'This block was not created from a PDF.': '这个块不是从 PDF 页面创建的。',
	'Background set': '已设置背景图',
	'Background removed': '已移除背景图',
	'Pick an image': '选择一张图片',
	'This file does not use the current ink-canvas format.': '这个文件不是当前 ink-canvas 格式，无法设置背景。',
	'Could not read that image.': '无法读取这张图片。',
	'Could not update this file.': '无法更新这个文件。',

	// Export / 导出
	'Export to Excalidraw': '导出为 Excalidraw',
	'Convert to Mermaid': '转为 Mermaid',
	'The model did not find a diagram structure in this drawing.': '模型没有在这张图里识别出图表结构。',
	'Could not reach the endpoint.': '无法连接接口。',
	'Mermaid block inserted': '已插入 Mermaid 代码块',
	'Open a note first.': '请先打开一篇笔记。',
	'Exported to Excalidraw': '已导出为 Excalidraw',
	'Export to Excalidraw failed': '导出为 Excalidraw 失败',
	'Nothing to export: this file has no ink-canvas strokes.':
		'没有可导出的内容：这个文件里没有 ink-canvas 笔迹。',

	// Transcript mirror / 转录镜像
	'Transcript': '转录',
	'Insert transcript below': '在下方插入转录',
	'Edit transcript': '编辑转录',
	'Save': '保存',
	'Transcript saved': '转录已保存',
	'Could not save the transcript': '转录保存失败',
	'Markdown is preserved as typed. Saving stops automatic transcription from overwriting your edits; run Transcribe again to let the model take over.':
		'Markdown 按原样保存。保存后自动识别不会再覆盖你的修改；若想让模型重新识别，请再次运行「识别」。',
	'Transcript inserted below': '已在下方插入转录',
	'Could not insert transcript below': '插入转录失败',
	'Mirror transcript below the embed': '在嵌入下方同步转录文本',
	'AI caption in the embed alt': 'AI 自动生成题注',
	'After transcribing, ask the same endpoint for a one-line caption and use it as the image alt text. Costs one extra request per page. Falls back to the transcript automatically when the model is unavailable.':
		'识别完成后，向同一个接口再要一行题注，用作图片的 alt 文本。每页会多一次请求。模型不可用时自动回退为转录摘要。',
	'After transcribing, write the text into a collapsed callout directly under the handwriting block. Applies to writing and drawing. Surrounding prose is never touched, and deleting the block stops the mirror.':
		'识别完成后，把手写块下方的区域写成一个折叠的提示框。书写与绘图都适用。不会改动周围正文；删掉这个块就停止同步。',

	// ── 魔法笔（写完自动浮现）──────────────────────────────
	'Magic margin on: pause and the reply appears':
		'魔法页边已开启：停笔片刻，回复会自己浮现',
	'Magic margin off': '魔法页边已关闭',
	'Answer again': '再答一次',
	'Insert into note': '插入笔记',
	'Dismiss': '收起',
	'Write here; pause and I will answer in the margin.':
		'在这里写；停笔片刻，我会在纸边回应。',

	// ── 设置页分区 ────────────────────────────────────────
	'Connection & model': '连接与模型',
	'Writing & drawing': '书写与绘图',
	'Writing on notes': '在笔记上书写',
	'Files & export': '文件与导出',
	'About & maintenance': '关于与维护',
	'Model connected': '模型已连接',
	'No model configured': '未配置模型',
	'Revert to default settings for this plugin?': '要把笔墨的设置恢复为默认值吗？',
	'Reset settings': '恢复默认设置',

	// ── 设置页：魔法页边 ──────────────────────────────────
	'Magic margin (auto reply)': '魔法页边（自动回应）',
	'Turn it on with the ✦ button in the writing toolbar. Pause, and the reply writes itself into the corner.':
		'在书写工具栏点 ✦ 开启。停笔片刻，回复会自己写到角落。',
	'Pause before replying': '停笔多久后回应',
	'How long the pen must be still. A short pause interrupts a thought; a long one feels like nothing happened.':
		'笔静止多久才发送这一页。太短会打断思路，太长会让人觉得没反应。',
	'Minimum new strokes': '至少新写几笔',
	'A dot or a comma is not worth a request. Counts strokes written since the last reply.':
		'一个点、一个逗号不值得发一次请求。按上次回应之后新写的笔数计算。',

	// ── 设置页分区说明 ────────────────────────────────────
	'Where the model lives. Without it, handwriting still works — it just cannot be read or answered.':
		'模型放在哪里。不配置也能正常手写，只是无法识别、也不会有 AI 回应。',
	'Defaults for the page itself: how ink is captured, how a block opens, and the magic margin.':
		'这一页本身的默认行为：笔迹怎么采集、块怎么打开、以及魔法页边。',
	'Where attachments are stored, and how files written by older versions are brought forward.':
		'附件存在哪里，以及旧版本写的文件如何迁移过来。',
	'Usage tips, resets, and development information.': '使用提示、重置与开发信息。',
	'Draw straight onto a note, over the text, without changing a byte of the Markdown file.':
		'直接写在笔记上、覆盖在文字之上，Markdown 文件一个字节都不改。',

	// ── 笔记上的书写 ──────────────────────────────────────
	'Draw on notes': '在笔记上书写',
	'Puts a transparent ink layer over every Markdown editor. It ignores the pointer until you pick a drawing tool, so normal editing is unaffected.':
		'在每个 Markdown 编辑器上铺一层透明笔迹层。未选绘画工具前它完全无视指针，正常编辑不受影响。',
	'Applies to new strokes on notes. Existing strokes keep the brush they were drawn with.':
		'只影响新写的笔迹，已有笔迹保留当时的笔刷。',
	'Stroke size': '笔画粗细',
	'The brush multiplies this, so a highlighter stays wide even at the same number.':
		'笔刷会在此基础上放大，所以同样数值下荧光笔依然很宽。',
	'Colour': '颜色',
	'“Theme ink” follows light and dark mode. The highlighter falls back to yellow when this is left on theme ink.':
		'「主题墨色」跟随明暗模式。选主题墨色时荧光笔会退回黄色。',
	'Theme ink': '主题墨色',
	'Draw with a mouse': '允许鼠标书写',
	'Off by default: a pen draws, a mouse keeps selecting text. Turn this on if you have no stylus.':
		'默认关闭：笔能写，鼠标仍然选文字。没有手写笔时再打开。',
	'Draw with a finger': '允许手指书写',
	'Off by default on tablets: a finger scrolls the note and the stylus draws. Turn this on if you have no stylus at all.':
		'平板默认关闭：手指用来滚动笔记，手写笔用来写字。完全没有触控笔时才需要打开。',
	'Ink could not be saved. Check that the vault is writable.':
		'手写墨迹保存失败，请检查笔记库目录是否可写。',
	'Paper': '纸张',
	'A guide drawn under the ink for this note. It is decoration only — it never enters the Markdown file.':
		'铺在笔迹下方的辅助线，仅作视觉参考，不会写进 Markdown 文件。',
	'Ruled': '横线',
	'Grid': '网格',
	'Dots': '点阵',
	'Eraser radius': '橡皮半径',
	'How close the eraser has to come to a stroke, in pixels. Larger is forgiving on a tablet, clumsy with a mouse.':
		'橡皮离笔迹多近才算擦到，单位为像素。大一些在平板上更宽容，用鼠标时则显得笨拙。',
	'Shortcuts: Mod+Shift+D switches the pen on and off for a note. While the pen is on, Mod+Alt+Z undoes a stroke. Long-press the space bar to pan.':
		'快捷键：Mod+Shift+D 在当前笔记上开关笔；笔开启时 Mod+Alt+Z 撤销一笔；按住空格拖动可平移。',

	// ── 笔记书写命令 ──────────────────────────────────────
	'Toggle ink on this note': '在这篇笔记上开关笔',
	'笔墨 on notes is turned off in settings.': '「在笔记上书写」已在设置里关闭。',
	'笔墨 off — the note scrolls and selects normally.': '书写已关闭，笔记可以正常滚动和选择。',
	'Draw on the note': '在笔记上书写',
	'Handwriting is ready. Pick the pencil in the corner to draw; the hand icon goes back to normal editing. The toolbar itself can be dragged anywhere.':
		'手写已就绪：点右上角的铅笔开始书写，手掌图标切回正常编辑。这条工具栏本身可以拖到任意位置。',
	'Reattach the ink layer to open notes': '重新挂载已打开笔记的书写层',
	'Reattach sent to {count} open note(s).': '已向 {count} 个打开的笔记发送重挂请求。',
	'笔墨 tool: {tool}': '书写工具：{tool}',
	'Eraser': '橡皮',
	'Lasso': '套索',
	'Pan': '平移',
	'Undo ink stroke': '撤销一笔',
	'Redo ink stroke': '重做一笔',
	'Delete selected ink': '删除选中的笔迹',
	'Clear all ink on this note': '清除这篇笔记上的全部笔迹',
	'This note has no ink.': '这篇笔记还没有笔迹。',
	'笔墨 cleared. Undo with the ink undo command.': '已清除。可用撤销命令恢复。',
	'Cycle paper style on this note': '切换这篇笔记的纸张样式',
	'Paper: {paper}': '纸张：{paper}',
	'Cycle brush for note ink': '切换笔记书写笔刷',
	'Brush: {brush}': '笔刷：{brush}',
	'Open a Markdown note first.': '请先打开一篇 Markdown 笔记。',
	'Clear all ink on open PDFs': '清除已打开 PDF 上的全部笔迹',
	'No PDF ink to clear.': '没有可清除的 PDF 笔迹。',
	'PDF ink cleared.': 'PDF 笔迹已清除。',
	'Check PDF ink support': '检查 PDF 书写支持情况',
	'Copy selected ink': '复制选中的笔迹',
	'Select ink with the lasso first.': '请先用套索选中笔迹。',
	'笔墨 copied.': '笔迹已复制。',
	'Paste ink at the cursor': '在光标处粘贴笔迹',
	'The clipboard does not hold bimo ink.': '剪贴板里不是 bimo 笔迹。',
	'Export this note’s ink as SVG': '把这篇笔记的笔迹导出为 SVG',
	'笔墨 exported to {path}': '笔迹已导出到 {path}',
	'Transcribe ink on this note': '识别这篇笔记上的笔迹',
	'Cut selected ink': '剪切选中的笔迹',
	'笔墨 cut.': '笔迹已剪切。',
	'Check note ink status': '检查笔记书写状态',
	'Cycle ink colour': '循环切换笔色',
	'笔墨 colour: {colour}': '笔色：{colour}',
	'Cycle stroke size': '循环切换笔画粗细',
	'Stroke size: {size}': '笔画粗细：{size}',
	'Cycle eraser size': '循环切换橡皮大小',
	'Eraser radius: {size}': '橡皮半径：{size}',
	'Toggle drawing with a mouse': '切换鼠标书写',
	'A mouse now draws. Text selection needs the lasso or a stylus.':
		'鼠标现在会书写。选文字请改用套索或手写笔。',
	'A mouse selects text again; a stylus still draws.':
		'鼠标恢复为选文字，手写笔仍然书写。',
	'Straighten shapes': '自动拉直形状',
	'A stroke that was nearly a line becomes a line; one that was nearly a closed box becomes a rectangle. Hand-drawn underlines and frames stop looking wobbly.':
		'接近直线的笔画会变成直线，接近闭合方框的笔画会变成矩形。手画的下划线和外框不再歪斜。',
	// ── 识别 API / 端点提示（账号体系移除后） ──────────────
	'Enable transcription': '启用识别',
	'No transcription API is configured. Open Settings → bimo → Models & connection and add a provider, model and API key.':
		'尚未配置识别 API。请打开「设置 → 笔墨 → 连接与模型」，填入服务商、模型和 API 密钥。',
	'Transcription needs an endpoint: fill in the transcription API above and turn it on.':
		'识别需要一个端点：请在上方填写识别 API 并打开开关。',
	'Transcription needs an endpoint: fill in the transcription API in the plugin settings and turn it on.':
		'识别需要一个端点：请在插件设置里填写识别 API 并打开开关。',
	'Writing and drawing embeds can be transcribed automatically every time you close them.':
		'每次关闭手写或绘图区块时，都可以自动识别其中的内容。',
	'Add a vision model endpoint in the settings — any OpenAI-compatible API works.':
		'在设置里填入一个支持视觉的模型端点即可，任何 OpenAI 兼容接口都可用。',
	'Open bimo settings': '打开笔墨设置',
	'When off, transcription and the AI features do nothing. 笔墨 and drawing still work normally.':
		'关闭后识别与 AI 功能都不会运行，手写和绘图本身照常可用。',
	'Handwriting transcription through your own API (Chat Completions or Responses).':
		'手写识别走你自己的 API（Chat Completions 或 Responses 两种格式）。',
	'Handwriting transcription runs on your own endpoint — the plugin ships no backend. Works with OpenAI, Azure OpenAI, DeepSeek, SiliconFlow, Gemini, Moonshot, Ollama, vLLM, LM Studio, one-api / new-api gateways, and anything else that speaks one of the two formats below.':
		'手写识别运行在你自己的端点上——插件不附带任何后端服务。支持 OpenAI、Azure OpenAI、DeepSeek、硅基流动、Gemini、月之暗面、Ollama、vLLM、LM Studio、one-api / new-api 中转，以及任何支持下列两种格式之一的服务。',

	// ── 选区操作栏与魔法书页（你写一句，AI写一句） ────────────
	'Apply brush colour': '应用当前笔刷颜色',
	'Duplicate selected ink': '复制并偏移选中的笔迹（副本）',
	'Transcribe selected ink': 'AI 识别选中的笔迹',
	'Finger drawing': '手指书写',
	'Toggle whether a finger draws or scrolls': '切换单指是直接书写还是滚动页面',
	'Toggle Magic Diary Page (you write a line, AI writes a line)':
		'开启/关闭魔法书页（你写一句，AI写一句）',
	'Create new Magic Diary Page': '新建魔法书页（你写一句，AI写一句）',
	'✦ Magic Diary Page created — write a line with your pen and pause!':
		'✦ 魔法书页已展开——用笔写下一句话并停笔，书页便会浮现回应！',
	'Magic Diary Page · Write a line and pause; the page will answer':
		'魔法书页 · 写下一句话，停笔即应',
	'Reply now': '立即回应',
	'Ask the Magic Diary Page to respond immediately': '让魔法书页立即回应当前笔迹',
	'Auto: Off': '自动: 关',
	'Auto: On': '自动: 开',
	'Toggle automatic reply on pause': '切换停笔自动回应（开启后停笔自动解读，关闭后需手动点击「立即回应」）',
	'Automatic response enabled: pauses will be answered.': '已开启自动回应：停笔片刻书页将自动解读并回应。',
	'Manual mode: write freely, tap Reply now whenever ready.': '已切换为手动模式：尽情随心书写，需要时点击「立即回应」。',
	'Collapse reply': '折叠回应',
	'Expand reply': '展开回应',
	'Clear whispers': '抹去低语',
	'Fade away all diary replies on this page': '淡出并清除本页所有魔法回应',
	'Listening to your handwriting…': '正在倾听你的笔迹…',
	'✦ Magic Diary Page awakened — write a line and pause; the page will answer.':
		'✦ 魔法书页已唤醒——写下一句话并停笔片刻，书页便会浮现回应。',
	'Magic Diary Page closed.': '魔法书页已合上。',
	'The page is absorbing your ink…': '书页正在汲取墨迹并浮现回应…',
	'✦ Your turn — write the next line below': '✦ 轮到你了——在下方继续书写下一句',
	'The ink faded before reaching the spirit — check AI settings':
		'墨迹未能触达灵识——请检查设置中的 AI 接口与密钥',
	'Inscribe into note': '铭刻入正文',
	'Append this exchange as Markdown text into the note': '将这段对话以 Markdown 正文追加到笔记中',
	'Exchange inscribed into the note.': '对话已铭刻入笔记正文。',
	'Fade this reply': '隐去这条回应',

	// ── 橡皮模式与魔法书页增强 ─────────────────────────────
	'Eraser mode': '橡皮擦除模式',
	'Object eraser removes the entire stroke on touch; Partial eraser precisely cuts through strokes at hit points.':
		'整笔擦除触碰笔画任意处即删除整笔；局部/像素擦除可在触碰点精准截断笔画。',
	'Object eraser': '整笔擦除',
	'Partial eraser': '像素擦除',
	'Click to switch to object eraser': '点击切换为整笔擦除',
	'Click to switch to partial eraser': '点击切换为像素擦除',
	'Drag toolbar (double-click to switch preset position)': '按住拖动工具栏（双击切换预设停靠位置）',
	'You write a line, AI writes a line. Inspired by magical parchment and enchanted diaries. Choose from preset response styles or tailor your own system prompt.':
		'你写一句，AI 回一句。灵感源于活点地图与魔法日记。可选用预设回复风格或完全自定义系统提示词。',
	'Response style': '回复风格',
	'Choose the persona and purpose of the Magic Diary Page.':
		'选择魔法书页的交互人设与回应定位。',
	'Companion': '对话伴侣',
	'Explain & Teach': '深度解析',
	'Brainstorm': '灵感续写',
	'Problem Solver': '批改解题',
	'Custom prompt': '自定义提示词',
	'System prompt given to the AI when reading your handwriting on Magic Diary Pages.':
		'魔法书页在解读你的手写墨迹并生成回应时使用的系统提示词（System Prompt）。',
	'Write custom instructions for how the enchanted page should answer your handwritten ink…':
		'写下专属提示词，规定魔法书页如何解读并回应你的手写内容…',
	'Diary response mode': '书页回复模式',
	// ── 设置页优化 ──────────────────────────────────────────
	'Writing & drawing embeds': '嵌入手写与绘图',
	'AI & model': 'AI 与模型',
	'Device & general': '设备与常规',
	'Inline handwriting and drawing canvases embedded directly between note paragraphs.':
		'在笔记段落之间嵌入独立手写块与绘图框，随笔记一同排版与展示。',
	'Where the model lives. Powers transcription, Magic Diary Pages, and magic margins.':
		'配置大模型接口，驱动笔记转录、魔法书页问答与边栏灵感。',
	'Stylus behavior, display modes, and vault attachment storage.':
		'手写笔适配、显示优化与附件存储管理。',
	'Handwriting embeds': '嵌入手写块',
	'Drawing canvas embeds': '嵌入绘图画板',
	'Automatic transcription': '智能转录与图注',
	'Stylus & input': '手写笔与交互',
	'File locations': '文件存储位置',
	'Maintenance & advanced': '系统维护与高级',
};
