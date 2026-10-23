import { getStroke } from 'perfect-freehand';
import type { App } from 'obsidian';
import type { InkBrushKind } from 'src/ink-canvas/brush-presets';
import { resolveBrushPreset } from 'src/ink-canvas/brush-presets';
import { getRenderedStrokeData } from 'src/ink-canvas/rendered-stroke-cache';
import type { InkPoint, InkStroke, InkStrokeStyle } from 'src/ink-canvas/types';
import { toStrokeOptions } from 'src/ink-canvas/types';
import { getPointerSamples } from 'src/ink-canvas/utils/pointer-samples';
import { getSvgPathFromStroke } from 'src/ink-canvas/utils/svg-path-from-stroke';
import { explainMouseDrawingDisabled } from './md-ink-overlay';
import {
	createEmptyPdfInkDocument,
	fromPageSpace,
	toPageSpace,
	type PdfInkDocument,
	type PdfInkStroke,
} from './pdf-ink-types';
import {
	dotPath,
	HOLD_TO_SNAP_DELAY_MS,
	HOLD_TO_SNAP_TOLERANCE,
	snapStrokePoints,
} from './types';
import { attachTouchTapUndo, type TouchTapUndoHandle } from './touch-tap-undo';

///////////////////////////
///////////////////////////

/**
 * 笔墨 on the pages of Obsidian's PDF viewer.
 *
 * The viewer renders pages lazily and re-renders them on zoom, so this attaches
 * to whatever `[data-page-number]` boxes currently exist and repaints on every
 * layout change. Strokes are stored in page-relative coordinates, which is what
 * makes a zoom survive: the same stroke is re-projected onto the new page box.
 *
 * Nothing is written into the PDF. The ink is a layer, exactly like on a note.
 */

export interface PdfInkOverlayOptions {
	brush: InkBrushKind;
	size: number;
	colour: string;
	mouseDrawing: boolean;
	/**
	 * A finger draws too. Off (default) leaves one-finger drag scrolling the PDF
	 * and reserves drawing for a stylus.
	 */
	fingerDraws: boolean;
	eraserMode?: 'stroke' | 'pixel';
	eraserRadius: number;
	shapeSnap: boolean;
	tool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'pan';
	onChange?: (doc: PdfInkDocument) => void;
}

type PdfUndoEntry =
	| { type: 'add'; stroke: PdfInkStroke }
	| { type: 'remove'; strokes: PdfInkStroke[] }
	| { type: 'replace'; removed: PdfInkStroke[]; added: PdfInkStroke[] }
	| { type: 'move'; moves: Array<{ id: string; from: InkPoint[]; to: InkPoint[] }> }
	| { type: 'restyle'; changes: Array<{ id: string; fromColor: string; toColor: string }> };

interface PageLayer {
	pageEl: HTMLElement;
	svg: SVGSVGElement;
	pageNumber: number;
	reticle: SVGCircleElement;
	lassoRect: SVGRectElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOLD_SNAP_JITTER_PX = 3;

let pdfStrokeCounter = 0;
function newPdfStrokeId(): string {
	pdfStrokeCounter += 1;
	return `pdf_${Date.now().toString(36)}_${pdfStrokeCounter}`;
}

export class PdfInkOverlay {
	private doc: PdfInkDocument;
	private options: PdfInkOverlayOptions;
	private readonly layers = new Map<number, PageLayer>();
	private observer: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private keyHandler: ((event: KeyboardEvent) => void) | null = null;
	private touchTapUndo: TouchTapUndoHandle | null = null;
	private scanQueued = false;
	private destroyed = false;

	private activePointerId: number | null = null;
	private transientEraser = false;
	private holdSnapTimer: ReturnType<typeof setTimeout> | null = null;
	private holdAnchorScreen: { x: number; y: number } | null = null;
	private activeStroke: {
		page: number;
		points: InkPoint[];
		style: InkStrokeStyle;
		box: { width: number; height: number };
		lastPressure: number;
		hasRealPressure: boolean;
		snappedByHold?: boolean;
	} | null = null;
	private livePath: SVGPathElement | null = null;

	private selectedIds = new Set<string>();
	private lassoState: {
		page: number;
		mode: 'select' | 'move';
		start: { x: number; y: number };
		box: { width: number; height: number };
		origins: Map<string, InkPoint[]>;
	} | null = null;

