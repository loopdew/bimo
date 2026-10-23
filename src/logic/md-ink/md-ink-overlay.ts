import { getStroke } from 'perfect-freehand';
import { Notice, setIcon } from 'obsidian';
import { t } from 'src/i18n';
import type { EditorView } from '@codemirror/view';
import type { InkBrushKind } from 'src/ink-canvas/brush-presets';
import { resolveBrushPreset } from 'src/ink-canvas/brush-presets';
import { getRenderedStrokeData } from 'src/ink-canvas/rendered-stroke-cache';
import type { InkPoint, InkStrokeStyle } from 'src/ink-canvas/types';
import { toStrokeOptions } from 'src/ink-canvas/types';
import { getSvgPathFromStroke } from 'src/ink-canvas/utils/svg-path-from-stroke';
import { attachPillDrag, type PillDragHandle } from './pill-drag';
import {
	createEmptyMdInkDocument,
	dotPath,
	fingerprintLine,
	mergeMdInkDocuments,
	resolveAnchorLine,
	resolvePaperStyle,
	snapStrokePoints,
	type MdInkDocument,
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
	paper: MdInkPaper;
	/** Eraser radius in CSS px. */
	eraserRadius: number;
	/** Straighten lines and close rectangles when the stroke clearly meant one. */
	shapeSnap: boolean;
	/** Called after any mutation so the host can schedule a save. */
	onChange?: (doc: MdInkDocument) => void;
	/** A tool was picked from the floating pill; hosts propagate it to other notes. */
	onToolSelected?: (tool: MdInkTool) => void;
}

type UndoEntry =
	| { type: 'add'; stroke: MdInkStroke }
	| { type: 'addMany'; strokes: MdInkStroke[] }
	| { type: 'remove'; strokes: MdInkStroke[] }
	| { type: 'move'; shifts: Array<{ id: string; from: { x: number; y: number }; to: { x: number; y: number } }> };

interface ActiveStroke {
	points: InkPoint[];
	style: InkStrokeStyle;
	anchorLine: number;
	anchorText: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER_CLASS = 'bimo-md-ink-layer';
const MIN_POINT_DISTANCE = 1.1;
/** Where the dragged pill position lives; one preference for every note. */
const PILL_POSITION_KEY = 'bimo-md-ink-pill-position';

let strokeCounter = 0;
function newStrokeId(): string {
	strokeCounter += 1;
	return `md_${Date.now().toString(36)}_${strokeCounter}`;
}

export class MdInkOverlay {
	private readonly view: EditorView;
	private readonly notePath: string;
	private options: MdInkOverlayOptions;

	private layer!: HTMLDivElement;
	private pill!: HTMLDivElement;
	private pillDrag: PillDragHandle | null = null;
	private svg!: SVGSVGElement;
	private paperGroup!: SVGGElement;
	private strokeGroup!: SVGGElement;
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

	private activeStroke: ActiveStroke | null = null;
	private activePointerId: number | null = null;

	private undoStack: UndoEntry[] = [];
	private redoStack: UndoEntry[] = [];

	private selectedIds = new Set<string>();
	private lassoStart: { x: number; y: number } | null = null;
	private dragStart: { x: number; y: number } | null = null;
	private dragOrigins = new Map<string, { x: number; y: number }>();
	private panStart: { scrollTop: number; scrollLeft: number; clientY: number; clientX: number } | null = null;

	private renderQueued = false;
	private destroyed = false;
	private readonly disposers: Array<() => void> = [];
	private linesCache: { doc: unknown; lines: string[] } | null = null;

