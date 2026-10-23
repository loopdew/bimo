import { getStroke } from 'perfect-freehand';
import type { App } from 'obsidian';
import type { InkBrushKind } from 'src/ink-canvas/brush-presets';
import { resolveBrushPreset } from 'src/ink-canvas/brush-presets';
import { getRenderedStrokeData } from 'src/ink-canvas/rendered-stroke-cache';
import type { InkPoint, InkStroke, InkStrokeStyle } from 'src/ink-canvas/types';
import { toStrokeOptions } from 'src/ink-canvas/types';
import { getSvgPathFromStroke } from 'src/ink-canvas/utils/svg-path-from-stroke';
import { explainMouseDrawingDisabled } from './md-ink-overlay';
import {
	createEmptyPdfInkDocument,
	fromPageSpace,
	toPageSpace,
	type PdfInkDocument,
	type PdfInkStroke,
} from './pdf-ink-types';
import { dotPath, snapStrokePoints } from './types';

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
	eraserRadius: number;
	shapeSnap: boolean;
	tool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'pan';
	onChange?: (doc: PdfInkDocument) => void;
}

interface PageLayer {
	pageEl: HTMLElement;
	svg: SVGSVGElement;
	pageNumber: number;
	reticle: SVGCircleElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

let pdfStrokeCounter = 0;

export class PdfInkOverlay {
	private doc: PdfInkDocument;
	private options: PdfInkOverlayOptions;
	private readonly layers = new Map<number, PageLayer>();
	private observer: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private scanQueued = false;
	private destroyed = false;

	private activePointerId: number | null = null;
	private activeStroke: { page: number; points: InkPoint[]; style: InkStrokeStyle; box: { width: number; height: number } } | null = null;
	private livePath: SVGPathElement | null = null;

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
		this.observer = new MutationObserver(() => this.queueScan());
		this.observer.observe(this.containerEl, { childList: true, subtree: true });

		this.resizeObserver = new ResizeObserver(() => this.repaintAll());
		for (const layer of this.layers.values()) this.resizeObserver.observe(layer.pageEl);
	}

	destroy(): void {
		this.destroyed = true;
		this.observer?.disconnect();
		this.resizeObserver?.disconnect();
		for (const layer of this.layers.values()) layer.svg.remove();
		this.layers.clear();
	}

	setOptions(patch: Partial<PdfInkOverlayOptions>): void {
		this.options = { ...this.options, ...patch };
		for (const layer of this.layers.values()) this.applyPointerMode(layer);
		this.repaintAll();
	}

	getDocument(): PdfInkDocument {
		return this.doc;
	}

	replaceDocument(doc: PdfInkDocument): void {
		this.doc = doc;
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

			pageEl.appendChild(svg);

			const layer: PageLayer = { pageEl, svg, pageNumber, reticle };
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
		// The lasso exists on notes only. Falling through to the pen branch would
		// silently turn "select ink" into "draw a line" on every PDF page, so it
		// is grouped with pan here: inert and scrollable.
		const active = this.options.tool !== 'pan' && this.options.tool !== 'lasso';
		layer.svg.style.pointerEvents = active ? 'auto' : 'none';
		layer.svg.style.cursor = active ? 'crosshair' : 'default';
		layer.svg.dataset.tool = this.options.tool;
		if (!active) layer.reticle.style.display = 'none';
	}

	private reticleRadius(): number {
		if (this.options.tool === 'eraser') return this.options.eraserRadius;
		if (this.options.tool === 'lasso') return 4;
		const preset = resolveBrushPreset(this.options.brush);
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

		// The reticle lives outside the rebuild — it belongs to the page, not to
		// the ink, and losing it on every repaint would make it flicker.
		svg.appendChild(layer.reticle);
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
		return path;
	}

	///////////////////////////
	// Input
	///////////////////////////

	private bindPointer(svg: SVGSVGElement, pageNumber: number): void {
		svg.addEventListener('pointerdown', (event) => {
			if (this.options.tool === 'pan' || this.options.tool === 'lasso') return;
			if (event.button !== 0) return;
			if (event.pointerType === 'mouse' && !this.options.mouseDrawing) {
				explainMouseDrawingDisabled();
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			this.activePointerId = event.pointerId;
			svg.setPointerCapture?.(event.pointerId);

			if (this.options.tool === 'eraser') {
				this.eraseAt(svg, pageNumber, event, this.options.eraserRadius);
				return;
			}

			const rect = svg.getBoundingClientRect();
			const point: InkPoint = [
				event.clientX - rect.left,
				event.clientY - rect.top,
				event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5,
			];

			this.activeStroke = {
				page: pageNumber,
				points: [point],
				style: this.buildStyle(),
				box: { width: rect.width, height: rect.height },
			};
			this.ensureLivePath(svg);
			this.drawLive();
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

			if (this.options.tool === 'eraser') {
				this.eraseAt(svg, pageNumber, event, this.options.eraserRadius);
				return;
			}

			if (!this.activeStroke) return;
			const rect = svg.getBoundingClientRect();
			const point: InkPoint = [
				event.clientX - rect.left,
				event.clientY - rect.top,
				event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5,
			];
			this.activeStroke.points.push(point);
			this.drawLive();
		});

		const finish = (event: PointerEvent) => {
			if (event.pointerId !== this.activePointerId) return;
			this.activePointerId = null;
			svg.releasePointerCapture?.(event.pointerId);
			if (!this.activeStroke) return;

			const { page, points, style, box } = this.activeStroke;
			this.activeStroke = null;
			this.livePath = null;

			if (points.length === 0) return;
			pdfStrokeCounter += 1;
			const snapped = this.options.shapeSnap ? snapStrokePoints(points, 6) : points;
			const stroke: PdfInkStroke = {
				id: `pdf_${Date.now().toString(36)}_${pdfStrokeCounter}`,
				points: toPageSpace(snapped, box.width, box.height),
				style: { ...style, size: style.size / Math.max(box.width, 1) },
				page,
				createdAt: Date.now(),
			};
			this.doc.strokes.push(stroke);
			this.doc.updatedAt = Date.now();
			this.options.onChange?.(this.doc);
			this.repaintAll();
		};

		svg.addEventListener('pointerup', finish);
		svg.addEventListener('pointercancel', (event) => {
			if (event.pointerId !== this.activePointerId) return;
			this.activePointerId = null;
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
		const preset = resolveBrushPreset(this.options.brush);
		const isHighlighter = this.options.brush === 'highlighter';
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
			brush: this.options.brush,
			opacity: preset.opacity,
		};
	}

	private eraseAt(svg: SVGSVGElement, pageNumber: number, event: PointerEvent, radius: number): void {
		const rect = svg.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		const remaining: PdfInkStroke[] = [];
		let removed = false;
		for (const stroke of this.doc.strokes) {
			if (stroke.page !== pageNumber) {
				remaining.push(stroke);
				continue;
			}
			const points = fromPageSpace(stroke.points, rect.width, rect.height);
			const hit = points.some(([px, py]) => Math.hypot(px - x, py - y) <= radius);
			if (hit) removed = true;
			else remaining.push(stroke);
		}

		if (!removed) return;
		this.doc.strokes = remaining;
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
	}

	clearAll(): void {
		if (this.doc.strokes.length === 0) return;
		this.doc.strokes = [];
		this.doc.updatedAt = Date.now();
		this.options.onChange?.(this.doc);
		this.repaintAll();
	}

	hasInk(): boolean {
		return this.doc.strokes.length > 0;
	}
}