	private undoStack: PdfUndoEntry[] = [];
	private redoStack: PdfUndoEntry[] = [];

	constructor(
		private readonly app: App,
		private readonly containerEl: HTMLElement,
		pdfPath: string,
		options: PdfInkOverlayOptions,
		initial?: PdfInkDocument,
	) {
		this.doc = initial ?? createEmptyPdfInkDocument(pdfPath);
		this.options = options;
		this.start();
	}

	private start(): void {
		this.scan();
		if (typeof MutationObserver !== 'undefined') {
			this.observer = new MutationObserver(() => this.queueScan());
			this.observer.observe(this.containerEl, { childList: true, subtree: true });
		}

		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver = new ResizeObserver(() => this.repaintAll());
			for (const layer of this.layers.values()) this.resizeObserver.observe(layer.pageEl);
		}

		this.keyHandler = (event: KeyboardEvent) => {
			if (this.selectedIds.size === 0) return;
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
				return;
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				this.deleteSelected();
			} else if (event.key === 'Escape') {
				this.selectedIds.clear();
				this.repaintAll();
			}
		};
		window.addEventListener('keydown', this.keyHandler);
		this.touchTapUndo = attachTouchTapUndo(this.containerEl, {
			onUndo: () => {
				if (this.options.tool !== 'pan') this.undo();
			},
			onRedo: () => {
				if (this.options.tool !== 'pan') this.redo();
			},
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.clearHoldSnapTimer();
		this.touchTapUndo?.destroy();
		this.touchTapUndo = null;
		if (this.keyHandler) {
			window.removeEventListener('keydown', this.keyHandler);
			this.keyHandler = null;
		}
		this.observer?.disconnect();
		this.resizeObserver?.disconnect();
		for (const layer of this.layers.values()) layer.svg.remove();
		this.layers.clear();
	}

	setOptions(patch: Partial<PdfInkOverlayOptions>): void {
		const prevColour = this.options.colour;
		this.options = { ...this.options, ...patch };
		if (patch.tool && patch.tool !== 'lasso' && this.selectedIds.size > 0) {
			this.selectedIds.clear();
		}
		if (patch.colour && patch.colour !== prevColour && this.selectedIds.size > 0) {
			this.recolourSelected(patch.colour);
		}
		for (const layer of this.layers.values()) this.applyPointerMode(layer);
		this.repaintAll();
	}

	getDocument(): PdfInkDocument {
		return this.doc;
	}

	replaceDocument(doc: PdfInkDocument): void {
		this.doc = doc;
		this.undoStack = [];
		this.redoStack = [];
		this.repaintAll();
	}

	///////////////////////////
	// Page attachment
	///////////////////////////

	private queueScan(): void {
		if (this.scanQueued || this.destroyed) return;
		this.scanQueued = true;
		requestAnimationFrame(() => {
			this.scanQueued = false;
			if (!this.destroyed) this.scan();
		});
	}

	/**
	 * Locate the page boxes, strongest signal first.
	 *
	 * Obsidian's PDF viewer is its own wrapper around pdf.js and its classes have
	 * changed between versions. `data-page-number` is the standard attribute, but
	 * a build that omits it would otherwise mount nothing at all — so this walks
	 * down to "whatever element hosts a rendered page canvas", which is true of
	 * every pdf.js layout there is.
	 */
	private findPageElements(): HTMLElement[] {
		// Fast path: a normal viewer keeps the page boxes in the light DOM, and
		// the shadow scan below walks every element in the subtree — which this
		// used to pay on every scroll tick, because pdf.js mutates childList as
		// pages mount and unmount.
		const direct = Array.from(
			this.containerEl.querySelectorAll<HTMLElement>('div.page[data-page-number]'),
		);
		if (direct.length > 0) return direct;

		// `querySelectorAll` does not cross a shadow boundary. Walking every root
		// once costs one pass and covers a viewer that isolates its DOM.
		const roots: ParentNode[] = [this.containerEl];
		for (const el of Array.from(this.containerEl.querySelectorAll('*'))) {
			const shadow = (el as HTMLElement).shadowRoot;
			if (shadow) roots.push(shadow);
		}

		// `div.page[data-page-number]` is the selector PDF++ uses against a live
		// Obsidian PDF view, which makes it the most trustworthy one available:
		// a bare `[data-page-number]` also matches sidebar thumbnails, and the
		// first match being a thumbnail is exactly how a layer ends up mounted
		// at a nonsense position.
		for (const root of roots) {
			const exact = Array.from(root.querySelectorAll<HTMLElement>('div.page[data-page-number]'));
			if (exact.length > 0) return exact;
		}

		for (const root of roots) {
			const byAttribute = Array.from(root.querySelectorAll<HTMLElement>('[data-page-number]')).filter(
				(el) => !el.classList.contains('thumbnail'),
			);
			if (byAttribute.length > 0) return byAttribute;
		}

		for (const root of roots) {
			const byClass = Array.from(
				root.querySelectorAll<HTMLElement>(
					'.pdfViewer .page, .pdf-container .page, .pdf-page, .view-content .page',
				),
			);
			if (byClass.length > 0) return byClass;
		}

		const canvasHosts: HTMLElement[] = [];
		for (const root of roots) {
			for (const canvas of Array.from(root.querySelectorAll<HTMLCanvasElement>('canvas'))) {
				const host = canvas.parentElement;
				if (host && host !== this.containerEl) canvasHosts.push(host);
			}
		}
		return Array.from(new Set(canvasHosts));
	}

	private scan(): void {
		const pageEls = this.findPageElements();

		const seen = new Set<number>();
		// The observer fires on every scroll tick as pdf.js mounts and unmounts
		// pages. Repainting unconditionally would rebuild every page on each
		// frame; only a changed page set justifies it.
		let pageSetChanged = false;

		for (const [index, pageEl] of pageEls.entries()) {
			const raw = pageEl.dataset.pageNumber;
			const parsed = raw ? Number.parseInt(raw, 10) : NaN;
			const pageNumber = Number.isFinite(parsed) ? parsed : index + 1;
			seen.add(pageNumber);

			const existing = this.layers.get(pageNumber);
			// pdf.js replaces the page element when it re-renders; an SVG left on
			// the detached node would silently disappear with it.
			if (existing && existing.pageEl === pageEl && pageEl.contains(existing.svg)) continue;

			existing?.svg.remove();
			pageSetChanged = true;

			// The SVG is absolutely positioned against the page box. If the page
			// element is statically positioned it would escape to a distant
			// ancestor and land in the wrong place at every zoom level.
			const pagePosition = window.getComputedStyle(pageEl).position;
			if (!pagePosition || pagePosition === 'static') {
				pageEl.style.position = 'relative';
			}

			const svg = document.createElementNS(SVG_NS, 'svg');
			svg.setAttribute('class', 'bimo-pdf-ink-svg');
			svg.dataset.pageNumber = String(pageNumber);
			svg.style.position = 'absolute';
			svg.style.inset = '0';
			svg.style.overflow = 'visible';
			// Above pdf.js's text layer (z-index 2), which is the element that
			// actually receives pointer events on a page. At equal z-index the
			// winner depends on insertion order, and pdf.js re-appends its text
			// layer on every re-render — so a pen stroke would land on the layer
			// only until the next scroll.
			svg.style.zIndex = '3';

			const reticle = document.createElementNS(SVG_NS, 'circle');
			reticle.setAttribute('class', 'bimo-md-ink-reticle');
			reticle.style.display = 'none';
			svg.appendChild(reticle);

			const lassoRect = document.createElementNS(SVG_NS, 'rect');
			lassoRect.setAttribute('class', 'bimo-md-ink-lasso');
			lassoRect.style.display = 'none';
			svg.appendChild(lassoRect);

			pageEl.appendChild(svg);

			const layer: PageLayer = { pageEl, svg, pageNumber, reticle, lassoRect };
			this.layers.set(pageNumber, layer);
			this.applyPointerMode(layer);
			this.bindPointer(svg, pageNumber);
			this.resizeObserver?.observe(pageEl);
		}

		for (const [pageNumber, layer] of this.layers) {
			if (!seen.has(pageNumber)) {
				layer.svg.remove();
				this.layers.delete(pageNumber);
				pageSetChanged = true;
			}
		}

		if (pageSetChanged) this.repaintAll();
	}

	private applyPointerMode(layer: PageLayer): void {
		const active = this.options.tool !== 'pan';
		layer.svg.style.pointerEvents = active ? 'auto' : 'none';
		layer.svg.style.cursor = active ? 'crosshair' : 'default';
		layer.svg.dataset.tool = this.options.tool;
		// CSS keys off this: only finger drawing may claim the touch stream.
		layer.svg.dataset.fingerDraws = this.options.fingerDraws ? 'true' : 'false';
		if (!active || this.options.tool === 'lasso') layer.reticle.style.display = 'none';
	}

	private effectiveBrush(): InkBrushKind {
		if (this.options.tool === 'highlighter') return 'highlighter';
		return this.options.brush === 'highlighter' ? 'pen' : this.options.brush;
	}

	private reticleRadius(): number {
		if (this.options.tool === 'eraser' || this.transientEraser) return this.options.eraserRadius;
		if (this.options.tool === 'lasso') return 4;
		const preset = resolveBrushPreset(this.effectiveBrush());
		return Math.max(2, (this.options.size * preset.sizeMultiplier) / 2);
	}

	///////////////////////////
	// Painting
	///////////////////////////

	private repaintAll(): void {
		for (const layer of this.layers.values()) this.paintPage(layer);
	}

	private paintPage(layer: PageLayer): void {
		const { svg, pageEl, pageNumber } = layer;
		const rect = pageEl.getBoundingClientRect();
		const width = rect.width;
		const height = rect.height;
		if (width <= 0 || height <= 0) return;

		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

		// Keep the live path element from the previous frame; everything else is
		// rebuilt. A full rebuild is cheap here: one page holds tens of strokes.
		const livePath = this.livePath;
		svg.replaceChildren();
		this.livePath = null;

		for (const stroke of this.doc.strokes) {
			if (stroke.page !== pageNumber) continue;
			const path = this.buildPath(stroke, width, height);
			svg.appendChild(path);
		}

		if (livePath && this.activeStroke?.page === pageNumber) {
			svg.appendChild(livePath);
			this.livePath = livePath;
		}

		// The reticle and lasso rect live outside the rebuild — they belong to the page,
		// not to the ink, and losing them on every repaint would make them flicker.
		svg.appendChild(layer.reticle);
		svg.appendChild(layer.lassoRect);
	}

	private buildPath(stroke: PdfInkStroke, width: number, height: number): SVGPathElement {
		const points = fromPageSpace(stroke.points, width, height);
		const style: InkStrokeStyle = { ...stroke.style, size: stroke.style.size * width };
		const proxy: InkStroke = {
			id: stroke.id,
			points,
			style,
			offset: { x: 0, y: 0 },
		};
		const pathD = points.length === 1
			? dotPath(points[0][0], points[0][1], style.size / 2)
			: getRenderedStrokeData(proxy).pathD;

		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', pathD);
		path.setAttribute('fill', stroke.style.color || 'currentColor');
		if (stroke.style.opacity !== undefined && stroke.style.opacity < 1) {
			path.setAttribute('opacity', String(stroke.style.opacity));
		}
		if (this.selectedIds.has(stroke.id)) {
			path.classList.add('is-selected');
		}
		return path;
	}

	///////////////////////////
	// Input
	///////////////////////////

	private clearHoldSnapTimer(): void {
		if (this.holdSnapTimer !== null) {
			clearTimeout(this.holdSnapTimer);
			this.holdSnapTimer = null;
		}
		this.holdAnchorScreen = null;
	}

	private scheduleHoldSnap(screenX: number, screenY: number): void {
		if (this.holdAnchorScreen) {
			const dist = Math.hypot(screenX - this.holdAnchorScreen.x, screenY - this.holdAnchorScreen.y);
			if (dist <= HOLD_SNAP_JITTER_PX) return;
		}
		this.clearHoldSnapTimer();
		this.holdAnchorScreen = { x: screenX, y: screenY };
		this.holdSnapTimer = setTimeout(() => {
			this.holdSnapTimer = null;
			if (!this.activeStroke || this.activeStroke.points.length < 4) return;
			const snapped = snapStrokePoints(this.activeStroke.points, HOLD_TO_SNAP_TOLERANCE);
			if (snapped !== this.activeStroke.points) {
				this.activeStroke.points = snapped;
				this.activeStroke.snappedByHold = true;
				this.drawLive();
			}
		}, HOLD_TO_SNAP_DELAY_MS);
	}

	private hitPageStroke(pageNumber: number, x: number, y: number, width: number, height: number, radius: number): PdfInkStroke | null {
		for (let i = this.doc.strokes.length - 1; i >= 0; i -= 1) {
			const stroke = this.doc.strokes[i];
			if (stroke.page !== pageNumber) continue;
			const points = fromPageSpace(stroke.points, width, height);
			if (points.some(([px, py]) => Math.hypot(px - x, py - y) <= radius)) {
				return stroke;
			}
		}
		return null;
	}

	private bindPointer(svg: SVGSVGElement, pageNumber: number): void {
		svg.addEventListener('pointerdown', (event) => {
			if (this.options.tool === 'pan') return;
			if (event.button !== 0 && event.button !== 5) return;
			if (event.pointerType === 'mouse' && !this.options.mouseDrawing) {
				explainMouseDrawingDisabled();
				return;
			}

			// A finger scrolls the PDF unless the user opted into finger drawing.
			// Returning without preventDefault keeps one-finger page scrolling alive.
			if (event.pointerType === 'touch' && !this.options.fingerDraws) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			this.activePointerId = event.pointerId;
			svg.setPointerCapture?.(event.pointerId);

			const isTransientEraser = event.button === 5
				|| ((this.options.tool === 'pen' || this.options.tool === 'highlighter') && (event.ctrlKey || event.metaKey));
			if (this.options.tool === 'eraser' || isTransientEraser) {
				this.transientEraser = isTransientEraser;
				this.eraseAt(svg, pageNumber, event, this.options.eraserRadius);
				return;
			}

			const rect = svg.getBoundingClientRect();
			const localX = event.clientX - rect.left;
			const localY = event.clientY - rect.top;

			if (this.options.tool === 'lasso') {
				const hit = this.hitPageStroke(pageNumber, localX, localY, rect.width, rect.height, 14);
				if (hit) {
					if (!this.selectedIds.has(hit.id)) {
						this.selectedIds = new Set([hit.id]);
						this.repaintAll();
					}
					const origins = new Map<string, InkPoint[]>();
					for (const s of this.doc.strokes) {
						if (this.selectedIds.has(s.id)) {
							origins.set(s.id, s.points.map((pt) => [...pt] as InkPoint));
						}
					}
					this.lassoState = {
						page: pageNumber,
						mode: 'move',
						start: { x: localX, y: localY },
						box: { width: rect.width, height: rect.height },
						origins,
					};
				} else {
					this.selectedIds.clear();
					this.repaintAll();
					this.lassoState = {
						page: pageNumber,
						mode: 'select',
						start: { x: localX, y: localY },
						box: { width: rect.width, height: rect.height },
						origins: new Map(),
					};
					const layer = this.layers.get(pageNumber);
					if (layer) {
						layer.lassoRect.setAttribute('x', String(localX));
						layer.lassoRect.setAttribute('y', String(localY));
						layer.lassoRect.setAttribute('width', '0');
						layer.lassoRect.setAttribute('height', '0');
						layer.lassoRect.style.display = '';
					}
				}
				return;
			}

			const hasRealPressure = event.pointerType === 'pen'
				&& Number.isFinite(event.pressure)
				&& event.pressure > 0
				&& event.pressure !== 0.5;
			const initialPressure = hasRealPressure ? event.pressure : 0.5;
			const point: InkPoint = [localX, localY, initialPressure];

			const style = this.buildStyle();
			if (hasRealPressure) {
				style.simulatePressure = false;
			}

			this.activeStroke = {
				page: pageNumber,
				points: [point],
				style,
				box: { width: rect.width, height: rect.height },
				lastPressure: initialPressure,
				hasRealPressure,
			};
			this.ensureLivePath(svg);
			this.drawLive();
			this.scheduleHoldSnap(localX, localY);
		});

		svg.addEventListener('pointerleave', () => {
			const layer = this.layers.get(pageNumber);
			if (layer) layer.reticle.style.display = 'none';
		});

		svg.addEventListener('pointermove', (event) => {
			const layer = this.layers.get(pageNumber);
			if (layer && this.options.tool !== 'pan' && this.options.tool !== 'lasso') {
				const rect = svg.getBoundingClientRect();
				layer.reticle.setAttribute('cx', String(event.clientX - rect.left));
				layer.reticle.setAttribute('cy', String(event.clientY - rect.top));
				layer.reticle.setAttribute('r', String(this.reticleRadius()));
				layer.reticle.style.display = '';
			}

			if (event.pointerId !== this.activePointerId) return;

			if (this.options.tool === 'eraser' || this.transientEraser) {
				this.eraseAt(svg, pageNumber, event, this.options.eraserRadius);
				return;
			}

			if (this.options.tool === 'lasso' && this.lassoState?.page === pageNumber) {
				const rect = svg.getBoundingClientRect();
				const curX = event.clientX - rect.left;
				const curY = event.clientY - rect.top;
				if (this.lassoState.mode === 'select' && layer) {
					const x = Math.min(this.lassoState.start.x, curX);
					const y = Math.min(this.lassoState.start.y, curY);
					const w = Math.abs(curX - this.lassoState.start.x);
					const h = Math.abs(curY - this.lassoState.start.y);
					layer.lassoRect.setAttribute('x', String(x));
					layer.lassoRect.setAttribute('y', String(y));
					layer.lassoRect.setAttribute('width', String(w));
					layer.lassoRect.setAttribute('height', String(h));
				} else if (this.lassoState.mode === 'move') {
					const dx = (curX - this.lassoState.start.x) / Math.max(this.lassoState.box.width, 1);
					const dy = (curY - this.lassoState.start.y) / Math.max(this.lassoState.box.height, 1);
					for (const stroke of this.doc.strokes) {
						const origin = this.lassoState.origins.get(stroke.id);
						if (!origin) continue;
						stroke.points = origin.map(([px, py, p]) => [px + dx, py + dy, p] as InkPoint);
					}
					this.repaintAll();
				}
				return;
			}

			if (!this.activeStroke) return;
			const rect = svg.getBoundingClientRect();
			const samples = getPointerSamples(event);

			if (this.activeStroke.snappedByHold) {
				if (this.activeStroke.points.length === 2) {
					const last = samples[samples.length - 1] ?? event;
					const endX = last.clientX - rect.left;
					const endY = last.clientY - rect.top;
					this.activeStroke.points = [
						this.activeStroke.points[0],
						[endX, endY, this.activeStroke.lastPressure],
					];
					this.drawLive();
				}
				return;
			}

			for (const sample of samples) {
				const rawX = sample.clientX - rect.left;
				const rawY = sample.clientY - rect.top;
				const sampleHasRealPressure = sample.pointerType === 'pen'
					&& Number.isFinite(sample.pressure)
					&& sample.pressure > 0
					&& sample.pressure !== 0.5;
				if (sampleHasRealPressure && !this.activeStroke.hasRealPressure) {
					this.activeStroke.hasRealPressure = true;
					this.activeStroke.style.simulatePressure = false;
				}
				const targetPressure = this.activeStroke.hasRealPressure
					? (sample.pressure > 0 ? sample.pressure : this.activeStroke.lastPressure)
					: 0.5;
				const smoothedPressure = this.activeStroke.lastPressure + (targetPressure - this.activeStroke.lastPressure) * 0.65;
				this.activeStroke.lastPressure = smoothedPressure;

				const prev = this.activeStroke.points[this.activeStroke.points.length - 1];
				if (prev && Math.hypot(rawX - prev[0], rawY - prev[1]) < 0.35) continue;
				this.activeStroke.points.push([rawX, rawY, smoothedPressure]);
			}

			this.drawLive();
			const lastSample = samples[samples.length - 1] ?? event;
			this.scheduleHoldSnap(lastSample.clientX - rect.left, lastSample.clientY - rect.top);
		});

		const finish = (event: PointerEvent) => {
			if (event.pointerId !== this.activePointerId) return;
			this.activePointerId = null;
			this.transientEraser = false;
			this.clearHoldSnapTimer();
			svg.releasePointerCapture?.(event.pointerId);

			if (this.lassoState && this.lassoState.page === pageNumber) {
				const state = this.lassoState;
				this.lassoState = null;
				const layer = this.layers.get(pageNumber);
				if (layer) layer.lassoRect.style.display = 'none';
				const rect = svg.getBoundingClientRect();
				const curX = event.clientX - rect.left;
				const curY = event.clientY - rect.top;

				if (state.mode === 'select') {
					const minX = Math.min(state.start.x, curX);
					const maxX = Math.max(state.start.x, curX);
					const minY = Math.min(state.start.y, curY);
					const maxY = Math.max(state.start.y, curY);
					this.selectedIds.clear();
					if (maxX - minX > 3 || maxY - minY > 3) {
						for (const stroke of this.doc.strokes) {
							if (stroke.page !== pageNumber) continue;
							const pts = fromPageSpace(stroke.points, rect.width, rect.height);
							if (pts.some(([px, py]) => px >= minX && px <= maxX && py >= minY && py <= maxY)) {
								this.selectedIds.add(stroke.id);
							}
						}
					}
					this.repaintAll();
				} else if (state.mode === 'move') {
					const moves: Array<{ id: string; from: InkPoint[]; to: InkPoint[] }> = [];
					for (const stroke of this.doc.strokes) {
						const from = state.origins.get(stroke.id);
						if (!from) continue;
						if (from[0][0] !== stroke.points[0][0] || from[0][1] !== stroke.points[0][1]) {
							moves.push({
								id: stroke.id,
								from,
								to: stroke.points.map((pt) => [...pt] as InkPoint),
							});
						}
					}
					if (moves.length > 0) {
						this.undoStack.push({ type: 'move', moves });
						this.redoStack = [];
						this.doc.updatedAt = Date.now();
						this.options.onChange?.(this.doc);
					}
				}
				return;
			}

			if (!this.activeStroke) return;

			const { page, points, style, box, snappedByHold } = this.activeStroke;
			this.activeStroke = null;
			this.livePath = null;

			if (points.length === 0) return;
			pdfStrokeCounter += 1;
			const snapped = snappedByHold
				? points
				: this.options.shapeSnap
					? snapStrokePoints(points, 6)
					: points;
			const stroke: PdfInkStroke = {
				id: `pdf_${Date.now().toString(36)}_${pdfStrokeCounter}`,
				points: toPageSpace(snapped, box.width, box.height),
				style: { ...style, size: style.size / Math.max(box.width, 1) },
				page,
				createdAt: Date.now(),
			};
			this.doc.strokes.push(stroke);
			this.undoStack.push({ type: 'add', stroke });
			this.redoStack = [];
			this.doc.updatedAt = Date.now();
			this.options.onChange?.(this.doc);
			this.repaintAll();
		};

		svg.addEventListener('pointerup', finish);
		svg.addEventListener('pointercancel', (event) => {
			if (event.pointerId !== this.activePointerId) return;
			this.activePointerId = null;
			this.transientEraser = false;
			this.clearHoldSnapTimer();
			this.lassoState = null;
			const layer = this.layers.get(pageNumber);
			if (layer) layer.lassoRect.style.display = 'none';
			this.activeStroke = null;
			this.livePath = null;
			this.repaintAll();
		});
	}

	private ensureLivePath(svg: SVGSVGElement): void {
		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('class', 'bimo-pdf-ink-live');
		path.style.pointerEvents = 'none';
		svg.appendChild(path);
		this.livePath = path;
	}

	private drawLive(): void {
		if (!this.activeStroke || !this.livePath) return;
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
	}

	private buildStyle(): InkStrokeStyle {
		const brush = this.effectiveBrush();
		const preset = resolveBrushPreset(brush);
		const isHighlighter = brush === 'highlighter';
		const colour = isHighlighter && this.options.colour === 'currentColor'
			? preset.defaultColour
			: this.options.colour;
		return {
			size: this.options.size * preset.sizeMultiplier,
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

	private eraseAt(svg: SVGSVGElement, pageNumber: number, event: PointerEvent, radius: number): void {
		const rect = svg.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const isPixel = this.options.eraserMode === 'pixel';

		const remaining: PdfInkStroke[] = [];
		const removed: PdfInkStroke[] = [];
		const added: PdfInkStroke[] = [];

		for (const stroke of this.doc.strokes) {
			if (stroke.page !== pageNumber) {
				remaining.push(stroke);
				continue;
			}
			const screenPoints = fromPageSpace(stroke.points, rect.width, rect.height);

			if (!isPixel) {
				const hit = screenPoints.some(([px, py]) => Math.hypot(px - x, py - y) <= radius);
				if (hit) removed.push(stroke);
				else remaining.push(stroke);
			} else {
				let anyHit = false;
				const hitFlags = screenPoints.map(([px, py]) => {
					const isHit = Math.hypot(px - x, py - y) <= radius;
					if (isHit) anyHit = true;
					return isHit;
				});

				if (!anyHit) {
					remaining.push(stroke);
					continue;
				}

				removed.push(stroke);
				const runs: InkPoint[][] = [];
				let currentRun: InkPoint[] = [];

				for (let i = 0; i < stroke.points.length; i++) {
					if (!hitFlags[i]) {
						currentRun.push(stroke.points[i]);
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
							id: newPdfStrokeId(),
							page: stroke.page,
							points: run,
							style: { ...stroke.style },
							createdAt: Date.now(),
						});
					}
				}
			}
		}

		if (removed.length === 0 && added.length === 0) return;
		this.doc.strokes = [...remaining, ...added];
		if (added.length > 0) {
			this.undoStack.push({ type: 'replace', removed, added });
		} else {
			this.undoStack.push({ type: 'remove', strokes: removed });
		}
		this.redoStack = [];
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
	}

	deleteSelected(): boolean {
		if (this.selectedIds.size === 0) return false;
		const removed = this.doc.strokes.filter((s) => this.selectedIds.has(s.id));
		if (removed.length === 0) {
			this.selectedIds.clear();
			return false;
		}
		this.doc.strokes = this.doc.strokes.filter((s) => !this.selectedIds.has(s.id));
		this.selectedIds.clear();
		this.undoStack.push({ type: 'remove', strokes: removed });
		this.redoStack = [];
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
		return true;
	}

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
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
		return true;
	}

