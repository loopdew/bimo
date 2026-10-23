import { getStroke } from 'perfect-freehand';
import { Component, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { t } from 'src/i18n';
import { getGlobals } from 'src/stores/global-store';
import type { EditorView } from '@codemirror/view';
import type { InkBrushKind } from 'src/ink-canvas/brush-presets';
import { INK_BRUSH_SWATCHES, resolveBrushPreset } from 'src/ink-canvas/brush-presets';
import { getRenderedStrokeData } from 'src/ink-canvas/rendered-stroke-cache';
import type { InkPoint, InkStrokeStyle } from 'src/ink-canvas/types';
import { toStrokeOptions } from 'src/ink-canvas/types';
import { getPointerSamples } from 'src/ink-canvas/utils/pointer-samples';
import { getSvgPathFromStroke } from 'src/ink-canvas/utils/svg-path-from-stroke';
import {
	hasMagicDiaryFrontmatter,
	MAGIC_DIARY_PAUSE_MS,
	MAGIC_DIARY_PRESETS,
	requestMagicDiaryTurn,
	type MagicDiaryPreset,
} from 'src/logic/ai/magic-diary';
import {
	isCustomTranscriptionProviderUsable,
	normalizeCustomTranscriptionProvider,
	prepareProviderMedia,
	requestCustomTranscription,
	type ChatTurn,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers';
import { attachPillDrag, type PillDragHandle } from './pill-drag';
import { createPillStylePopover, type PillStylePatch, type PillStylePopoverHandle } from './pill-style-popover';
import { attachTouchTapUndo } from './touch-tap-undo';
import {
	createEmptyMdInkDocument,
	dotPath,
	fingerprintLine,
	HOLD_TO_SNAP_DELAY_MS,
	HOLD_TO_SNAP_TOLERANCE,
	mergeMdInkDocuments,
	resolveAnchorLine,
	resolvePaperStyle,
	snapStrokePoints,
	type MdInkDocument,
	type MdInkEraserMode,
	type MdInkPaper,
	type MdInkStroke,
	type MdInkTool,
} from './types';

///////////////////////////
///////////////////////////

/**
 * Explain a mouse press that was deliberately ignored.
 *
 * The pen and highlighter refuse mouse input unless the setting allows it, so
 * a desktop user who never touched that switch sees "nothing happens at all"
 * and concludes the feature is broken. One notice turns a dead press into a
 * one-click fix. Guarded so it cannot repeat on every click.
 */
let mouseDrawingNoticeShown = false;

export function explainMouseDrawingDisabled(): void {
	if (mouseDrawingNoticeShown) return;
	mouseDrawingNoticeShown = true;
	new Notice(
		t('Mouse drawing is turned off. Enable “Draw with the mouse” in Writing on notes, or use a stylus.'),
		9000,
	);
}

/**
 * 笔墨 painted directly onto a note.
 *
 * The layer is an absolutely-positioned `<div>` inside `.cm-scroller` (not
 * `.cm-content`, which CodeMirror rebuilds and would drop it), so scrolling,
 * zooming and window resizes all come for free: the browser moves it with the
 * text. Only two things are ours to get right —
 *
 * 1. where a stroke sits in the document (its anchor line), and
 * 2. which document coordinates a pointer position maps to.
 *
 * Every stroke stores points relative to its anchor line's top-left corner, so
 * inserting a paragraph above the ink shifts the line number but not the ink.
 */

export interface MdInkOverlayOptions {
	/** Current brush id. */
	brush: InkBrushKind;
	/** Base size from the shared size slider. */
	size: number;
	/** Colour, or `currentColor` to follow the theme. */
	colour: string;
	/** Mouse/trackpad draws too. Off means pen-only, so a mouse can still select text. */
	mouseDrawing: boolean;
	/**
	 * A finger draws too. Off (default) leaves one-finger drag scrolling the note
	 * and reserves drawing for a stylus — what an Android tablet expects.
	 */
	fingerDraws: boolean;
	paper: MdInkPaper;
	/** Eraser mode: stroke (整笔擦除) or pixel (局部/像素擦除). */
	eraserMode?: MdInkEraserMode;
	/** Eraser radius in CSS px. */
	eraserRadius: number;
	/** Straighten lines and close rectangles when the stroke clearly meant one. */
	shapeSnap: boolean;
	/** Idle delay (ms) before handwriting pauses are read by AI (when auto-respond is active). */
	magicIdleMs?: number;
	/** Magic diary preset mode. */
	magicPreset?: MagicDiaryPreset;
	/** Custom prompt for magic diary. */
	magicCustomPrompt?: string;
	onMagicPresetChange?: (preset: MagicDiaryPreset) => void;
	/** Called after any mutation so the host can schedule a save. */
	onChange?: (doc: MdInkDocument) => void;
	/** A tool was picked from the floating pill; hosts propagate it to other notes. */
	onToolSelected?: (tool: MdInkTool) => void;
	/** Brush, colour, size, or paper was picked from the floating pill's style popover. */
	onStyleChange?: (patch: PillStylePatch) => void;
	/** Accessor for custom AI provider settings (used by Magic Diary Page & selection transcription). */
	getAiSettings?: () => CustomTranscriptionProviderSettings | undefined;
}

type UndoEntry =
	| { type: 'add'; stroke: MdInkStroke }
	| { type: 'addMany'; strokes: MdInkStroke[] }
	| { type: 'remove'; strokes: MdInkStroke[] }
	| { type: 'replace'; removed: MdInkStroke[]; added: MdInkStroke[] }
	| { type: 'move'; shifts: Array<{ id: string; from: { x: number; y: number }; to: { x: number; y: number } }> }
	| { type: 'restyle'; changes: Array<{ id: string; fromColor: string; toColor: string }> };

interface ActiveStroke {
	points: InkPoint[];
	style: InkStrokeStyle;
	anchorLine: number;
	anchorText: string;
	lastPressure: number;
	hasRealPressure: boolean;
	snappedByHold?: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER_CLASS = 'bimo-md-ink-layer';
const MIN_POINT_DISTANCE = 1.1;
/** Extra scrollable canvas height kept below the lowest stroke so blank notes grow as you write. */
const BLANK_NOTE_GROW_BUFFER_PX = 360;
const HOLD_SNAP_JITTER_PX = 3;
/** Where the dragged pill position lives; one preference for every note. */
const PILL_POSITION_KEY = 'bimo-md-ink-pill-position';

let strokeCounter = 0;
function newStrokeId(): string {
	strokeCounter += 1;
	return `md_${Date.now().toString(36)}_${strokeCounter}`;
}

function applyIcon(el: HTMLElement, name: string, fallback?: string): void {
	try {
		setIcon(el, name);
		if (!el.firstElementChild && fallback) {
			setIcon(el, fallback);
		}
	} catch {
		if (fallback) {
			try { setIcon(el, fallback); } catch {}
		}
	}
}

export class MdInkOverlay {
	private readonly view: EditorView;
	private readonly notePath: string;
	private options: MdInkOverlayOptions;

	private layer!: HTMLDivElement;
	private pill!: HTMLDivElement;
	private pillDrag: PillDragHandle | null = null;
	private stylePopover: PillStylePopoverHandle | null = null;
	private undoBtn: HTMLButtonElement | null = null;
	private redoBtn: HTMLButtonElement | null = null;
	private magicBtn: HTMLButtonElement | null = null;
	private selectionBar: HTMLDivElement | null = null;
	private magicBannerEl: HTMLDivElement | null = null;
	private magicStatusEl: HTMLSpanElement | null = null;
	private magicAutoToggleBtn: HTMLButtonElement | null = null;
	private magicRepliesContainer: HTMLDivElement | null = null;
	private magicDiaryMode = false;
	private magicAutoRespond = false;
	private magicAutoChecked = false;
	private magicPendingStrokeIds = new Set<string>();
	private magicReadingStrokeIds = new Set<string>();
	private magicPauseTimer: ReturnType<typeof setTimeout> | null = null;
	private magicHistory: ChatTurn[] = [];
	private magicMaxReplyBottomY = 0;
	private previousPaperBeforeMagic: MdInkPaper | null = null;
	private activeEraseSession: { removed: MdInkStroke[]; added: MdInkStroke[] } | null = null;
	private component = new Component();
	private readonly patternUid = Math.random().toString(36).slice(2, 8);
	private svg!: SVGSVGElement;
	private defs!: SVGDefsElement;
	private paperGroup!: SVGGElement;
	private paperRect: SVGRectElement | null = null;
	private strokeGroup!: SVGGElement;
	private readonly pathElements = new Map<string, SVGPathElement>();
	private livePath!: SVGPathElement;
	private lassoRect!: SVGRectElement;
	/** Ring under the pointer showing the actual nib or eraser footprint. */
	private reticle!: SVGCircleElement;

	private doc: MdInkDocument;
	private tool: MdInkTool = 'pan';
	/** Mirrors the `mdInkEnabled` setting; a disabled layer is hidden entirely. */
	private enabled = true;
	/** Space held: transient pan regardless of the chosen tool. */
	private spaceHeld = false;
	/** Stylus tail eraser (button 5) or Mod-key temporary eraser during a stroke. */
	private transientEraser = false;

	private activeStroke: ActiveStroke | null = null;
	private activePointerId: number | null = null;
	private holdSnapTimer: ReturnType<typeof setTimeout> | null = null;
	private holdAnchorScreen: { x: number; y: number } | null = null;

	private undoStack: UndoEntry[] = [];
	private redoStack: UndoEntry[] = [];

	private selectedIds = new Set<string>();
	private lassoMode: 'select' | 'move' | null = null;
	private lassoStart: { x: number; y: number } | null = null;
	private dragStart: { x: number; y: number } | null = null;
	private dragOrigins = new Map<string, { x: number; y: number }>();
	private panStart: { scrollTop: number; scrollLeft: number; clientY: number; clientX: number } | null = null;
	private touchPan: { pointerId: number; startX: number; startY: number; startScrollLeft: number; startScrollTop: number } | null = null;

	private renderQueued = false;
	private destroyed = false;
	private readonly disposers: Array<() => void> = [];
	private linesCache: { doc: unknown; lines: string[] } | null = null;

	constructor(view: EditorView, notePath: string, options: MdInkOverlayOptions, initial?: MdInkDocument) {
		this.component.load();
		this.view = view;
		this.notePath = notePath;
		this.options = { ...options };
		this.doc = initial ?? createEmptyMdInkDocument(notePath);
		this.mount();
	}

	///////////////////////////
	// Lifecycle
	///////////////////////////

	/**
	 * The scrolling box, not the editable content.
	 *
	 * `.cm-content` is CodeMirror's own rendered document: it rebuilds that
	 * subtree on edits and drops any node it did not create. A layer appended
	 * there survives until the first keystroke and then silently disappears.
	 * `.cm-scroller` is the positioned scroll container above it, which CM never
	 * rewrites — and an absolutely positioned child of it still scrolls with the
	 * text, which is what the strokes are anchored to.
	 */
	private get scrollerEl(): HTMLElement {
		const parent = this.view.contentDOM.parentElement;
		return parent instanceof HTMLElement ? parent : this.view.dom;
	}

	private mount(): void {
		const scroller = this.scrollerEl;
		const scrollerPosition = window.getComputedStyle(scroller).position;
		if (!scrollerPosition || scrollerPosition === 'static') {
			scroller.style.position = 'relative';
		}

		this.layer = document.createElement('div');
		this.layer.className = LAYER_CLASS;

		this.svg = document.createElementNS(SVG_NS, 'svg');
		this.svg.setAttribute('class', 'bimo-md-ink-svg');
		this.svg.style.overflow = 'visible';

		this.defs = document.createElementNS(SVG_NS, 'defs');
		this.buildPaperPatterns(this.defs);
		this.svg.appendChild(this.defs);

		this.paperGroup = document.createElementNS(SVG_NS, 'g');
		this.paperGroup.setAttribute('class', 'bimo-md-ink-paper');

		this.paperRect = document.createElementNS(SVG_NS, 'rect');
		this.paperRect.style.display = 'none';
		this.paperGroup.appendChild(this.paperRect);

		this.strokeGroup = document.createElementNS(SVG_NS, 'g');
		this.strokeGroup.setAttribute('class', 'bimo-md-ink-strokes');

		this.livePath = document.createElementNS(SVG_NS, 'path');
		this.livePath.setAttribute('class', 'bimo-md-ink-live');

		this.lassoRect = document.createElementNS(SVG_NS, 'rect');
		this.lassoRect.setAttribute('class', 'bimo-md-ink-lasso');
		this.lassoRect.style.display = 'none';

		this.reticle = document.createElementNS(SVG_NS, 'circle');
		this.reticle.setAttribute('class', 'bimo-md-ink-reticle');
		this.reticle.style.display = 'none';

		this.svg.append(this.paperGroup, this.strokeGroup, this.livePath, this.lassoRect, this.reticle);
		this.layer.appendChild(this.svg);
		this.createSelectionBar();
		this.createMagicDiaryDom();
		scroller.appendChild(this.layer);

		this.createPill();
		this.bindPointerEvents();
		this.bindKeyboard();
		const tapHandle = attachTouchTapUndo(scroller, {
			onUndo: () => {
				if (this.enabled && this.getTool() !== 'pan') this.undo();
			},
			onRedo: () => {
				if (this.enabled && this.getTool() !== 'pan') this.redo();
			},
		});
		this.disposers.push(() => tapHandle.destroy());
		this.applyToolCursor();
		this.checkMagicFrontmatter();
		this.render();
	}

	private createSelectionBar(): void {
		const bar = document.createElement('div');
		bar.className = 'bimo-md-ink-selection-bar';
		bar.style.display = 'none';
		bar.addEventListener('pointerdown', (e) => e.stopPropagation());
		bar.addEventListener('click', (e) => e.stopPropagation());

		for (const swatch of INK_BRUSH_SWATCHES.slice(0, 5)) {
			const dot = document.createElement('button');
			dot.type = 'button';
			dot.className = 'bimo-md-ink-selection-bar__swatch';
			dot.dataset.selectionColour = swatch;
			dot.title = swatch === 'currentColor' ? t('Theme ink') : swatch;
			dot.style.background = swatch === 'currentColor' ? 'var(--text-normal)' : swatch;
			dot.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.recolourSelected(swatch);
			});
			bar.appendChild(dot);
		}

		const divider = document.createElement('span');
		divider.className = 'bimo-md-ink-pill__gap';
		bar.appendChild(divider);

		const actions: Array<{ action: string; icon: string; label: string; run: () => void }> = [
			{
				action: 'duplicate',
				icon: 'copy-plus',
				label: t('Duplicate'),
				run: () => {
					this.duplicateSelected();
				},
			},
			{
				action: 'copy',
				icon: 'copy',
				label: t('Copy selected ink'),
				run: () => {
					const payload = this.copySelected();
					if (payload) {
						void navigator.clipboard?.writeText(payload);
						new Notice(t('笔墨 copied.'));
					}
				},
			},
			{
				action: 'cut',
				icon: 'scissors',
				label: t('Cut selected ink'),
				run: () => {
					const payload = this.cutSelected();
					if (payload) {
						void navigator.clipboard?.writeText(payload);
						new Notice(t('笔墨 cut.'));
					}
				},
			},
			{
				action: 'transcribe',
				icon: 'sparkles',
				label: t('Transcribe selected ink'),
				run: () => {
					void this.transcribeSelected();
				},
			},
			{
				action: 'delete',
				icon: 'trash-2',
				label: t('Delete selected ink'),
				run: () => {
					this.deleteSelected();
				},
			},
		];

		for (const item of actions) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'bimo-md-ink-selection-bar__btn';
			btn.dataset.selectionAction = item.action;
			btn.title = item.label;
			setIcon(btn, item.icon);
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				item.run();
			});
			bar.appendChild(btn);
		}

		this.selectionBar = bar;
		this.layer.appendChild(bar);
	}

	private createMagicDiaryDom(): void {
		const banner = document.createElement('div');
		banner.className = 'bimo-magic-diary-banner';
		banner.style.display = 'none';
		banner.addEventListener('pointerdown', (e) => e.stopPropagation());
		banner.addEventListener('click', (e) => e.stopPropagation());

		const crest = document.createElement('span');
		crest.className = 'bimo-magic-diary-banner__crest';
		crest.textContent = '✦';

		const status = document.createElement('span');
		status.className = 'bimo-magic-diary-banner__status';
		status.textContent = t('Magic Diary Page · Write a line and pause; the page will answer');
		this.magicStatusEl = status;

		const autoToggleBtn = document.createElement('button');
		autoToggleBtn.type = 'button';
		autoToggleBtn.className = 'bimo-magic-diary-banner__btn bimo-magic-diary-banner__btn--auto';
		autoToggleBtn.textContent = this.magicAutoRespond ? `⚡ ${t('Auto: On')}` : `⏸️ ${t('Auto: Off')}`;
		autoToggleBtn.title = t('Toggle automatic reply on pause');
		autoToggleBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.magicAutoRespond = !this.magicAutoRespond;
			autoToggleBtn.textContent = this.magicAutoRespond ? `⚡ ${t('Auto: On')}` : `⏸️ ${t('Auto: Off')}`;
			if (this.magicAutoRespond) {
				new Notice(t('Automatic response enabled: pauses will be answered.'));
				this.scheduleMagicDiaryTurn();
			} else {
				this.clearMagicPauseTimer();
				new Notice(t('Manual mode: write freely, tap Reply now whenever ready.'));
			}
		});
		this.magicAutoToggleBtn = autoToggleBtn;

		const replyNowBtn = document.createElement('button');
		replyNowBtn.type = 'button';
		replyNowBtn.className = 'bimo-magic-diary-banner__btn bimo-magic-diary-banner__btn--reply';
		replyNowBtn.dataset.magicAction = 'reply-now';
		replyNowBtn.textContent = `✦ ${t('Reply now')}`;
		replyNowBtn.title = t('Ask the Magic Diary Page to respond immediately');
		replyNowBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			void this.triggerMagicDiaryTurn(true);
		});

		const clearRepliesBtn = document.createElement('button');
		clearRepliesBtn.type = 'button';
		clearRepliesBtn.className = 'bimo-magic-diary-banner__btn';
		clearRepliesBtn.dataset.magicAction = 'clear-replies';
		clearRepliesBtn.textContent = t('Clear whispers');
		clearRepliesBtn.title = t('Fade away all diary replies on this page');
		clearRepliesBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.clearMagicReplies();
		});

		const modeSelect = document.createElement('select');
		modeSelect.className = 'bimo-magic-diary-banner__select';
		modeSelect.title = t('Diary response mode');
		const presets: Array<{ id: MagicDiaryPreset; label: string }> = [
			{ id: 'chat', label: `💬 ${t('Companion')}` },
			{ id: 'explain', label: `💡 ${t('Explain & Teach')}` },
			{ id: 'brainstorm', label: `✍️ ${t('Brainstorm')}` },
			{ id: 'solver', label: `📐 ${t('Problem Solver')}` },
			{ id: 'custom', label: `⚙️ ${t('Custom')}` },
		];
		for (const p of presets) {
			const opt = document.createElement('option');
			opt.value = p.id;
			opt.textContent = p.label;
			modeSelect.appendChild(opt);
		}
		modeSelect.value = this.options.magicPreset ?? 'chat';
		modeSelect.addEventListener('change', (e) => {
			const val = (e.target as HTMLSelectElement).value as MagicDiaryPreset;
			this.options.magicPreset = val;
			this.options.onMagicPresetChange?.(val);
		});

		banner.append(crest, status, modeSelect, autoToggleBtn, replyNowBtn, clearRepliesBtn);
		this.magicBannerEl = banner;
		this.layer.appendChild(banner);

		const replies = document.createElement('div');
		replies.className = 'bimo-magic-diary-replies';
		replies.style.display = 'none';
		this.magicRepliesContainer = replies;
		this.layer.appendChild(replies);
	}

	/**
	 * The floating tool pill.
	 *
	 * Lives on `.cm-editor` rather than inside the content, so it stays put while
	 * the note scrolls. Faint until hovered: a permanent toolbar over prose is
	 * the thing this feature is supposed to avoid.
	 */
	private createPill(): void {
		this.pill = document.createElement('div');
		this.pill.className = 'bimo-md-ink-pill';

		const dragHandle = document.createElement('div');
		dragHandle.className = 'bimo-md-ink-pill__drag-handle';
		dragHandle.setAttribute('title', t('Drag toolbar (double-click to switch preset position)'));
		applyIcon(dragHandle, 'grip-vertical', 'more-vertical');
		dragHandle.addEventListener('dblclick', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.pillDrag?.cyclePreset?.();
		});
		this.pill.appendChild(dragHandle);

		const toolButtons: Array<{ tool: MdInkTool; icon: string; fallback?: string; label: string }> = [
			{ tool: 'pen', icon: 'pencil', fallback: 'pen', label: t('Pen') },
			{ tool: 'highlighter', icon: 'highlighter', fallback: 'brush', label: t('Highlighter') },
			{ tool: 'eraser', icon: 'eraser', label: t('Eraser') },
			{ tool: 'lasso', icon: 'lasso', fallback: 'lasso-select', label: t('Lasso') },
			{ tool: 'pan', icon: 'hand', fallback: 'grab', label: t('Pan') },
		];

		for (const { tool, icon, fallback, label } of toolButtons) {
			const button = document.createElement('button');
			button.type = 'button';
			button.title = label;
			applyIcon(button, icon, fallback);
			button.dataset.mdInkTool = tool;
			button.addEventListener('pointerdown', (event) => {
				// The pill sits above the scroller; without this the editor steals
				// the press and the click never lands.
				event.stopPropagation();
			});
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.stylePopover?.close();

				if (tool === 'eraser' && this.getTool() === 'eraser') {
					// Clicking eraser while already in eraser mode opens the style popover to adjust radius & mode!
					this.stylePopover?.open();
					return;
				}

				this.stylePopover?.close();
				this.options.onToolSelected?.(tool);
				this.setTool(tool);
			});
			this.pill.appendChild(button);
		}

		this.stylePopover = createPillStylePopover({
			pill: this.pill,
			showPaper: true,
			getState: () => ({
				brush: this.options.brush,
				colour: this.options.colour,
				size: this.options.size,
				paper: this.options.paper,
				eraserMode: this.options.eraserMode ?? 'stroke',
				eraserRadius: this.options.eraserRadius,
				fingerDraws: this.options.fingerDraws,
			}),
			onChange: (patch) => {
				if (patch.paper !== undefined) {
					this.setPaper(patch.paper);
				}
				if (patch.eraserMode !== undefined) {
					this.options.eraserMode = patch.eraserMode;
					const eraserBtn = this.pill.querySelector<HTMLButtonElement>('button[data-md-ink-tool="eraser"]');
					if (eraserBtn) this.syncEraserButton(eraserBtn);
				}
				if (patch.eraserRadius !== undefined) {
					this.options.eraserRadius = patch.eraserRadius;
				}
				if (
					patch.brush !== undefined
					|| patch.colour !== undefined
					|| patch.size !== undefined
					|| patch.eraserMode !== undefined
					|| patch.eraserRadius !== undefined
					|| patch.fingerDraws !== undefined
				) {
					this.setOptions(patch);
				}
				if (patch.brush !== undefined) {
					const targetTool: MdInkTool = patch.brush === 'highlighter' ? 'highlighter' : 'pen';
					this.options.onToolSelected?.(targetTool);
					this.setTool(targetTool);
				}
				this.options.onStyleChange?.(patch);
			},
		});
		this.pill.appendChild(this.stylePopover.button);

		const magicBtn = document.createElement('button');
		magicBtn.type = 'button';
		magicBtn.className = 'bimo-md-ink-pill__magic-btn';
		magicBtn.dataset.mdInkAction = 'magic-diary';
		applyIcon(magicBtn, 'sparkles', 'wand-2');
		magicBtn.title = t('Toggle Magic Diary Page (you write a line, AI writes a line)');
		magicBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
		magicBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.stylePopover?.close();
			this.setMagicDiaryMode(!this.magicDiaryMode);
		});
		this.magicBtn = magicBtn;
		this.pill.appendChild(magicBtn);

		const gap = document.createElement('span');
		gap.className = 'bimo-md-ink-pill__gap';
		this.pill.appendChild(gap);

		const undo = document.createElement('button');
		undo.type = 'button';
		undo.dataset.mdInkAction = 'undo';
		applyIcon(undo, 'undo', 'undo-2');
		undo.title = t('Undo ink stroke');
		undo.addEventListener('pointerdown', (event) => event.stopPropagation());
		undo.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.undo();
		});
		this.undoBtn = undo;
		this.pill.appendChild(undo);

		const redo = document.createElement('button');
		redo.type = 'button';
		redo.dataset.mdInkAction = 'redo';
		applyIcon(redo, 'redo', 'redo-2');
		redo.title = t('Redo ink stroke');
		redo.addEventListener('pointerdown', (event) => event.stopPropagation());
		redo.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.redo();
		});
		this.redoBtn = redo;
		this.pill.appendChild(redo);

		const clear = document.createElement('button');
		clear.type = 'button';
		clear.dataset.mdInkAction = 'clear';
		applyIcon(clear, 'trash', 'trash-2');
		clear.title = t('Clear all ink on this note');
		clear.addEventListener('pointerdown', (event) => event.stopPropagation());
		clear.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.clearAll();
		});
		this.pill.appendChild(clear);

		// Hosted on `document.body`, not on the editor.
		//
		// A `position: fixed` box only resolves against the viewport while no
		// ancestor establishes a containing block. Obsidian's editor wrappers are
		// free to add `transform` / `contain` for scroll performance, and when one
		// does, the pill's coordinates silently switch to that ancestor's box —
		// the pill then jumps away from the pointer while being dragged. Outside
		// the editor tree that cannot happen at all.
		document.body.appendChild(this.pill);
		this.disposers.push(() => {
			this.stylePopover?.destroy();
			this.stylePopover = null;
			this.pillDrag?.destroy();
			this.pillDrag = null;
			this.pill.remove();
		});
		this.bindPillDrag();
		this.syncPill();
		this.syncPillColour();
		this.syncUndoRedoButtons();
	}

	/**
	 * Make the pill draggable by its own body.
	 *
	 * The buttons stop pointer events, so a drag can only start on the gaps
	 * between them — which is exactly the intent. Everything else (edge
	 * clamping, release recovery, where the position is remembered) lives in
	 * `pill-drag.ts`, shared with the PDF pill so the two cannot drift apart.
	 */
	private bindPillDrag(): void {
		this.pillDrag = attachPillDrag({
			pill: this.pill,
			host: this.view.dom,
			storageKey: PILL_POSITION_KEY,
			positioning: 'fixed',
			defaultPosition: ({ host, pill }) => ({
				left: host.right - pill.width - 16,
				top: host.top + 8,
			}),
		});

		// The host box changes when a sidebar is dragged or the window resizes.
		// A pill parked near the old right edge would otherwise end up outside
		// the visible editor until the note is reopened. `ResizeObserver` is
		// absent in the jsdom test environment, hence the guard.
		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(() => this.pillDrag?.reclamp());
			observer.observe(this.view.dom);
			this.disposers.push(() => observer.disconnect());
		}
	}

	/** The pen button carries a dot in the ink's own colour, so the current colour is visible without opening the panel. */
	private syncPillColour(): void {
		if (!this.pill) return;
		const colour = this.options.colour === 'currentColor'
			? 'var(--text-normal)'
			: this.options.colour;
		this.pill.style.setProperty('--bimo-md-ink-colour', colour);
	}

	/** Reflect the active tool and whether the pen is up. */
	private syncPill(): void {
		if (!this.pill) return;
		const active = this.getTool();
		this.pill.classList.toggle('is-live', this.enabled && active !== 'pan');
		for (const button of Array.from(this.pill.querySelectorAll<HTMLButtonElement>('[data-md-ink-tool]'))) {
			button.classList.toggle('is-active', button.dataset.mdInkTool === active);
		}
		this.syncEraserButton();
		this.stylePopover?.sync();
	}

	private syncEraserButton(button?: HTMLButtonElement): void {
		const btn = button ?? (this.pill?.querySelector<HTMLButtonElement>('button[data-md-ink-tool="eraser"]') ?? null);
		if (!btn) return;
		const isPixel = this.options.eraserMode === 'pixel';
		btn.dataset.mdInkEraserMode = isPixel ? 'pixel' : 'stroke';
		btn.title = isPixel
			? `${t('Eraser')} (${t('Partial eraser')} · ${t('Click to switch to object eraser')})`
			: `${t('Eraser')} (${t('Object eraser')} · ${t('Click to switch to partial eraser')})`;
	}

	private syncUndoRedoButtons(): void {
		if (this.undoBtn) {
			const canUndo = this.canUndo();
			this.undoBtn.disabled = !canUndo;
			this.undoBtn.classList.toggle('is-disabled', !canUndo);
		}
		if (this.redoBtn) {
			const canRedo = this.canRedo();
			this.redoBtn.disabled = !canRedo;
			this.redoBtn.classList.toggle('is-disabled', !canRedo);
		}
	}

	/** Reclamp the floating pill and sync its visibility with the editor host. */
	reclampPill(): void {
		this.pillDrag?.reclamp();
	}

	destroy(): void {
		this.destroyed = true;
		this.clearHoldSnapTimer();
		this.clearMagicPauseTimer();
		if (this.previousPaperBeforeMagic !== null) {
			this.doc.paper = this.previousPaperBeforeMagic;
			this.options.paper = this.previousPaperBeforeMagic;
			this.previousPaperBeforeMagic = null;
		}
		this.view.dom.classList.remove('bimo-md-ink-writing-active');
		document.body.classList.remove('bimo-md-ink-writing-active');
		this.component.unload();
		this.scrollerEl.classList.remove('bimo-magic-diary-active');
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.pathElements.clear();
		this.layer.remove();
	}

	/** Re-read settings after the user changes one. */
	setOptions(patch: Partial<MdInkOverlayOptions>): void {
		const prevColour = this.options.colour;
		this.options = { ...this.options, ...patch };
		this.applyToolCursor();
		if (patch.colour !== undefined) {
			this.syncPillColour();
			if (patch.colour !== prevColour && this.selectedIds.size > 0) {
				this.recolourSelected(patch.colour);
			}
		}
		if (patch.paper !== undefined) this.render();
		this.stylePopover?.sync();
	}

	getDocument(): MdInkDocument {
		return this.doc;
	}

	replaceDocument(doc: MdInkDocument): void {
		this.doc = doc;
		this.adoptPaper(doc);
		this.undoStack = [];
		this.redoStack = [];
		this.selectedIds.clear();
		this.syncUndoRedoButtons();
		this.stylePopover?.sync();
		this.render();
	}

	/**
	 * Take the paper style from the document, not from the global setting.
	 *
	 * Each note stores its own paper (`setPaper` writes it), but rendering read
	 * `options.paper` — which only ever held the default. The result was paper
	 * that looked switchable and then silently reverted on the next open.
	 *
	 * A note with no ink and no paper choice is indistinguishable from a fresh
	 * one, so it keeps the setting instead of pinning itself to `none`.
	 */
	private adoptPaper(doc: MdInkDocument): void {
		const paper = resolvePaperStyle(doc, this.options.paper);
		if (paper !== this.options.paper) this.options = { ...this.options, paper };
	}

	/**
	 * Merge a document loaded from disk without discarding local strokes.
	 *
	 * The read is asynchronous, so a fast user can put ink down before it
	 * resolves. An unconditional `replaceDocument` would silently delete that
	 * stroke — and worse, the next save would then persist the emptied document
	 * over the real one on disk.
	 */
	hydrateFromDisk(doc: MdInkDocument): void {
		const local = this.doc.strokes;
		if (local.length === 0) {
			this.replaceDocument(doc);
			return;
		}
		this.doc = mergeMdInkDocuments(this.doc, doc);
		this.adoptPaper(this.doc);
		this.render();
	}

	getTool(): MdInkTool {
		if (!this.enabled) return 'pan';
		return this.spaceHeld ? 'pan' : this.tool;
	}

	/** Hide or show the layer without destroying it, so strokes survive a toggle. */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (this.layer) this.layer.style.display = enabled ? '' : 'none';
		if (this.pill) this.pill.style.display = enabled ? '' : 'none';
		if (!enabled) this.stylePopover?.close();
		this.applyToolCursor();
	}

	/**
	 * Whether the pencil has ever been picked in this overlay's lifetime.
	 *
	 * The layer starts on `pan` by design (it must not swallow text selection),
	 * which means a first stroke does nothing at all. One hint per overlay is
	 * enough to connect "nothing happens" to "pick the pencil".
	 */
	private pencilHintResolved = false;

	setTool(tool: MdInkTool): void {
		this.tool = tool;
		this.selectedIds.clear();
		this.applyToolCursor();
		this.render();
		this.updatePencilHint(tool);
	}

	private updatePencilHint(tool: MdInkTool): void {
		if (!this.pill) return;
		if (tool !== 'pan') {
			this.pencilHintResolved = true;
			this.pill.classList.remove('is-hinting');
			return;
		}
		if (!this.pencilHintResolved) this.pill.classList.add('is-hinting');
	}

	///////////////////////////
	// Geometry
	///////////////////////////

	private contentOrigin(): { x: number; y: number } {
		const content = this.view.contentDOM;
		const rect = content.getBoundingClientRect();
		return { x: rect.left + content.clientLeft, y: rect.top + content.clientTop };
	}

	/** Document line (1-based) under a screen point. */
	private lineAtScreen(clientX: number, clientY: number): number {
		let pos: number | null = null;
		try {
			pos = this.view.posAtCoords({ x: clientX, y: clientY }, false);
		} catch {
			pos = null;
		}
		const resolved = pos ?? this.view.state.selection.main.head;
		return this.view.state.doc.lineAt(resolved).number;
	}

	/** Top edge of a line in content coordinates, or null when the line is gone. */
	private lineTopInContent(lineNumber: number): number | null {
		const total = this.view.state.doc.lines;
		if (lineNumber < 1 || lineNumber > total) return null;
		const lineFrom = this.view.state.doc.line(lineNumber).from;
		let coords: { top: number } | null = null;
		try {
			coords = this.view.coordsAtPos(lineFrom);
		} catch {
			coords = null;
		}
		const origin = this.contentOrigin();
		if (coords) return coords.top - origin.y;

		// `coordsAtPos` only answers for lines CodeMirror has actually rendered,
		// and it only renders the viewport. Returning null (and therefore 0) for
		// everything else collapsed every off-screen stroke onto the first line —
		// scrolling a long note made its ink pile up at the top, and exporting
		// wrote the same wrong positions into the SVG.
		//
		// The height map covers the whole document: exact above the viewport,
		// measured-and-estimated below it. Either is a position on the right
		// line, which is what the anchor model promises.
		const block = this.view.lineBlockAt(lineFrom);
		// Guard the API rather than trust it: `documentTop` is a getter on the
		// EditorView Obsidian ships, and a `undefined` here would turn every
		// transform into `translate(0 NaN)` — strokes that vanish entirely, which
		// is worse than the position bug being fixed.
		const documentTop = (this.view as EditorView & { documentTop?: number }).documentTop;
		if (typeof documentTop !== 'number') return null;
		return documentTop + block.top - origin.y;
	}

	/** Screen point → coordinates local to the given line's top-left. */
	private screenToLocal(clientX: number, clientY: number, lineNumber: number): { x: number; y: number } {
		const origin = this.contentOrigin();
		const top = this.lineTopInContent(lineNumber);
		const lineTop = top ?? 0;
		return {
			x: clientX - origin.x,
			y: clientY - origin.y - lineTop,
		};
	}

	private pressureFor(event: PointerEvent): number {
		const isPen = event.pointerType === 'pen';
		if (isPen) return event.pressure > 0 ? event.pressure : 0.5;
		return 0.5;
	}

	///////////////////////////
	// Style
	///////////////////////////

	/**
	 * Resolve the brush preset for the active tool.
	 *
	 * Picking the `highlighter` tool on the pill must always draw with the
	 * highlighter preset; picking `pen` uses the configured pen brush (falling
	 * back to `pen` if `options.brush` was left on `highlighter`).
	 */
	private effectiveBrush(): InkBrushKind {
		if (this.getTool() === 'highlighter') return 'highlighter';
		return this.options.brush === 'highlighter' ? 'pen' : this.options.brush;
	}

	private buildStyle(brush: InkBrushKind): InkStrokeStyle {
		const preset = resolveBrushPreset(brush);
		const baseSize = this.options.size;
		const isHighlighter = brush === 'highlighter';
		const colour = isHighlighter && this.options.colour === 'currentColor'
			? preset.defaultColour
			: this.options.colour;

		return {
			size: baseSize * preset.sizeMultiplier,
			thinning: preset.thinning,
			smoothing: preset.smoothing,
			streamline: preset.streamline,
			simulatePressure: true,
			inputKind: 'pen',
			color: colour,
			brush,
			opacity: preset.opacity,
		};
	}

	///////////////////////////
	// Rendering
	///////////////////////////

	requestRender(): void {
		if (this.renderQueued || this.destroyed) return;
		this.renderQueued = true;
		const run = () => {
			if (!this.renderQueued) return;
			this.renderQueued = false;
			if (!this.destroyed) this.render();
		};
		requestAnimationFrame(run);
		// Chromium suspends requestAnimationFrame while the window is hidden or
		// minimised — measured directly: `visibilityState === 'hidden'` and a
		// scheduled frame never ran. Without this fallback a stroke drawn on a
		// de-focused window (stylus on a second display, tablet mode) would be
		// recorded but stay invisible until the user came back. The timer is a
		// no-op whenever the frame ran first.
		window.setTimeout(run, 120);
	}

	render(): void {
		// The scroller itself is stable, but a theme or a view rebuild can move
		// it. Re-attaching is cheaper than a MutationObserver and keeps the layer
		// from vanishing after an edit nobody would connect to handwriting.
		const scroller = this.scrollerEl;
		if (!this.destroyed && this.layer.parentElement !== scroller) {
			scroller.appendChild(this.layer);
		}
		this.checkMagicFrontmatter();
		this.renderStrokes();
		this.syncLayerSize();
		this.renderPaper();
		this.syncSelectionBar();
	}

	/** Lowest y-coordinate (in content space) reached by any committed or in-progress stroke. */
	private maxStrokeBottomY(): number {
		let maxY = this.magicDiaryMode ? this.magicMaxReplyBottomY : 0;
		const lineTops = new Map<number, number>();
		for (const stroke of this.doc.strokes) {
			const line = this.lineOf(stroke);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			let top = lineTops.get(lineNumber);
			if (top === undefined) {
				top = this.lineTopInContent(lineNumber) ?? 0;
				lineTops.set(lineNumber, top);
			}
			for (const [, py] of stroke.points) {
				const y = top + stroke.offset.y + py;
				if (y > maxY) maxY = y;
			}
		}
		if (this.activeStroke) {
			const top = this.lineTopInContent(this.activeStroke.anchorLine) ?? 0;
			for (const [, py] of this.activeStroke.points) {
				const y = top + py;
				if (y > maxY) maxY = y;
			}
		}
		return maxY;
	}

	/**
	 * Compute the drawable canvas dimensions.
	 *
	 * On a blank or short note, `.cm-content.scrollHeight` is only one line tall
	 * (~28-40px). Sizing the ink layer strictly to `content.scrollHeight` made the
	 * rest of a blank page unclickable and stopped paper lines after line 1.
	 * Including `scroller.clientHeight` and `maxStrokeBottomY() + BLANK_NOTE_GROW_BUFFER_PX`
	 * turns any blank `.md` file into an auto-expanding sheet of paper.
	 */
	private computeCanvasDimensions(): { width: number; height: number } {
		const content = this.view.contentDOM;
		const scroller = this.scrollerEl;
		const width = Math.max(content.scrollWidth, content.clientWidth, scroller.clientWidth, 320);
		const strokeBottom = this.maxStrokeBottomY();
		const hasContent = this.doc.strokes.length > 0 || this.activeStroke !== null || (this.magicDiaryMode && this.magicMaxReplyBottomY > 0);
		const inkExtendedHeight = hasContent
			? Math.ceil(strokeBottom) + BLANK_NOTE_GROW_BUFFER_PX
			: 0;
		const minInteractiveHeight = (this.enabled && this.getTool() !== 'pan') || this.magicDiaryMode ? 600 : 0;
		const height = Math.max(
			content.scrollHeight,
			content.clientHeight,
			scroller.clientHeight,
			inkExtendedHeight,
			minInteractiveHeight,
		);
		return { width, height };
	}

	private syncLayerSize(): void {
		const content = this.view.contentDOM;
		const scroller = this.scrollerEl;
		const { width, height } = this.computeCanvasDimensions();
		this.layer.style.width = `${width}px`;
		this.layer.style.height = `${height}px`;

		// Strokes are stored in the content box's own coordinates. The layer now
		// hangs off the scroller, so it needs the content's offset inside that
		// coordinate space — plus the scroll delta, because `getBoundingClientRect`
		// reports the post-scroll position while CSS positions live in the
		// unscrolled system.
		const contentRect = content.getBoundingClientRect();
		const scrollerRect = scroller.getBoundingClientRect();
		this.layer.style.left = `${contentRect.left - scrollerRect.left + scroller.scrollLeft}px`;
		this.layer.style.top = `${contentRect.top - scrollerRect.top + scroller.scrollTop}px`;
	}

	/**
	 * The document's text, split into lines, cached per document version.
	 *
	 * Resolving an anchor needs the current line texts; doing that per stroke
	 * would walk the whole document once per path, which on a long note turns a
	 * scroll repaint into hundreds of thousands of string operations. The doc
	 * object identity changes on every edit, so it is a free cache key.
	 */
	private docLines(): string[] {
		const doc = this.view.state.doc;
		if (this.linesCache && this.linesCache.doc === doc) return this.linesCache.lines;

		const lines: string[] = [];
		for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
		this.linesCache = { doc, lines };
		return lines;
	}

	private lineOf(stroke: MdInkStroke): number | null {
		return resolveAnchorLine(this.docLines(), stroke.anchor);
	}

	private renderStrokes(): void {
		const group = this.strokeGroup;
		const lineTops = new Map<number, number>();
		const seenIds = new Set<string>();

		for (const stroke of this.doc.strokes) {
			seenIds.add(stroke.id);
			const line = this.lineOf(stroke);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;

			let top = lineTops.get(lineNumber);
			if (top === undefined) {
				top = this.lineTopInContent(lineNumber) ?? 0;
				lineTops.set(lineNumber, top);
			}

			const pathData = stroke.points.length === 1
				? dotPath(stroke.points[0][0], stroke.points[0][1], stroke.style.size / 2)
				: getRenderedStrokeData(stroke).pathD;

			let path = this.pathElements.get(stroke.id);
			if (!path) {
				path = document.createElementNS(SVG_NS, 'path');
				path.dataset.strokeId = stroke.id;
				this.pathElements.set(stroke.id, path);
			}
			if (path.getAttribute('d') !== pathData) {
				path.setAttribute('d', pathData);
			}
			const fill = stroke.style.color || 'currentColor';
			if (path.getAttribute('fill') !== fill) {
				path.setAttribute('fill', fill);
			}
			if (stroke.style.opacity !== undefined && stroke.style.opacity < 1) {
				const op = String(stroke.style.opacity);
				if (path.getAttribute('opacity') !== op) path.setAttribute('opacity', op);
			} else if (path.hasAttribute('opacity')) {
				path.removeAttribute('opacity');
			}
			path.classList.toggle('is-selected', this.selectedIds.has(stroke.id));
			path.classList.toggle('is-magic-reading', this.magicReadingStrokeIds.has(stroke.id));
			const transform = `translate(${stroke.offset.x} ${top + stroke.offset.y})`;
			if (path.getAttribute('transform') !== transform) {
				path.setAttribute('transform', transform);
			}
			if (path.parentNode !== group) {
				group.appendChild(path);
			}
		}

		for (const [id, path] of this.pathElements) {
			if (!seenIds.has(id)) {
				path.remove();
				this.pathElements.delete(id);
			}
		}
	}

	private buildPaperPatterns(defs: SVGDefsElement): void {
		const uid = this.patternUid;

		// 1. Ruled pattern (horizontal lines every 24px)
		const ruled = document.createElementNS(SVG_NS, 'pattern');
		ruled.id = `bimo-paper-ruled-${uid}`;
		ruled.setAttribute('width', '100');
		ruled.setAttribute('height', '24');
		ruled.setAttribute('patternUnits', 'userSpaceOnUse');
		const line = document.createElementNS(SVG_NS, 'line');
		line.setAttribute('x1', '0');
		line.setAttribute('y1', '24');
		line.setAttribute('x2', '100');
		line.setAttribute('y2', '24');
		line.setAttribute('class', 'bimo-md-ink-paper-line');
		ruled.appendChild(line);
		defs.appendChild(ruled);

		// 2. Grid pattern (24px x 24px boxes)
		const grid = document.createElementNS(SVG_NS, 'pattern');
		grid.id = `bimo-paper-grid-${uid}`;
		grid.setAttribute('width', '24');
		grid.setAttribute('height', '24');
		grid.setAttribute('patternUnits', 'userSpaceOnUse');
		const gridPath = document.createElementNS(SVG_NS, 'path');
		gridPath.setAttribute('d', 'M 24 0 L 0 0 0 24');
		gridPath.setAttribute('fill', 'none');
		gridPath.setAttribute('class', 'bimo-md-ink-paper-line');
		grid.appendChild(gridPath);
		defs.appendChild(grid);

		// 3. Dots pattern (dot every 24px)
		const dots = document.createElementNS(SVG_NS, 'pattern');
		dots.id = `bimo-paper-dots-${uid}`;
		dots.setAttribute('width', '24');
		dots.setAttribute('height', '24');
		dots.setAttribute('patternUnits', 'userSpaceOnUse');
		const dot = document.createElementNS(SVG_NS, 'circle');
		dot.setAttribute('cx', '12');
		dot.setAttribute('cy', '12');
		dot.setAttribute('r', '1');
		dot.setAttribute('class', 'bimo-md-ink-paper-dot');
		dots.appendChild(dot);
		defs.appendChild(dots);
	}

	private renderPaper(): void {
		const paper = this.options.paper;
		if (paper === 'none' || !this.paperRect) {
			if (this.paperRect) this.paperRect.style.display = 'none';
			return;
		}

		const { width, height } = this.computeCanvasDimensions();
		this.paperRect.style.display = '';
		this.paperRect.setAttribute('x', '0');
		this.paperRect.setAttribute('y', '0');
		this.paperRect.setAttribute('width', String(width));
		this.paperRect.setAttribute('height', String(height));
		this.paperRect.setAttribute('fill', `url(#bimo-paper-${paper}-${this.patternUid})`);
	}

	///////////////////////////
	// Input
	///////////////////////////

	private bindPointerEvents(): void {
		const down = (event: PointerEvent) => this.onPointerDown(event);
		const move = (event: PointerEvent) => this.onPointerMove(event);
		const up = (event: PointerEvent) => this.onPointerUp(event);
		const cancel = (event: PointerEvent) => this.onPointerCancel(event);

		const touchFilter = (event: TouchEvent) => {
			if (this.getTool() === 'pan') return;
			const target = event.target as HTMLElement | null;
			if (target?.closest('button, select, input, a, .bimo-md-ink-pill, .bimo-magic-diary-banner, .bimo-magic-diary-reply button')) {
				return;
			}
			event.stopPropagation();
			if (!this.options.fingerDraws) {
				event.preventDefault();
			}
		};

		this.layer.addEventListener('pointerdown', down);
		this.layer.addEventListener('touchstart', touchFilter, { passive: false });
		this.layer.addEventListener('touchmove', touchFilter, { passive: false });
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);

		this.disposers.push(() => {
			this.layer.removeEventListener('pointerdown', down);
			this.layer.removeEventListener('touchstart', touchFilter);
			this.layer.removeEventListener('touchmove', touchFilter);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
		});
	}

	private bindKeyboard(): void {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === ' ' && !this.isTypingTarget(event.target)) {
				this.spaceHeld = true;
				this.applyToolCursor();
			}

			// Deleting ink is scoped to "a lasso selection exists", which is the
			// only state where Delete cannot mean "delete a character". It is not a
			// registered hotkey for exactly that reason.
			if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedIds.size > 0) {
				event.preventDefault();
				event.stopPropagation();
				this.deleteSelected();
				return;
			}

			if ((event.ctrlKey || event.metaKey) && (event.key === 'd' || event.key === 'D') && this.selectedIds.size > 0) {
				event.preventDefault();
				event.stopPropagation();
				this.duplicateSelected();
				return;
			}

			if (event.key === 'Escape' && this.selectedIds.size > 0) {
				this.selectedIds.clear();
				this.render();
			}
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === ' ') {
				this.spaceHeld = false;
				this.applyToolCursor();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		this.disposers.push(() => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
		});
	}

	private isTypingTarget(target: EventTarget | null): boolean {
		const element = target as HTMLElement | null;
		if (!element) return false;
		const tag = element.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
	}

	private applyToolCursor(): void {
		const tool = this.getTool();
		const isDrawing = tool !== 'pan';
		this.layer.style.pointerEvents = isDrawing ? 'auto' : 'none';
		this.layer.dataset.tool = tool;
		this.layer.dataset.fingerDraws = this.options.fingerDraws ? 'true' : 'false';
		this.view.dom.classList.toggle('bimo-md-ink-writing-active', isDrawing);
		document.body.classList.toggle('bimo-md-ink-writing-active', isDrawing);
		this.syncPill();
	}

	private isPointInSelectionBounds(x: number, y: number, pad = 12): boolean {
		if (this.selectedIds.size === 0) return false;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let found = false;

		for (const stroke of this.doc.strokes) {
			if (!this.selectedIds.has(stroke.id)) continue;
			const line = this.lineOf(stroke);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			const top = this.lineTopInContent(lineNumber) ?? 0;
			for (const [px, py] of stroke.points) {
				const lx = px + stroke.offset.x;
				const ly = py + stroke.offset.y + top;
				if (lx < minX) minX = lx;
				if (ly < minY) minY = ly;
				if (lx > maxX) maxX = lx;
				if (ly > maxY) maxY = ly;
				found = true;
			}
		}

		if (!found) return false;
		return x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad;
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 && event.button !== 5) return;
		if (this.getTool() === 'pan') return;
		if (event.pointerType === 'mouse' && !this.options.mouseDrawing && this.getTool() !== 'lasso') {
			explainMouseDrawingDisabled();
			return;
		}

		// Pure Writing & Palm Rejection:
		// When finger drawing is off, fingers strictly pan the canvas instead of triggering
		// text carets, selections, or keyboard popups in CodeMirror.
		if (event.pointerType === 'touch' && !this.options.fingerDraws && this.getTool() !== 'lasso') {
			event.preventDefault();
			event.stopPropagation();
			// If already drawing with stylus, drop palm contact completely
			if (this.activePointerId !== null) {
				return;
			}
			const scroller = this.scrollerEl;
			this.touchPan = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				startScrollLeft: scroller.scrollLeft,
				startScrollTop: scroller.scrollTop,
			};
			this.layer.setPointerCapture?.(event.pointerId);
			return;
		}

		// A second finger means pinch or two-finger scroll: drop the stroke in
		// progress so zooming out of a mis-drawn mark leaves no stray ink.
		if (this.activePointerId !== null && this.activePointerId !== event.pointerId) {
			this.abortActiveStroke();
			return;
		}

		this.stylePopover?.close();
		event.preventDefault();
		event.stopPropagation();
		this.activePointerId = event.pointerId;
		this.layer.setPointerCapture?.(event.pointerId);

		const tool = this.getTool();
		const origin = this.contentOrigin();
		const local = { x: event.clientX - origin.x, y: event.clientY - origin.y };

		// Stylus tail eraser (button 5) or Mod-key temporary eraser while pen/highlighter is active.
		const isTransientEraser = event.button === 5
			|| ((tool === 'pen' || tool === 'highlighter') && (event.ctrlKey || event.metaKey));
		if (tool === 'eraser' || isTransientEraser) {
			this.transientEraser = isTransientEraser;
			this.activeEraseSession = { removed: [], added: [] };
			this.eraseAt(event.clientX, event.clientY);
			return;
		}

		if (tool === 'lasso') {
			this.lassoStart = local;
			this.dragStart = local;

			if (this.selectedIds.size > 0 && this.isPointInSelectionBounds(local.x, local.y)) {
				this.lassoMode = 'move';
				this.lassoRect.style.display = 'none';
				this.dragOrigins.clear();
				for (const stroke of this.doc.strokes) {
					if (this.selectedIds.has(stroke.id)) {
						this.dragOrigins.set(stroke.id, { ...stroke.offset });
					}
				}
			} else {
				this.lassoMode = 'select';
				if (this.selectedIds.size > 0) {
					this.selectedIds.clear();
					this.dragOrigins.clear();
					this.render();
				}
				this.lassoRect.style.display = '';
				this.lassoRect.setAttribute('x', String(local.x));
				this.lassoRect.setAttribute('y', String(local.y));
				this.lassoRect.setAttribute('width', '0');
				this.lassoRect.setAttribute('height', '0');
			}
			return;
		}

		// pen / highlighter
		const line = this.lineAtScreen(event.clientX, event.clientY);
		const lineText = this.view.state.doc.line(line).text;
		const localPoint = this.screenToLocal(event.clientX, event.clientY, line);
		const initialPressure = this.pressureFor(event);
		const hasRealPressure = event.pointerType === 'pen' && event.pressure > 0 && Math.abs(event.pressure - 0.5) > 0.005;
		const style = this.buildStyle(this.effectiveBrush());
		if (hasRealPressure) style.simulatePressure = false;

		this.clearHoldSnapTimer();
		if (this.magicDiaryMode) {
			this.clearMagicPauseTimer();
			if (this.magicStatusEl) {
				this.magicStatusEl.textContent = t('Listening to your handwriting…');
			}
		}
		this.activeStroke = {
			points: [[localPoint.x, localPoint.y, initialPressure]],
			style,
			anchorLine: line,
			anchorText: lineText,
			lastPressure: initialPressure,
			hasRealPressure,
		};
		this.renderLiveStroke();
	}

	private clearHoldSnapTimer(): void {
		if (this.holdSnapTimer !== null) {
			clearTimeout(this.holdSnapTimer);
			this.holdSnapTimer = null;
		}
		this.holdAnchorScreen = null;
	}

	private scheduleHoldSnap(clientX: number, clientY: number): void {
		if (!this.options.shapeSnap || !this.activeStroke || this.activeStroke.snappedByHold) return;
		if (
			this.holdAnchorScreen
			&& Math.hypot(clientX - this.holdAnchorScreen.x, clientY - this.holdAnchorScreen.y) <= HOLD_SNAP_JITTER_PX
			&& this.holdSnapTimer !== null
		) {
			return;
		}
		if (this.holdSnapTimer !== null) {
			clearTimeout(this.holdSnapTimer);
		}
		this.holdAnchorScreen = { x: clientX, y: clientY };
		this.holdSnapTimer = setTimeout(() => {
			this.holdSnapTimer = null;
			if (!this.activeStroke || this.activeStroke.snappedByHold || this.activeStroke.points.length < 3) return;
			const snapped = snapStrokePoints(this.activeStroke.points, HOLD_TO_SNAP_TOLERANCE);
			if (snapped !== this.activeStroke.points) {
				this.activeStroke.points = snapped;
				this.activeStroke.snappedByHold = true;
				this.renderLiveStroke();
			}
		}, HOLD_TO_SNAP_DELAY_MS);
	}

	/**
	 * Draw a ring at the pointer showing the real footprint of the current tool.
	 *
	 * Without it the eraser is a guess: you only learn its radius by watching
	 * what disappears. The ring is the size of the actual hit radius, not a
	 * decorative dot.
	 */
	private updateReticle(clientX: number, clientY: number): void {
		if (!this.enabled || this.getTool() === 'pan' || this.activeStroke) {
			this.reticle.style.display = 'none';
			return;
		}

		const rect = this.view.contentDOM.getBoundingClientRect();
		if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
			this.reticle.style.display = 'none';
			return;
		}

		const origin = this.contentOrigin();
		this.reticle.setAttribute('cx', String(clientX - origin.x));
		this.reticle.setAttribute('cy', String(clientY - origin.y));
		this.reticle.setAttribute('r', String(this.reticleRadius()));
		this.reticle.style.display = '';
	}

	private reticleRadius(): number {
		const tool = this.getTool();
		if (tool === 'eraser' || this.transientEraser) return this.options.eraserRadius;
		if (tool === 'lasso') return 4;
		const preset = resolveBrushPreset(this.effectiveBrush());
		return Math.max(2, (this.options.size * preset.sizeMultiplier) / 2);
	}

	private onPointerMove(event: PointerEvent): void {
		if (this.touchPan && event.pointerId === this.touchPan.pointerId) {
			event.preventDefault();
			event.stopPropagation();
			const scroller = this.scrollerEl;
			const dx = event.clientX - this.touchPan.startX;
			const dy = event.clientY - this.touchPan.startY;
			scroller.scrollLeft = this.touchPan.startScrollLeft - dx;
			scroller.scrollTop = this.touchPan.startScrollTop - dy;
			return;
		}

		this.updateReticle(event.clientX, event.clientY);

		const tool = this.getTool();

		if (tool === 'lasso' && this.lassoStart) {
			const origin = this.contentOrigin();
			const local = { x: event.clientX - origin.x, y: event.clientY - origin.y };

			if (this.lassoMode === 'move' && this.selectedIds.size > 0 && this.dragOrigins.size > 0) {
				const dx = local.x - (this.dragStart?.x ?? local.x);
				const dy = local.y - (this.dragStart?.y ?? local.y);
				for (const stroke of this.doc.strokes) {
					const original = this.dragOrigins.get(stroke.id);
					if (!original) continue;
					stroke.offset = { x: original.x + dx, y: original.y + dy };
				}
				this.requestRender();
				return;
			}

			const x = Math.min(this.lassoStart.x, local.x);
			const y = Math.min(this.lassoStart.y, local.y);
			const width = Math.abs(local.x - this.lassoStart.x);
			const height = Math.abs(local.y - this.lassoStart.y);
			this.lassoRect.setAttribute('x', String(x));
			this.lassoRect.setAttribute('y', String(y));
			this.lassoRect.setAttribute('width', String(width));
			this.lassoRect.setAttribute('height', String(height));
			return;
		}

		if ((tool === 'eraser' || this.transientEraser) && this.activePointerId !== null) {
			this.eraseAt(event.clientX, event.clientY);
			return;
		}

		if (!this.activeStroke) return;
		if (event.pointerId !== this.activePointerId) return;

		const line = this.activeStroke.anchorLine;
		if (this.activeStroke.snappedByHold) {
			if (this.activeStroke.points.length === 2) {
				const localPoint = this.screenToLocal(event.clientX, event.clientY, line);
				const pressure = this.activeStroke.points[1][2];
				this.activeStroke.points[1] = [localPoint.x, localPoint.y, pressure];
				this.renderLiveStroke();
			}
			return;
		}

		const samples = getPointerSamples(event);
		let appended = false;
		for (const sample of samples) {
			const localPoint = this.screenToLocal(sample.clientX, sample.clientY, line);
			const last = this.activeStroke.points[this.activeStroke.points.length - 1];
			if (last) {
				const dx = localPoint.x - last[0];
				const dy = localPoint.y - last[1];
				if (Math.hypot(dx, dy) < MIN_POINT_DISTANCE) continue;
			}
			const rawPressure = this.pressureFor(sample);
			if (sample.pointerType === 'pen' && sample.pressure > 0 && Math.abs(sample.pressure - 0.5) > 0.005) {
				this.activeStroke.hasRealPressure = true;
				this.activeStroke.style.simulatePressure = false;
			}
			const smoothedPressure = this.activeStroke.hasRealPressure
				? this.activeStroke.lastPressure + (rawPressure - this.activeStroke.lastPressure) * 0.55
				: rawPressure;
			this.activeStroke.lastPressure = smoothedPressure;
			this.activeStroke.points.push([localPoint.x, localPoint.y, smoothedPressure]);
			appended = true;
		}
		if (appended) {
			this.renderLiveStroke();
		}
		this.scheduleHoldSnap(event.clientX, event.clientY);
	}

	private onPointerUp(event: PointerEvent): void {
		if (this.touchPan && event.pointerId === this.touchPan.pointerId) {
			event.preventDefault();
			event.stopPropagation();
			try { this.layer.releasePointerCapture?.(event.pointerId); } catch {}
			this.touchPan = null;
			return;
		}

		this.clearHoldSnapTimer();
		if (event.pointerId !== this.activePointerId) {
			if (this.lassoStart) this.finishLasso();
			return;
		}

		if (this.activeEraseSession) {
			const { removed, added } = this.activeEraseSession;
			this.activeEraseSession = null;
			if (removed.length > 0 || added.length > 0) {
				if (added.length > 0) {
					this.undoStack.push({ type: 'replace', removed, added });
				} else {
					this.undoStack.push({ type: 'remove', strokes: removed });
				}
				this.redoStack = [];
				this.emitChange();
			}
		}

		this.transientEraser = false;
		const tool = this.getTool();

		if (tool === 'lasso') {
			this.finishLasso();
			return;
		}

		if (this.activeStroke) {
			const rawPoints = this.activeStroke.points;
			const finalPoints = this.activeStroke.snappedByHold
				? rawPoints
				: (this.options.shapeSnap ? snapStrokePoints(rawPoints, 6) : rawPoints);
			const stroke: MdInkStroke = {
				id: newStrokeId(),
				points: finalPoints,
				style: this.activeStroke.style,
				anchor: {
					line: this.activeStroke.anchorLine,
					lineText: fingerprintLine(this.activeStroke.anchorText),
				},
				offset: { x: 0, y: 0 },
				createdAt: Date.now(),
			};
			this.activeStroke = null;
			this.livePath.setAttribute('d', '');
			this.pushStroke(stroke);
		}

		this.activePointerId = null;
		this.layer.releasePointerCapture?.(event.pointerId);
		this.updateReticle(event.clientX, event.clientY);
	}

	private onPointerCancel(event: PointerEvent): void {
		if (this.touchPan && event.pointerId === this.touchPan.pointerId) {
			try { this.layer.releasePointerCapture?.(event.pointerId); } catch {}
			this.touchPan = null;
			return;
		}
		if (event.pointerId !== this.activePointerId) return;
		this.abortActiveStroke();
	}

	/**
	 * Discard the stroke in progress without committing it.
	 *
	 * Used when a gesture turns into a pinch: the ink drawn during the first
	 * frames of an accidental touch must not survive the zoom.
	 */
	private abortActiveStroke(): void {
		this.touchPan = null;
		this.clearHoldSnapTimer();
		if (this.activePointerId !== null) {
			this.layer.releasePointerCapture?.(this.activePointerId);
		}
		this.activeEraseSession = null;
		this.transientEraser = false;
		this.activeStroke = null;
		this.livePath.setAttribute('d', '');
		this.lassoMode = null;
		this.lassoStart = null;
		this.lassoRect.style.display = 'none';
		this.activePointerId = null;
	}

	private renderLiveStroke(): void {
		if (!this.activeStroke) return;
		const { points, style } = this.activeStroke;
		if (points.length === 1) {
			this.livePath.setAttribute('d', dotPath(points[0][0], points[0][1], style.size / 2));
		} else {
			const outline = getStroke(points, toStrokeOptions(style));
			this.livePath.setAttribute('d', getSvgPathFromStroke(outline));
		}
		this.livePath.setAttribute('fill', style.color || 'currentColor');
		if (style.opacity !== undefined && style.opacity < 1) {
			this.livePath.setAttribute('opacity', String(style.opacity));
		}
		const lineTop = this.lineTopInContent(this.activeStroke.anchorLine) ?? 0;
		this.livePath.setAttribute('transform', `translate(0 ${lineTop})`);
	}

	///////////////////////////
	// Mutations
	///////////////////////////

	private pushStroke(stroke: MdInkStroke): void {
		this.doc.strokes.push(stroke);
		this.undoStack.push({ type: 'add', stroke });
		this.redoStack = [];
		this.emitChange();
		this.requestRender();
		if (this.magicDiaryMode) {
			this.magicPendingStrokeIds.add(stroke.id);
			this.scheduleMagicDiaryTurn();
		}
	}

	private eraseAt(clientX: number, clientY: number): void {
		const radius = this.options.eraserRadius;
		const isPixel = this.options.eraserMode === 'pixel';
		const removed: MdInkStroke[] = [];
		const added: MdInkStroke[] = [];

		const origin = this.contentOrigin();
		const tops = new Map<number, number>();

		for (const stroke of this.doc.strokes) {
			const line = this.lineOf(stroke);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			let top = tops.get(lineNumber);
			if (top === undefined) {
				top = this.lineTopInContent(lineNumber) ?? 0;
				tops.set(lineNumber, top);
			}

			if (!isPixel) {
				const closed = this.strokeLocalPoints(stroke);
				let hit = false;
				for (const [x, y] of closed) {
					const screenX = origin.x + x + stroke.offset.x;
					const screenY = origin.y + top + y + stroke.offset.y;
					if (Math.hypot(screenX - clientX, screenY - clientY) <= radius) {
						hit = true;
						break;
					}
				}
				if (hit) removed.push(stroke);
			} else {
				const rawPoints = stroke.points;
				let anyHit = false;
				const hitFlags = rawPoints.map(([x, y]) => {
					const screenX = origin.x + x + stroke.offset.x;
					const screenY = origin.y + top + y + stroke.offset.y;
					const isHit = Math.hypot(screenX - clientX, screenY - clientY) <= radius;
					if (isHit) anyHit = true;
					return isHit;
				});

				if (!anyHit) continue;

				removed.push(stroke);
				const runs: InkPoint[][] = [];
				let currentRun: InkPoint[] = [];

				for (let i = 0; i < rawPoints.length; i++) {
					if (!hitFlags[i]) {
						currentRun.push(rawPoints[i]);
					} else {
						if (currentRun.length > 0) {
							runs.push(currentRun);
							currentRun = [];
						}
					}
				}
				if (currentRun.length > 0) {
					runs.push(currentRun);
				}

				for (const run of runs) {
					if (run.length >= 1) {
						added.push({
							id: newStrokeId(),
							points: run,
							style: { ...stroke.style },
							anchor: { ...stroke.anchor },
							offset: { ...stroke.offset },
							createdAt: Date.now(),
						});
					}
				}
			}
		}

		if (removed.length === 0 && added.length === 0) return;
		const removedIds = new Set(removed.map((s) => s.id));
		this.doc.strokes = this.doc.strokes.filter((s) => !removedIds.has(s.id));
		if (added.length > 0) {
			this.doc.strokes.push(...added);
		}

		if (this.activeEraseSession) {
			this.activeEraseSession.removed.push(...removed);
			this.activeEraseSession.added.push(...added);
		} else {
			if (added.length > 0) {
				this.undoStack.push({ type: 'replace', removed, added });
			} else {
				this.undoStack.push({ type: 'remove', strokes: removed });
			}
			this.redoStack = [];
		}

		this.emitChange();
		this.requestRender();
	}

	/** Sampled centreline points (including segment midpoints for snapped lines), enough for hit testing. */
	private strokeLocalPoints(stroke: MdInkStroke): Array<[number, number]> {
		const pts = stroke.points.map(([x, y]) => [x, y] as [number, number]);
		if (pts.length === 2) {
			pts.push([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]);
		}
		return pts;
	}

	private finishLasso(): void {
		if (!this.lassoStart || !this.dragStart) return;

		if (this.lassoMode === 'move') {
			const shifts = [];
			for (const stroke of this.doc.strokes) {
				const original = this.dragOrigins.get(stroke.id);
				if (!original) continue;
				if (original.x !== stroke.offset.x || original.y !== stroke.offset.y) {
					shifts.push({ id: stroke.id, from: original, to: { ...stroke.offset } });
				}
			}
			if (shifts.length > 0) {
				this.undoStack.push({ type: 'move', shifts });
				this.redoStack = [];
				this.emitChange();
			}
		} else {
			// The box and the stroke points are both in content coordinates already.
			const rectData = {
				x: parseFloat(this.lassoRect.getAttribute('x') ?? '0'),
				y: parseFloat(this.lassoRect.getAttribute('y') ?? '0'),
				width: parseFloat(this.lassoRect.getAttribute('width') ?? '0'),
				height: parseFloat(this.lassoRect.getAttribute('height') ?? '0'),
			};

			const isClick = rectData.width < 3 && rectData.height < 3;
			this.selectedIds.clear();

			if (!isClick) {
				for (const stroke of this.doc.strokes) {
					const line = this.lineOf(stroke);
					const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
					const top = this.lineTopInContent(lineNumber) ?? 0;
					const points = this.strokeLocalPoints(stroke);
					if (points.length === 0) continue;
					let insideCount = 0;
					for (const [x, y] of points) {
						const localX = x + stroke.offset.x;
						const localY = y + stroke.offset.y + top;
						if (
							localX >= rectData.x
							&& localX <= rectData.x + rectData.width
							&& localY >= rectData.y
							&& localY <= rectData.y + rectData.height
						) {
							insideCount += 1;
						}
					}
					if (insideCount / points.length >= 0.5) {
						this.selectedIds.add(stroke.id);
					}
				}
			}
			this.render();
		}

		this.lassoMode = null;
		this.lassoStart = null;
		this.dragStart = null;
		this.dragOrigins.clear();
		this.lassoRect.style.display = 'none';
		this.activePointerId = null;
		this.syncSelectionBar();
	}

	private computeStrokeIdsBounds(ids: ReadonlySet<string>): { minX: number; minY: number; maxX: number; maxY: number } | null {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let found = false;

		for (const stroke of this.doc.strokes) {
			if (!ids.has(stroke.id)) continue;
			const line = this.lineOf(stroke);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			const top = this.lineTopInContent(lineNumber) ?? 0;
			for (const [px, py] of stroke.points) {
				const lx = px + stroke.offset.x;
				const ly = py + stroke.offset.y + top;
				if (lx < minX) minX = lx;
				if (ly < minY) minY = ly;
				if (lx > maxX) maxX = lx;
				if (ly > maxY) maxY = ly;
				found = true;
			}
		}

		return found ? { minX, minY, maxX, maxY } : null;
	}

	private syncSelectionBar(): void {
		const bar = this.selectionBar;
		if (!bar) return;
		if (!this.enabled || this.selectedIds.size === 0 || this.lassoMode !== null) {
			bar.style.display = 'none';
			return;
		}
		const bounds = this.computeStrokeIdsBounds(this.selectedIds);
		if (!bounds) {
			bar.style.display = 'none';
			return;
		}
		bar.style.display = 'flex';
		const { width: canvasWidth } = this.computeCanvasDimensions();
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const barWidth = 240;
		const clampedLeft = Math.max(8, Math.min(centerX - barWidth / 2, Math.max(8, canvasWidth - barWidth - 8)));
		const minTop = this.magicDiaryMode ? 54 : 10;
		const rawTop = bounds.minY > 52 ? bounds.minY - 42 : bounds.maxY + 12;
		const safeTop = Math.max(minTop, Math.round(rawTop));
		bar.style.left = `${Math.round(clampedLeft)}px`;
		bar.style.top = `${safeTop}px`;
	}

	///////////////////////////
	// Public commands
	///////////////////////////

	recolourSelected(colour: string): boolean {
		if (this.selectedIds.size === 0) return false;
		const changes: Array<{ id: string; fromColor: string; toColor: string }> = [];
		for (const stroke of this.doc.strokes) {
			if (!this.selectedIds.has(stroke.id)) continue;
			if (stroke.style.color === colour) continue;
			changes.push({ id: stroke.id, fromColor: stroke.style.color, toColor: colour });
			stroke.style = { ...stroke.style, color: colour };
		}
		if (changes.length === 0) return false;
		this.undoStack.push({ type: 'restyle', changes });
		this.redoStack = [];
		this.emitChange();
		this.render();
		return true;
	}

	duplicateSelected(): boolean {
		if (this.selectedIds.size === 0) return false;
		const selected = this.doc.strokes.filter((s) => this.selectedIds.has(s.id));
		if (selected.length === 0) return false;
		const added: MdInkStroke[] = [];
		const nextSelected = new Set<string>();
		for (const stroke of selected) {
			const clone: MdInkStroke = {
				id: newStrokeId(),
				points: stroke.points.map((pt) => [...pt] as InkPoint),
				style: { ...stroke.style },
				anchor: { ...stroke.anchor },
				offset: { x: stroke.offset.x + 18, y: stroke.offset.y + 18 },
				createdAt: Date.now(),
			};
			added.push(clone);
			nextSelected.add(clone.id);
		}
		this.doc.strokes.push(...added);
		this.selectedIds = nextSelected;
		this.undoStack.push({ type: 'addMany', strokes: added });
		this.redoStack = [];
		this.emitChange();
		this.render();
		return true;
	}

	async transcribeSelected(): Promise<string | null> {
		if (this.selectedIds.size === 0) return null;
		const provider = normalizeCustomTranscriptionProvider(this.options.getAiSettings?.());
		if (!isCustomTranscriptionProviderUsable(provider)) {
			new Notice(t('Enable a custom API in settings first.'));
			return null;
		}
		try {
			const svg = this.buildSvgForStrokeIds(this.selectedIds, {
				background: '#ffffff',
				defaultInkColour: '#111111',
			});
			const media = await prepareProviderMedia(svg, provider.mediaFormat);
			const transcript = (await requestCustomTranscription({ settings: provider, media })).trim();
			if (!transcript) {
				new Notice(t('Nothing to transcribe'));
				return null;
			}
			await navigator.clipboard?.writeText(transcript);
			new Notice(t('Transcript copied to clipboard'));
			return transcript;
		} catch (error) {
			console.warn('[bimo] selection transcription failed', error);
			new Notice(t('Could not reach the endpoint. Check the settings and the key.'));
			return null;
		}
	}

	deleteSelected(): void {
		if (this.selectedIds.size === 0) return;
		const removed = this.doc.strokes.filter((s) => this.selectedIds.has(s.id));
		this.doc.strokes = this.doc.strokes.filter((s) => !this.selectedIds.has(s.id));
		this.selectedIds.clear();
		this.undoStack.push({ type: 'remove', strokes: removed });
		this.redoStack = [];
		this.emitChange();
		this.render();
	}

	clearAll(): void {
		if (this.doc.strokes.length === 0) return;
		const removed = [...this.doc.strokes];
		this.doc.strokes = [];
		this.selectedIds.clear();
		this.undoStack.push({ type: 'remove', strokes: removed });
		this.redoStack = [];
		this.emitChange();
		this.render();
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(): void {
		const entry = this.undoStack.pop();
		if (!entry) return;
		this.applyUndoEntry(entry, 'undo');
		this.redoStack.push(entry);
		this.emitChange();
		this.render();
	}

	redo(): void {
		const entry = this.redoStack.pop();
		if (!entry) return;
		this.applyUndoEntry(entry, 'redo');
		this.undoStack.push(entry);
		this.emitChange();
		this.render();
	}

	private applyUndoEntry(entry: UndoEntry, direction: 'undo' | 'redo'): void {
		if (entry.type === 'add' || entry.type === 'addMany') {
			const added = entry.type === 'add' ? [entry.stroke] : entry.strokes;
			if (direction === 'undo') {
				const ids = new Set(added.map((s) => s.id));
				this.doc.strokes = this.doc.strokes.filter((s) => !ids.has(s.id));
			} else {
				this.doc.strokes.push(...added);
			}
			return;
		}
		if (entry.type === 'remove') {
			if (direction === 'undo') {
				this.doc.strokes.push(...entry.strokes);
			} else {
				const ids = new Set(entry.strokes.map((s) => s.id));
				this.doc.strokes = this.doc.strokes.filter((s) => !ids.has(s.id));
			}
			return;
		}
		if (entry.type === 'replace') {
			if (direction === 'undo') {
				const addedIds = new Set(entry.added.map((s) => s.id));
				this.doc.strokes = this.doc.strokes.filter((s) => !addedIds.has(s.id));
				this.doc.strokes.push(...entry.removed);
			} else {
				const removedIds = new Set(entry.removed.map((s) => s.id));
				this.doc.strokes = this.doc.strokes.filter((s) => !removedIds.has(s.id));
				this.doc.strokes.push(...entry.added);
			}
			return;
		}
		if (entry.type === 'restyle') {
			for (const change of entry.changes) {
				const stroke = this.doc.strokes.find((s) => s.id === change.id);
				if (stroke) {
					stroke.style = {
						...stroke.style,
						color: direction === 'undo' ? change.fromColor : change.toColor,
					};
				}
			}
			return;
		}
		for (const shift of entry.shifts) {
			const stroke = this.doc.strokes.find((s) => s.id === shift.id);
			if (stroke) stroke.offset = { ...(direction === 'undo' ? shift.from : shift.to) };
		}
	}

	setPaper(paper: MdInkPaper): void {
		this.doc.paper = paper;
		this.options.paper = paper;
		this.emitChange();
		this.render();
	}

	hasInk(): boolean {
		return this.doc.strokes.length > 0;
	}

	///////////////////////////
	// Clipboard and export
	///////////////////////////

	/**
	 * Serialise the lasso selection for the system clipboard.
	 *
	 * Coordinates stay local to each stroke's anchor, and the payload carries the
	 * anchor text and relative line delta (`lineDelta`), so a multi-line selection
	 * pasted into another note preserves its vertical spacing across lines.
	 */
	copySelected(): string | null {
		const selected = this.doc.strokes.filter((stroke) => this.selectedIds.has(stroke.id));
		if (selected.length === 0) return null;

		const resolvedLineNumber = (stroke: MdInkStroke): number => {
			const idx = this.lineOf(stroke);
			return idx !== null ? idx + 1 : stroke.anchor.line;
		};

		// Normalise so the group keeps its internal layout regardless of where the
		// first stroke sat on its line.
		const originX = Math.min(...selected.map((s) => s.offset.x));
		const originY = Math.min(...selected.map((s) => s.offset.y));
		const baseLine = Math.min(...selected.map(resolvedLineNumber));

		return JSON.stringify({
			bimo: 'md-ink',
			version: 1,
			strokes: selected.map((stroke) => ({
				points: stroke.points,
				style: stroke.style,
				anchor: stroke.anchor,
				lineDelta: resolvedLineNumber(stroke) - baseLine,
				offset: { x: stroke.offset.x - originX, y: stroke.offset.y - originY },
			})),
		});
	}

	/** Copy, then remove. Returns the payload so the host can put it on the clipboard. */
	cutSelected(): string | null {
		const payload = this.copySelected();
		if (!payload) return null;
		this.deleteSelected();
		return payload;
	}

	/**
	 * Insert a copied payload at the caret's line.
	 *
	 * The strokes land relative to the line the user is editing now, preserving
	 * any multi-line `lineDelta` spacing between strokes.
	 */
	paste(payload: string): boolean {
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			return false;
		}

		const data = parsed as { bimo?: string; strokes?: Array<Partial<MdInkStroke> & { lineDelta?: number }> };
		if (data.bimo !== 'md-ink' || !Array.isArray(data.strokes) || data.strokes.length === 0) {
			return false;
		}

		const doc = this.view.state.doc;
		const currentLine = doc.lineAt(this.view.state.selection.main.head);
		const totalLines = doc.lines;
		const added: MdInkStroke[] = [];

		for (const raw of data.strokes) {
			if (!Array.isArray(raw.points) || !raw.style) continue;
			const lineDelta = typeof raw.lineDelta === 'number' && Number.isFinite(raw.lineDelta)
				? Math.round(raw.lineDelta)
				: 0;
			const desiredLineNum = currentLine.number + lineDelta;
			const clampedLineNum = Math.min(Math.max(1, desiredLineNum), totalLines);
			const targetLine = doc.line(clampedLineNum);
			const overflowLines = Math.max(0, desiredLineNum - totalLines);
			const baseOffset = raw.offset ?? { x: 0, y: 0 };

			added.push({
				id: newStrokeId(),
				points: raw.points,
				style: raw.style,
				anchor: { line: targetLine.number, lineText: fingerprintLine(targetLine.text) },
				offset: {
					x: baseOffset.x,
					y: baseOffset.y + overflowLines * 24,
				},
				createdAt: Date.now(),
			});
		}

		if (added.length === 0) return false;
		this.doc.strokes.push(...added);
		this.undoStack.push({ type: 'addMany', strokes: added });
		this.redoStack = [];
		this.emitChange();
		this.render();
		return true;
	}

	/** Build a standalone SVG of every stroke, for export or for AI transcription. */
	buildSvg(options?: { background?: string; defaultInkColour?: string }): string {
		const lines = this.docLines();
		const parts: string[] = [];
		let maxY = 0;
		const fallbackColour = options?.defaultInkColour ?? 'currentColor';

		for (const stroke of this.doc.strokes) {
			const line = resolveAnchorLine(lines, stroke.anchor);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			const top = this.lineTopInContent(lineNumber) ?? 0;
			maxY = Math.max(maxY, top + stroke.offset.y);

			const data = getRenderedStrokeData(stroke);
			const opacity = stroke.style.opacity !== undefined && stroke.style.opacity < 1
				? ` opacity="${stroke.style.opacity}"`
				: '';
			const rawColour = stroke.style.color || 'currentColor';
			const fill = rawColour === 'currentColor' ? fallbackColour : rawColour;
			parts.push(
				`<path d="${data.pathD}" fill="${fill}"${opacity} transform="translate(${stroke.offset.x} ${top + stroke.offset.y})"/>`,
			);
		}

		const width = Math.max(this.view.contentDOM.scrollWidth, 320);
		const height = Math.max(Math.ceil(maxY) + 120, this.view.contentDOM.scrollHeight, 200);
		const bgRect = options?.background
			? `<rect width="100%" height="100%" fill="${options.background}"/>`
			: null;

		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
			'<style>path{stroke:none}</style>',
			...(bgRect ? [bgRect] : []),
			...parts,
			'</svg>',
		].join('\n');
	}

	/** Build a tightly cropped standalone SVG for a specific subset of stroke IDs. */
	buildSvgForStrokeIds(
		ids: ReadonlySet<string>,
		options?: { background?: string; defaultInkColour?: string },
	): string {
		const bounds = this.computeStrokeIdsBounds(ids);
		if (!bounds) return this.buildSvg(options);
		const pad = 24;
		const minX = Math.floor(bounds.minX - pad);
		const minY = Math.floor(bounds.minY - pad);
		const width = Math.max(120, Math.ceil(bounds.maxX - bounds.minX + pad * 2));
		const height = Math.max(80, Math.ceil(bounds.maxY - bounds.minY + pad * 2));
		const lines = this.docLines();
		const fallbackColour = options?.defaultInkColour ?? '#111111';
		const parts: string[] = [];

		for (const stroke of this.doc.strokes) {
			if (!ids.has(stroke.id)) continue;
			const line = resolveAnchorLine(lines, stroke.anchor);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			const top = this.lineTopInContent(lineNumber) ?? 0;
			const data = getRenderedStrokeData(stroke);
			const opacity = stroke.style.opacity !== undefined && stroke.style.opacity < 1
				? ` opacity="${stroke.style.opacity}"`
				: '';
			const rawColour = stroke.style.color || 'currentColor';
			const fill = rawColour === 'currentColor' ? fallbackColour : rawColour;
			parts.push(
				`<path d="${data.pathD}" fill="${fill}"${opacity} transform="translate(${stroke.offset.x - minX} ${top + stroke.offset.y - minY})"/>`,
			);
		}

		const bgRect = options?.background
			? `<rect width="100%" height="100%" fill="${options.background}"/>`
			: null;

		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
			'<style>path{stroke:none}</style>',
			...(bgRect ? [bgRect] : []),
			...parts,
			'</svg>',
		].join('\n');
	}

	///////////////////////////
	// Magic Diary Page ("魔法书页 · 你写一句，AI写一句")
	///////////////////////////

	private checkMagicFrontmatter(): void {
		if (this.magicAutoChecked) return;
		const raw = this.view.state.doc.toString();
		if (!raw) return;
		this.magicAutoChecked = true;
		if (hasMagicDiaryFrontmatter(raw) && !this.magicDiaryMode) {
			this.setMagicDiaryMode(true, { silent: true });
		}
	}

	isMagicDiaryMode(): boolean {
		return this.magicDiaryMode;
	}

	setMagicDiaryMode(active: boolean, opts?: { silent?: boolean }): void {
		this.magicDiaryMode = active;
		this.layer.dataset.magicDiary = active ? 'true' : 'false';
		this.scrollerEl.classList.toggle('bimo-magic-diary-active', active);
		this.magicBtn?.classList.toggle('is-active', active);

		if (this.magicBannerEl) {
			this.magicBannerEl.style.display = active ? 'flex' : 'none';
		}
		if (this.magicRepliesContainer) {
			this.magicRepliesContainer.style.display = active ? 'block' : 'none';
		}

		if (active) {
			if (this.getTool() === 'pan') {
				this.options.onToolSelected?.('pen');
				this.setTool('pen');
			}
			if (this.options.paper === 'none') {
				this.previousPaperBeforeMagic = 'none';
				this.setPaper('ruled');
			}
			if (this.magicStatusEl) {
				this.magicStatusEl.textContent = t('Magic Diary Page · Write a line and pause; the page will answer');
			}
			if (!opts?.silent) {
				new Notice(t('✦ Magic Diary Page awakened — write a line and pause; the page will answer.'));
			}
		} else {
			this.clearMagicPauseTimer();
			this.magicPendingStrokeIds.clear();
			this.magicReadingStrokeIds.clear();
			if (this.previousPaperBeforeMagic !== null) {
				this.setPaper(this.previousPaperBeforeMagic);
				this.previousPaperBeforeMagic = null;
			}
			if (!opts?.silent) {
				new Notice(t('Magic Diary Page closed.'));
			}
		}
		this.render();
	}

	private clearMagicPauseTimer(): void {
		if (this.magicPauseTimer !== null) {
			clearTimeout(this.magicPauseTimer);
			this.magicPauseTimer = null;
		}
	}

	private scheduleMagicDiaryTurn(): void {
		this.clearMagicPauseTimer();
		if (!this.magicAutoRespond) return;
		if (this.magicStatusEl) {
			this.magicStatusEl.textContent = t('Listening to your handwriting…');
		}
		const idleMs = Math.max(3000, this.options.magicIdleMs ?? 3500);
		this.magicPauseTimer = setTimeout(() => {
			this.magicPauseTimer = null;
			void this.triggerMagicDiaryTurn(false);
		}, idleMs);
	}

	async triggerMagicDiaryTurn(manual = false): Promise<void> {
		if (this.destroyed || !this.magicDiaryMode) return;
		this.clearMagicPauseTimer();

		let targetIds = new Set(this.magicPendingStrokeIds);
		if (targetIds.size === 0 && manual && this.doc.strokes.length > 0) {
			const recent = this.doc.strokes.slice(-8);
			targetIds = new Set(recent.map((s) => s.id));
		}
		if (targetIds.size === 0) return;

		this.magicPendingStrokeIds.clear();
		for (const id of targetIds) this.magicReadingStrokeIds.add(id);
		if (this.magicStatusEl) {
			this.magicStatusEl.textContent = t('The page is absorbing your ink…');
		}
		this.renderStrokes();

		const bounds = this.computeStrokeIdsBounds(targetIds) ?? {
			minX: 36,
			minY: 48,
			maxX: 280,
			maxY: Math.max(96, this.maxStrokeBottomY()),
		};

		try {
			const svg = this.buildSvgForStrokeIds(targetIds, {
				background: '#fbf6e9',
				defaultInkColour: '#2c1e14',
			});
			const result = await requestMagicDiaryTurn({
				svg,
				rawSettings: this.options.getAiSettings?.(),
				history: this.magicHistory,
				preset: this.options.magicPreset,
				customPrompt: this.options.magicCustomPrompt,
			});
			if (this.destroyed) return;

			for (const id of targetIds) this.magicReadingStrokeIds.delete(id);
			this.renderStrokes();

			if (!result.reply) {
				if (this.magicStatusEl) {
					this.magicStatusEl.textContent = t('Magic Diary Page · Write a line and pause; the page will answer');
				}
				return;
			}

			this.magicHistory.push(
				{ role: 'user', text: result.heard || '(handwritten ink)' },
				{ role: 'assistant', text: result.reply },
			);
			this.appendMagicReplyCard(result.heard, result.reply, bounds);
			if (this.magicStatusEl) {
				this.magicStatusEl.textContent = t('✦ Your turn — write the next line below');
			}
		} catch (error) {
			console.warn('[bimo] magic diary turn failed', error);
			for (const id of targetIds) this.magicReadingStrokeIds.delete(id);
			this.renderStrokes();
			if (this.magicStatusEl) {
				this.magicStatusEl.textContent = t('The ink faded before reaching the spirit — check AI settings');
			}
		}
	}

	private appendMagicReplyCard(
		heard: string,
		reply: string,
		bounds: { minX: number; minY: number; maxX: number; maxY: number },
	): void {
		const container = this.magicRepliesContainer;
		if (!container) return;

		const { width: canvasWidth } = this.computeCanvasDimensions();
		const top = Math.max(Math.round(bounds.maxY + 16), this.magicMaxReplyBottomY + 12, 54);
		const left = Math.max(20, Math.min(Math.round(bounds.minX), Math.max(20, canvasWidth - 440)));

		const card = document.createElement('div');
		card.className = 'bimo-magic-diary-reply';
		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
		card.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'pen' && !(e.target as HTMLElement)?.closest('button, select, a, input')) {
				return;
			}
			e.stopPropagation();
		});
		card.addEventListener('click', (e) => {
			if (!(e.target as HTMLElement)?.closest('button, select, a, input')) {
				return;
			}
			e.stopPropagation();
		});

		const headerEl = document.createElement('div');
		headerEl.className = 'bimo-magic-diary-reply__header';

		if (heard) {
			const heardEl = document.createElement('div');
			heardEl.className = 'bimo-magic-diary-reply__heard';
			heardEl.textContent = `“${heard}”`;
			headerEl.appendChild(heardEl);
		} else {
			const crest = document.createElement('div');
			crest.className = 'bimo-magic-diary-reply__heard';
			crest.textContent = '✦ 魔法回应';
			headerEl.appendChild(crest);
		}

		const collapseBtn = document.createElement('button');
		collapseBtn.type = 'button';
		collapseBtn.className = 'bimo-magic-diary-reply__action bimo-magic-diary-reply__action--collapse';
		collapseBtn.textContent = '−';
		collapseBtn.title = t('Collapse reply');
		collapseBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const collapsed = card.classList.toggle('is-collapsed');
			collapseBtn.textContent = collapsed ? '+' : '−';
			collapseBtn.title = collapsed ? t('Expand reply') : t('Collapse reply');
		});
		headerEl.appendChild(collapseBtn);
		card.appendChild(headerEl);

		const bodyEl = document.createElement('div');
		bodyEl.className = 'bimo-magic-diary-reply__body';
		card.appendChild(bodyEl);

		const footerEl = document.createElement('div');
		footerEl.className = 'bimo-magic-diary-reply__footer';

		const insertBtn = document.createElement('button');
		insertBtn.type = 'button';
		insertBtn.className = 'bimo-magic-diary-reply__action';
		insertBtn.textContent = t('Inscribe into note');
		insertBtn.title = t('Append this exchange as Markdown text into the note');
		insertBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const doc = this.view.state.doc;
			const prefix = doc.length > 0 ? '\n\n' : '';
			const block = heard
				? `${prefix}> 🖋️ ${heard}\n>\n> ✦ *${reply}*`
				: `${prefix}> ✦ *${reply}*`;
			this.view.dispatch({
				changes: { from: doc.length, insert: block },
			});
			new Notice(t('Exchange inscribed into the note.'));
		});

		const dismissBtn = document.createElement('button');
		dismissBtn.type = 'button';
		dismissBtn.className = 'bimo-magic-diary-reply__action bimo-magic-diary-reply__action--dismiss';
		dismissBtn.textContent = '×';
		dismissBtn.title = t('Fade this reply');
		dismissBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			card.remove();
		});

		footerEl.append(insertBtn, dismissBtn);
		card.appendChild(footerEl);
		container.appendChild(card);

		this.magicMaxReplyBottomY = Math.max(this.magicMaxReplyBottomY, top + 100);
		this.syncLayerSize();
		this.renderPaper();

		// Typewriter / ink-bleed calligraphic reveal
		const chars = Array.from(reply);
		let idx = 0;
		const stepMs = Math.max(12, Math.min(32, Math.floor(900 / Math.max(chars.length, 1))));

		const finishReveal = () => {
			if (this.destroyed || !card.isConnected) return;
			this.renderReplyMarkdown(bodyEl, reply);
		};

		const tick = () => {
			if (this.destroyed || !card.isConnected) return;
			idx = Math.min(chars.length, idx + 1);
			bodyEl.textContent = chars.slice(0, idx).join('');
			if (idx < chars.length) {
				window.setTimeout(tick, stepMs);
			} else {
				finishReveal();
			}
		};

		card.addEventListener('click', (e) => {
			if (idx < chars.length) {
				e.preventDefault();
				e.stopPropagation();
				idx = chars.length;
				finishReveal();
			}
		});

		tick();
	}

	private renderReplyMarkdown(targetEl: HTMLElement, markdown: string): void {
		try {
			const app = (this.view as any)?.app ?? getGlobals().plugin.app;
			targetEl.empty();
			void MarkdownRenderer.render(app, markdown, targetEl, '', this.component);
		} catch {
			targetEl.textContent = markdown;
		}
	}

	clearMagicReplies(): void {
		this.magicRepliesContainer?.replaceChildren();
		this.magicHistory = [];
		this.magicMaxReplyBottomY = 0;
		if (this.magicStatusEl) {
			this.magicStatusEl.textContent = t('Magic Diary Page · Write a line and pause; the page will answer');
		}
		this.render();
	}

	private emitChange(): void {
		this.doc.updatedAt = Date.now();
		this.syncUndoRedoButtons();
		this.options.onChange?.(this.doc);
	}
}