	constructor(view: EditorView, notePath: string, options: MdInkOverlayOptions, initial?: MdInkDocument) {
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

		this.paperGroup = document.createElementNS(SVG_NS, 'g');
		this.paperGroup.setAttribute('class', 'bimo-md-ink-paper');

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
		scroller.appendChild(this.layer);

		this.createPill();
		this.bindPointerEvents();
		this.bindKeyboard();
		this.applyToolCursor();
		this.render();
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

		const toolButtons: Array<{ tool: MdInkTool; icon: string; label: string }> = [
			{ tool: 'pen', icon: 'pencil', label: 'Pen' },
			{ tool: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
			{ tool: 'eraser', icon: 'eraser', label: 'Eraser' },
			{ tool: 'lasso', icon: 'lasso', label: 'Lasso' },
			{ tool: 'pan', icon: 'hand', label: 'Pan' },
		];

		for (const { tool, icon, label } of toolButtons) {
			const button = document.createElement('button');
			button.type = 'button';
			button.title = label;
			setIcon(button, icon);
			button.dataset.mdInkTool = tool;
			button.addEventListener('pointerdown', (event) => {
				// The pill sits above the scroller; without this the editor steals
				// the press and the click never lands.
				event.stopPropagation();
			});
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.options.onToolSelected?.(tool);
				this.setTool(tool);
			});
			this.pill.appendChild(button);
		}

		const gap = document.createElement('span');
		gap.className = 'bimo-md-ink-pill__gap';
		this.pill.appendChild(gap);