	clearAll(): void {
		if (this.doc.strokes.length === 0) return;
		const removed = [...this.doc.strokes];
		this.doc.strokes = [];
		this.selectedIds.clear();
		this.undoStack.push({ type: 'remove', strokes: removed });
		this.redoStack = [];
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(): boolean {
		const entry = this.undoStack.pop();
		if (!entry) return false;
		if (entry.type === 'add') {
			this.doc.strokes = this.doc.strokes.filter((s) => s.id !== entry.stroke.id);
		} else if (entry.type === 'remove') {
			this.doc.strokes.push(...entry.strokes);
		} else if (entry.type === 'replace') {
			const addedIds = new Set(entry.added.map((s) => s.id));
			this.doc.strokes = this.doc.strokes.filter((s) => !addedIds.has(s.id));
			this.doc.strokes.push(...entry.removed);
		} else if (entry.type === 'move') {
			const map = new Map(entry.moves.map((m) => [m.id, m.from]));
			for (const s of this.doc.strokes) {
				const from = map.get(s.id);
				if (from) s.points = from.map((pt) => [...pt] as InkPoint);
			}
		} else if (entry.type === 'restyle') {
			const map = new Map(entry.changes.map((c) => [c.id, c.fromColor]));
			for (const s of this.doc.strokes) {
				const fromColor = map.get(s.id);
				if (fromColor !== undefined) s.style = { ...s.style, color: fromColor };
			}
		}
		this.redoStack.push(entry);
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
		return true;
	}

	redo(): boolean {
		const entry = this.redoStack.pop();
		if (!entry) return false;
		if (entry.type === 'add') {
			this.doc.strokes.push(entry.stroke);
		} else if (entry.type === 'remove') {
			const ids = new Set(entry.strokes.map((s) => s.id));
			this.doc.strokes = this.doc.strokes.filter((s) => !ids.has(s.id));
		} else if (entry.type === 'replace') {
			const removedIds = new Set(entry.removed.map((s) => s.id));
			this.doc.strokes = this.doc.strokes.filter((s) => !removedIds.has(s.id));
			this.doc.strokes.push(...entry.added);
		} else if (entry.type === 'move') {
			const map = new Map(entry.moves.map((m) => [m.id, m.to]));
			for (const s of this.doc.strokes) {
				const to = map.get(s.id);
				if (to) s.points = to.map((pt) => [...pt] as InkPoint);
			}
		} else if (entry.type === 'restyle') {
			const map = new Map(entry.changes.map((c) => [c.id, c.toColor]));
			for (const s of this.doc.strokes) {
				const toColor = map.get(s.id);
				if (toColor !== undefined) s.style = { ...s.style, color: toColor };
			}
		}
		this.undoStack.push(entry);
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
		return true;
	}

	hasInk(): boolean {
		return this.doc.strokes.length > 0;
	}
}
