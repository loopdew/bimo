import { Notice } from 'obsidian';
import type InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { INK_BRUSH_SIZE_STEPS, INK_BRUSH_SWATCHES, resolveBrushPreset } from 'src/ink-canvas/brush-presets';
import {
	isCustomTranscriptionProviderUsable,
	normalizeCustomTranscriptionProvider,
	prepareProviderMedia,
	requestCustomTranscription,
} from 'src/logic/transcription-providers';
import { buildMagicDiaryNoteContent } from 'src/logic/ai/magic-diary';
import type { MdInkPaper, MdInkTool } from './types';

///////////////////////////
///////////////////////////

/**
 * Commands for ink on notes.
 *
 * Everything routes through {@link MdInkController}, so a command always acts on
 * the note in the active tab even when the editor does not hold focus — which is
 * the normal state while a stylus is drawing.
 */

const TOOL_LABELS: Record<MdInkTool, string> = {
	pen: 'Pen',
	highlighter: 'Highlighter',
	eraser: 'Eraser',
	lasso: 'Lasso',
	pan: 'Pan',
};

const PAPER_LABELS: Record<MdInkPaper, string> = {
	none: 'None',
	ruled: 'Ruled',
	grid: 'Grid',
	dots: 'Dots',
};

const PAPER_ORDER: MdInkPaper[] = ['none', 'ruled', 'grid', 'dots'];