		const undo = document.createElement('button');
		undo.type = 'button';
		setIcon(undo, 'undo-2');
		undo.title = 'Undo stroke';
		undo.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.undo();
		});
		this.pill.appendChild(undo);

		const clear = document.createElement('button');
		clear.type = 'button';
		setIcon(clear, 'trash-2');
		clear.title = 'Clear ink on this note';
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
			this.pillDrag?.destroy();
			this.pillDrag = null;
			this.pill.remove();
		});
		this.bindPillDrag();
		this.syncPill();
		this.syncPillColour();
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
	}

	destroy(): void {
		this.destroyed = true;
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.layer.remove();
	}

	/** Re-read settings after the user changes one. */
	setOptions(patch: Partial<MdInkOverlayOptions>): void {
		this.options = { ...this.options, ...patch };
		this.applyToolCursor();
		if (patch.colour !== undefined) this.syncPillColour();
		if (patch.paper !== undefined) this.render();
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
		const pos = this.view.posAtCoords({ x: clientX, y: clientY }, false);
		const resolved = pos ?? this.view.state.selection.main.head;
		return this.view.state.doc.lineAt(resolved).number;
	}

	/** Top edge of a line in content coordinates, or null when the line is gone. */
	private lineTopInContent(lineNumber: number): number | null {
		const total = this.view.state.doc.lines;
		if (lineNumber < 1 || lineNumber > total) return null;
		const lineFrom = this.view.state.doc.line(lineNumber).from;
		const coords = this.view.coordsAtPos(lineFrom);
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
		this.renderPaper();
		this.renderStrokes();
		this.syncLayerSize();
	}

	private syncLayerSize(): void {
		const content = this.view.contentDOM;
		const scroller = this.scrollerEl;
		this.layer.style.width = `${content.scrollWidth}px`;
		this.layer.style.height = `${content.scrollHeight}px`;

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
		group.replaceChildren();

		const lineTops = new Map<number, number>();

		for (const stroke of this.doc.strokes) {
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
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', pathData);
			path.setAttribute('fill', stroke.style.color || 'currentColor');
			if (stroke.style.opacity !== undefined && stroke.style.opacity < 1) {
				path.setAttribute('opacity', String(stroke.style.opacity));
			}
			if (this.selectedIds.has(stroke.id)) {
				path.classList.add('is-selected');
			}
			path.setAttribute(
				'transform',
				`translate(${stroke.offset.x} ${top + stroke.offset.y})`,
			);
			path.dataset.strokeId = stroke.id;
			group.appendChild(path);
		}
	}

	private renderPaper(): void {
		this.paperGroup.replaceChildren();
		const paper = this.options.paper;
		if (paper === 'none') return;

		const content = this.view.contentDOM;
		const width = Math.max(content.scrollWidth, content.clientWidth);
		const height = Math.max(content.scrollHeight, content.clientHeight);
		const spacing = 24;

		const fragment = document.createDocumentFragment();
		if (paper === 'ruled' || paper === 'grid') {
			for (let y = spacing; y < height; y += spacing) {
				const line = document.createElementNS(SVG_NS, 'line');
				line.setAttribute('x1', '0');
				line.setAttribute('x2', String(width));
				line.setAttribute('y1', String(y));
				line.setAttribute('y2', String(y));
				line.setAttribute('class', 'bimo-md-ink-paper-line');
				fragment.appendChild(line);
			}
		}
		if (paper === 'grid') {
			for (let x = spacing; x < width; x += spacing) {
				const line = document.createElementNS(SVG_NS, 'line');
				line.setAttribute('x1', String(x));
				line.setAttribute('x2', String(x));
				line.setAttribute('y1', '0');
				line.setAttribute('y2', String(height));
				line.setAttribute('class', 'bimo-md-ink-paper-line');
				fragment.appendChild(line);
			}
		}
		if (paper === 'dots') {
			for (let y = spacing; y < height; y += spacing) {
				for (let x = spacing; x < width; x += spacing) {
					const dot = document.createElementNS(SVG_NS, 'circle');
					dot.setAttribute('cx', String(x));
					dot.setAttribute('cy', String(y));
					dot.setAttribute('r', '1');
					dot.setAttribute('class', 'bimo-md-ink-paper-dot');
					fragment.appendChild(dot);
				}
			}
		}
		this.paperGroup.appendChild(fragment);
	}

	///////////////////////////
	// Input
	///////////////////////////

	private bindPointerEvents(): void {
		const down = (event: PointerEvent) => this.onPointerDown(event);
		const move = (event: PointerEvent) => this.onPointerMove(event);
		const up = (event: PointerEvent) => this.onPointerUp(event);
		const cancel = (event: PointerEvent) => this.onPointerCancel(event);

		this.layer.addEventListener('pointerdown', down);
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);

		this.disposers.push(() => {
			this.layer.removeEventListener('pointerdown', down);
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
		this.layer.style.pointerEvents = tool === 'pan' ? 'none' : 'auto';
		this.layer.dataset.tool = tool;
		this.syncPill();
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 && event.button !== 5) return;
		if (this.getTool() === 'pan') return;
		if (event.pointerType === 'mouse' && !this.options.mouseDrawing && this.getTool() !== 'lasso') {
			explainMouseDrawingDisabled();
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.activePointerId = event.pointerId;
		this.layer.setPointerCapture?.(event.pointerId);

		const tool = this.getTool();
		const origin = this.contentOrigin();
		const local = { x: event.clientX - origin.x, y: event.clientY - origin.y };

		if (tool === 'lasso') {
			this.lassoStart = local;
			this.dragStart = local;
			this.lassoRect.style.display = '';
			this.lassoRect.setAttribute('x', String(local.x));
			this.lassoRect.setAttribute('y', String(local.y));
			this.lassoRect.setAttribute('width', '0');
			this.lassoRect.setAttribute('height', '0');

			if (this.selectedIds.size > 0) {
				this.dragOrigins.clear();
				for (const stroke of this.doc.strokes) {
					if (this.selectedIds.has(stroke.id)) {
						this.dragOrigins.set(stroke.id, { ...stroke.offset });
					}
				}
			}
			return;
		}

		if (tool === 'eraser') {
			this.eraseAt(event.clientX, event.clientY);
			return;
		}

		// pen / highlighter
		const line = this.lineAtScreen(event.clientX, event.clientY);
		const lineText = this.view.state.doc.line(line).text;
		const localPoint = this.screenToLocal(event.clientX, event.clientY, line);

		this.activeStroke = {
			points: [[localPoint.x, localPoint.y, this.pressureFor(event)]],
			style: this.buildStyle(this.options.brush),
			anchorLine: line,
			anchorText: lineText,
		};
		this.renderLiveStroke();
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
		if (tool === 'eraser') return this.options.eraserRadius;
		if (tool === 'lasso') return 4;
		const preset = resolveBrushPreset(this.options.brush);
		return Math.max(2, (this.options.size * preset.sizeMultiplier) / 2);
	}

	private onPointerMove(event: PointerEvent): void {
		this.updateReticle(event.clientX, event.clientY);

		const tool = this.getTool();

		if (tool === 'lasso' && this.lassoStart) {
			const origin = this.contentOrigin();
			const local = { x: event.clientX - origin.x, y: event.clientY - origin.y };
			const x = Math.min(this.lassoStart.x, local.x);
			const y = Math.min(this.lassoStart.y, local.y);
			const width = Math.abs(local.x - this.lassoStart.x);
			const height = Math.abs(local.y - this.lassoStart.y);
			this.lassoRect.setAttribute('x', String(x));
			this.lassoRect.setAttribute('y', String(y));
			this.lassoRect.setAttribute('width', String(width));
			this.lassoRect.setAttribute('height', String(height));

			// Dragging an existing selection moves it instead of starting a new box.
			if (this.selectedIds.size > 0 && this.dragOrigins.size > 0) {
				const dx = local.x - (this.dragStart?.x ?? local.x);
				const dy = local.y - (this.dragStart?.y ?? local.y);
				for (const stroke of this.doc.strokes) {
					const original = this.dragOrigins.get(stroke.id);
					if (!original) continue;
					stroke.offset = { x: original.x + dx, y: original.y + dy };
				}
				this.requestRender();
			}
			return;
		}

		if (tool === 'eraser' && this.activePointerId !== null) {
			this.eraseAt(event.clientX, event.clientY);
			return;
		}

		if (!this.activeStroke) return;
		if (event.pointerId !== this.activePointerId) return;

		const line = this.activeStroke.anchorLine;
		const localPoint = this.screenToLocal(event.clientX, event.clientY, line);
		const last = this.activeStroke.points[this.activeStroke.points.length - 1];
		if (last) {
			const dx = localPoint.x - last[0];
			const dy = localPoint.y - last[1];
			if (Math.hypot(dx, dy) < MIN_POINT_DISTANCE) return;
		}
		this.activeStroke.points.push([localPoint.x, localPoint.y, this.pressureFor(event)]);
		this.renderLiveStroke();
	}

	private onPointerUp(event: PointerEvent): void {
		if (event.pointerId !== this.activePointerId) {
			if (this.lassoStart) this.finishLasso();
			return;
		}

		const tool = this.getTool();

		if (tool === 'lasso') {
			this.finishLasso();
			return;
		}

		if (this.activeStroke) {
			const rawPoints = this.activeStroke.points;
			const stroke: MdInkStroke = {
				id: newStrokeId(),
				points: this.options.shapeSnap ? snapStrokePoints(rawPoints, 6) : rawPoints,
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
		if (event.pointerId !== this.activePointerId) return;
		this.activeStroke = null;
		this.livePath.setAttribute('d', '');
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
	}

	private eraseAt(clientX: number, clientY: number): void {
		const radius = this.options.eraserRadius;
		const removed: MdInkStroke[] = [];

		// Read layout once. This runs on every pointermove while the eraser is
		// down, and the previous shape asked for the origin and the line top once
		// per stroke — two forced reflows per stroke, per event.
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
		}

		if (removed.length === 0) return;
		const removedIds = new Set(removed.map((s) => s.id));
		this.doc.strokes = this.doc.strokes.filter((s) => !removedIds.has(s.id));
		this.undoStack.push({ type: 'remove', strokes: removed });
		this.redoStack = [];
		this.emitChange();
		this.requestRender();
	}

	/** Sampled centreline points, enough for hit testing. */
	private strokeLocalPoints(stroke: MdInkStroke): Array<[number, number]> {
		return stroke.points.map(([x, y]) => [x, y] as [number, number]);
	}

	private finishLasso(): void {
		if (!this.lassoStart || !this.dragStart) return;

		// The box and the stroke points are both in content coordinates already.
		const rectData = {
			x: parseFloat(this.lassoRect.getAttribute('x') ?? '0'),
			y: parseFloat(this.lassoRect.getAttribute('y') ?? '0'),
			width: parseFloat(this.lassoRect.getAttribute('width') ?? '0'),
			height: parseFloat(this.lassoRect.getAttribute('height') ?? '0'),
		};

		const isClick = rectData.width < 3 && rectData.height < 3 && this.selectedIds.size === 0;
		const isMoveDrag = this.selectedIds.size > 0 && this.dragOrigins.size > 0;

		if (isMoveDrag) {
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
		} else if (!isClick) {
			// Box selection: a stroke is selected when its whole centreline is inside.
			this.selectedIds.clear();
			for (const stroke of this.doc.strokes) {
				const line = this.lineOf(stroke);
				const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
				const top = this.lineTopInContent(lineNumber) ?? 0;
				const points = this.strokeLocalPoints(stroke);
				const inside = points.every(([x, y]) => {
					const localX = x + stroke.offset.x;
					const localY = y + stroke.offset.y + top;
					return localX >= rectData.x
						&& localX <= rectData.x + rectData.width
						&& localY >= rectData.y
						&& localY <= rectData.y + rectData.height;
				});
				if (inside) this.selectedIds.add(stroke.id);
			}
			this.render();
		} else {
			this.selectedIds.clear();
			this.render();
		}

		this.lassoStart = null;
		this.dragStart = null;
		this.dragOrigins.clear();
		this.lassoRect.style.display = 'none';
		this.activePointerId = null;
	}

	///////////////////////////
	// Public commands
	///////////////////////////

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
	 * anchor text, so a paste into another note can re-anchor instead of dumping
	 * a diagram at line 1.
	 */
	copySelected(): string | null {
		const selected = this.doc.strokes.filter((stroke) => this.selectedIds.has(stroke.id));
		if (selected.length === 0) return null;

		// Normalise so the group keeps its internal layout regardless of where the
		// first stroke sat on its line.
		const originX = Math.min(...selected.map((s) => s.offset.x));
		const originY = Math.min(...selected.map((s) => s.offset.y));

		return JSON.stringify({
			bimo: 'md-ink',
			version: 1,
			strokes: selected.map((stroke) => ({
				points: stroke.points,
				style: stroke.style,
				anchor: stroke.anchor,
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
	 * The strokes land on the line the user is editing now, not on the line they
	 * were copied from — that is the whole point of pasting into another note.
	 */
	paste(payload: string): boolean {
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			return false;
		}

		const data = parsed as { bimo?: string; strokes?: Array<Partial<MdInkStroke>> };
		if (data.bimo !== 'md-ink' || !Array.isArray(data.strokes) || data.strokes.length === 0) {
			return false;
		}

		const currentLine = this.view.state.doc.lineAt(this.view.state.selection.main.head);
		const added: MdInkStroke[] = [];

		for (const raw of data.strokes) {
			if (!Array.isArray(raw.points) || !raw.style) continue;
			added.push({
				id: newStrokeId(),
				points: raw.points,
				style: raw.style,
				anchor: { line: currentLine.number, lineText: fingerprintLine(currentLine.text) },
				offset: raw.offset ?? { x: 0, y: 0 },
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

	/** Build a standalone SVG of every stroke, for export or for embedding. */
	buildSvg(): string {
		const lines = this.docLines();
		const parts: string[] = [];
		let maxY = 0;

		for (const stroke of this.doc.strokes) {
			const line = resolveAnchorLine(lines, stroke.anchor);
			const lineNumber = line !== null ? line + 1 : stroke.anchor.line;
			const top = this.lineTopInContent(lineNumber) ?? 0;
			maxY = Math.max(maxY, top + stroke.offset.y);

			const data = getRenderedStrokeData(stroke);
			const opacity = stroke.style.opacity !== undefined && stroke.style.opacity < 1
				? ` opacity="${stroke.style.opacity}"`
				: '';
			parts.push(
				`<path d="${data.pathD}" fill="${stroke.style.color || 'currentColor'}"${opacity} transform="translate(${stroke.offset.x} ${top + stroke.offset.y})"/>`,
			);
		}

		const width = Math.max(this.view.contentDOM.scrollWidth, 320);
		const height = Math.max(Math.ceil(maxY) + 120, this.view.contentDOM.scrollHeight, 200);

		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
			'<style>path{stroke:none}</style>',
			...parts,
			'</svg>',
		].join('\n');
	}

	private emitChange(): void {
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
	}
}