export function implementMdInkCommands(plugin: InkPlugin): void {
	const controller = plugin.mdInk;

	const requireOverlay = () => {
		const overlay = controller.active();
		if (!overlay) new Notice(t('Open a Markdown note first.'));
		return overlay;
	};

	plugin.addCommand({
		id: 'md-ink-toggle-drawing',
		name: t('Toggle ink on this note'),
		icon: 'pencil',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'd' }],
		callback: () => {
			if (!plugin.settings.mdInkEnabled) {
				new Notice(t('笔墨 on notes is turned off in settings.'));
				return;
			}
			const next: MdInkTool = controller.tool === 'pan' ? 'pen' : 'pan';
			controller.setTool(next);
			new Notice(next === 'pan'
				? t('笔墨 off — the note scrolls and selects normally.')
				: t('Draw on the note'));
		},
	});

	const tools: MdInkTool[] = ['pen', 'highlighter', 'eraser', 'lasso', 'pan'];
	for (const tool of tools) {
		plugin.addCommand({
			id: `md-ink-tool-${tool}`,
			name: t('笔墨 tool: {tool}').replace('{tool}', t(TOOL_LABELS[tool])),
			callback: () => {
				controller.setTool(tool);
			},
		});
	}

	plugin.addCommand({
		id: 'md-ink-undo',
		name: t('Undo ink stroke'),
		icon: 'undo-2',
		hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'z' }],
		callback: () => {
			const overlay = controller.active();
			if (overlay?.canUndo()) {
				overlay.undo();
				return;
			}
			plugin.pdfInk?.undoActive();
		},
	});

	plugin.addCommand({
		id: 'md-ink-redo',
		name: t('Redo ink stroke'),
		icon: 'redo-2',
		hotkeys: [{ modifiers: ['Mod', 'Alt', 'Shift'], key: 'z' }],
		callback: () => {
			const overlay = controller.active();
			if (overlay?.canRedo()) {
				overlay.redo();
				return;
			}
			plugin.pdfInk?.redoActive();
		},
	});

	plugin.addCommand({
		id: 'md-ink-delete-selection',
		name: t('Delete selected ink'),
		icon: 'trash',
		callback: () => {
			controller.active()?.deleteSelected();
		},
	});

	plugin.addCommand({
		id: 'md-ink-duplicate-selection',
		name: t('Duplicate selected ink'),
		icon: 'copy-plus',
		callback: () => {
			const overlay = controller.active();
			if (!overlay?.duplicateSelected()) {
				new Notice(t('Select ink with the lasso first.'));
			}
		},
	});

	plugin.addCommand({
		id: 'md-ink-toggle-magic-page',
		name: t('Toggle Magic Diary Page (you write a line, AI writes a line)'),
		icon: 'sparkles',
		callback: () => {
			const overlay = requireOverlay();
			if (!overlay) return;
			overlay.setMagicDiaryMode(!overlay.isMagicDiaryMode());
		},
	});

	plugin.addCommand({
		id: 'md-ink-create-magic-page',
		name: t('Create new Magic Diary Page'),
		icon: 'wand-2',
		callback: async () => {
			const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
			const fileName = `魔法书页 ${timestamp}.md`;
			const content = buildMagicDiaryNoteContent();
			const file = await plugin.app.vault.create(fileName, content);
			const leaf = plugin.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			controller.setTool('pen');
			new Notice(t('✦ Magic Diary Page created — write a line with your pen and pause!'));
		},
	});

	plugin.addCommand({
		id: 'md-ink-clear-note',
		name: t('Clear all ink on this note'),
		icon: 'eraser',
		callback: () => {
			const overlay = requireOverlay();
			if (!overlay) return;
			if (!overlay.hasInk()) {
				new Notice(t('This note has no ink.'));
				return;
			}
			overlay.clearAll();
			new Notice(t('笔墨 cleared. Undo with the ink undo command.'));
		},
	});

	plugin.addCommand({
		id: 'md-ink-cycle-paper',
		name: t('Cycle paper style on this note'),
		icon: 'grid-3x3',
		callback: () => {
			const overlay = controller.active();
			if (!overlay) {
				new Notice(t('Open a Markdown note first.'));
				return;
			}
			const current = overlay.getDocument().paper;
			const next = PAPER_ORDER[(PAPER_ORDER.indexOf(current) + 1) % PAPER_ORDER.length];
			overlay.setPaper(next);
			new Notice(t('Paper: {paper}').replace('{paper}', t(PAPER_LABELS[next])));
		},
	});

	plugin.addCommand({
		id: 'md-ink-clear-pdf',
		name: t('Clear all ink on open PDFs'),
		icon: 'eraser',
		callback: () => {
			if (!plugin.pdfInk.hasInkOnActivePdf()) {
				new Notice(t('No PDF ink to clear.'));
				return;
			}
			plugin.pdfInk.clearActive();
			new Notice(t('PDF ink cleared.'));
		},
	});

	plugin.addCommand({
		id: 'md-ink-copy-selection',
		name: t('Copy selected ink'),
		icon: 'copy',
		callback: async () => {
			const overlay = controller.active();
			const payload = overlay?.copySelected();
			if (!payload) {
				new Notice(t('Select ink with the lasso first.'));
				return;
			}
			await navigator.clipboard.writeText(payload);
			new Notice(t('笔墨 copied.'));
		},
	});

	plugin.addCommand({
		id: 'md-ink-cut-selection',
		name: t('Cut selected ink'),
		icon: 'scissors',
		// No hotkey: Mod+X belongs to the editor. The overlay handles Delete and
		// Backspace itself, only while a lasso selection exists.
		callback: async () => {
			const overlay = controller.active();
			const payload = overlay?.cutSelected();
			if (!payload) {
				new Notice(t('Select ink with the lasso first.'));
				return;
			}
			await navigator.clipboard.writeText(payload);
			new Notice(t('笔墨 cut.'));
		},
	});

	plugin.addCommand({
		id: 'md-ink-paste',
		name: t('Paste ink at the cursor'),
		icon: 'clipboard-paste',
		callback: async () => {
			const overlay = controller.active();
			if (!overlay) {
				new Notice(t('Open a Markdown note first.'));
				return;
			}
			const text = await navigator.clipboard.readText();
			if (!overlay.paste(text)) {
				new Notice(t('The clipboard does not hold bimo ink.'));
			}
		},
	});

	plugin.addCommand({
		id: 'md-ink-export-svg',
		name: t('Export this note’s ink as SVG'),
		icon: 'image-down',
		callback: async () => {
			const overlay = controller.active();
			if (!overlay?.hasInk()) {
				new Notice(t('This note has no ink.'));
				return;
			}
			const notePath = plugin.app.workspace.getActiveFile()?.basename ?? 'note';
			const safe = notePath.replace(/[\\/:*?"<>|]/g, '-');
			const folder = '.bimo/exports';
			const path = `${folder}/${safe} - ink.svg`;
			const adapter = plugin.app.vault.adapter;
			if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
			await adapter.write(path, overlay.buildSvg());
			new Notice(t('笔墨 exported to {path}').replace('{path}', path));
		},
	});

	plugin.addCommand({
		id: 'md-ink-transcribe',
		name: t('Transcribe ink on this note'),
		icon: 'sparkles',
		callback: async () => {
			const overlay = controller.active();
			if (!overlay?.hasInk()) {
				new Notice(t('This note has no ink.'));
				return;
			}
			const provider = normalizeCustomTranscriptionProvider(plugin.settings.customTranscriptionProvider);
			if (!isCustomTranscriptionProviderUsable(provider)) {
				new Notice(t('Enable a custom API in settings first.'));
				return;
			}
			try {
				const svg = overlay.buildSvg({ background: '#ffffff', defaultInkColour: '#111111' });
				const media = await prepareProviderMedia(svg, provider.mediaFormat);
				const transcript = (await requestCustomTranscription({ settings: provider, media })).trim();
				if (!transcript) {
					new Notice(t('Nothing to transcribe'));
					return;
				}
				await navigator.clipboard?.writeText(transcript);
				new Notice(t('Transcript copied to clipboard'));
			} catch (error) {
				console.warn('[bimo] md-ink transcription failed', error);
				new Notice(t('Could not reach the endpoint. Check the settings and the key.'));
			}
		},
	});

	plugin.addCommand({
		id: 'md-ink-remount',
		name: t('Reattach the ink layer to open notes'),
		icon: 'refresh-cw',
		callback: async () => {
			const { nudgeAllEditors } = await import('./md-ink-extension');
			const count = nudgeAllEditors(plugin);
			new Notice(t('Reattach sent to {count} open note(s).').replace('{count}', String(count)));
		},
	});

	plugin.addCommand({
		id: 'md-ink-diagnose',
		name: t('Check note ink status'),
		icon: 'stethoscope',
		callback: () => {
			const status = `enabled=${plugin.settings.mdInkEnabled} mouse=${plugin.settings.mdInkMouseDrawing}`;
			new Notice(`bimo md-ink: ${status} ${controller.diagnose()}`, 12000);
		},
	});

	plugin.addCommand({
		id: 'md-ink-pdf-diagnose',
		name: t('Check PDF ink support'),
		icon: 'stethoscope',
		callback: () => {
			new Notice(`bimo md-ink: ${plugin.pdfInk.diagnose()}`);
		},
	});

	plugin.addCommand({
		id: 'md-ink-cycle-colour',
		name: t('Cycle ink colour'),
		icon: 'palette',
		callback: async () => {
			const swatches = INK_BRUSH_SWATCHES;
			const index = swatches.indexOf(plugin.settings.mdInkColour);
			const next = swatches[(index + 1) % swatches.length] ?? swatches[0];
			plugin.settings.mdInkColour = next;
			plugin.mdInk.refreshOptions({ colour: next });
			await plugin.saveSettings();
			new Notice(t('笔墨 colour: {colour}').replace('{colour}', next === 'currentColor' ? t('Theme ink') : next));
		},
	});

	plugin.addCommand({
		id: 'md-ink-cycle-size',
		name: t('Cycle stroke size'),
		icon: 'move-vertical',
		callback: async () => {
			const steps = INK_BRUSH_SIZE_STEPS;
			const index = steps.indexOf(plugin.settings.mdInkSize);
			// Off-step values (set by the slider) restart the cycle at the smallest.
			const next = index === -1 ? steps[0] : steps[(index + 1) % steps.length];
			plugin.settings.mdInkSize = next;
			plugin.mdInk.refreshOptions({ size: next });
			await plugin.saveSettings();
			new Notice(t('Stroke size: {size}').replace('{size}', String(next)));
		},
	});

	plugin.addCommand({
		id: 'md-ink-cycle-eraser-size',
		name: t('Cycle eraser size'),
		icon: 'circle-dot',
		callback: async () => {
			const steps = [6, 14, 24, 40];
			const index = steps.indexOf(plugin.settings.mdInkEraserRadius);
			const next = index === -1 ? steps[1] : steps[(index + 1) % steps.length];
			plugin.settings.mdInkEraserRadius = next;
			plugin.mdInk.refreshOptions({ eraserRadius: next });
			await plugin.saveSettings();
			new Notice(t('Eraser radius: {size}').replace('{size}', String(next)));
		},
	});

	plugin.addCommand({
		id: 'md-ink-toggle-mouse',
		name: t('Toggle drawing with a mouse'),
		icon: 'mouse-pointer',
		callback: async () => {
			const next = !plugin.settings.mdInkMouseDrawing;
			plugin.settings.mdInkMouseDrawing = next;
			plugin.mdInk.refreshOptions({ mouseDrawing: next });
			await plugin.saveSettings();
			new Notice(next
				? t('A mouse now draws. Text selection needs the lasso or a stylus.')
				: t('A mouse selects text again; a stylus still draws.'));
		},
	});

	plugin.addCommand({
		id: 'md-ink-cycle-brush',
		name: t('Cycle brush for note ink'),
		icon: 'brush',
		callback: () => {
			const order = ['pen', 'pencil', 'technical', 'marker', 'highlighter', 'crayon', 'brush'] as const;
			const index = order.indexOf(plugin.settings.mdInkBrush as typeof order[number]);
			plugin.settings.mdInkBrush = order[(index + 1) % order.length];
			void plugin.saveSettings();
			// Every open note and PDF, not just the active one: the brush is a
			// global preference, and a second pane silently keeping the old one is
			// the kind of inconsistency that reads as a bug later.
			controller.refreshOptions({ brush: plugin.settings.mdInkBrush });
			const preset = resolveBrushPreset(plugin.settings.mdInkBrush);
			new Notice(t('Brush: {brush}').replace('{brush}', t(preset.label)));
		},
	});
}
