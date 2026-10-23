import type { StrokeOptions } from 'perfect-freehand';
import type { InkBrushKind } from './brush-presets';
import { identityStrokePressureEasing, inkStrokeUsesPenEasing, penStrokePressureEasing } from './stroke-easing';
import { INK_STROKE_ZOOM_REFERENCE } from './stroke-zoom-scale';

///////////////////////////
///////////////////////////

/** A single point captured during pen/stylus input: [x, y, pressure]. */
export type InkPoint = [x: number, y: number, pressure: number];

/** Rendering options stored per-stroke so each stroke can have its own visual style. */
export interface InkStrokeStyle {
	/** Base diameter in canvas units. */
	size: number;
	/** How much pressure affects width. Range: -1 to 1. */
	thinning: number;
	/** Edge softness. Range: 0 to 1. */
	smoothing: number;
	/** How much to streamline the stroke. Range: 0 to 1. */
	streamline: number;
	/** When true, velocity simulates pressure (mouse input). When false, real pressure is used. */
	simulatePressure: boolean;
	/**
	 * How the stroke was authored for preset/easing (JSON-safe).
	 * Omitted on legacy strokes; easing falls back to `simulatePressure === false` ⇒ pen curve.
	 */
	inputKind?: 'pen' | 'mouse';
	/** Fill colour (CSS). */
	color: string;
	/**
	 * Brush that authored this stroke. Omitted on legacy/upstream strokes, which
	 * behave exactly like `pen` — see `brush-presets.ts`.
	 */
	brush?: InkBrushKind;
	/**
	 * Fill opacity (0–1) baked onto the rendered path. Omitted means 1.
	 * Translucent so the highlighter can wash over existing ink.
	 */
	opacity?: number;
	/**
	 * Camera zoom when the stroke was captured (reference {@link INK_STROKE_ZOOM_REFERENCE}).
	 * Drives mergeNearDuplicate scaling on re-render; streamline/smoothing are stored already scaled.
	 */
	captureZoom?: number;
}

/** perfect-freehand options plus ink-canvas outline preprocessing fields. */
export type InkStrokeOutlineOptions = StrokeOptions & {
	captureZoom?: number;
};

/** A completed stroke stored in the stroke store. */
export interface InkStroke {
	id: string;
	/**
	 * Where this stroke’s points originated.
	 *
	 * - `local`: captured by this plugin from pointer events (subject to stroke smoothing pipeline).
	 * - `boox`: ingested from eInk Bridge (kept as a more direct representation of raw pen input).
	 *
	 * Omitted on legacy strokes; treated as `local`.
	 */
	authoringSource?: 'local' | 'boox';
	/** Raw captured input points. */
	points: InkPoint[];
	/** Visual style at the time the stroke was drawn. */
	style: InkStrokeStyle;
	/** Translation applied after creation (e.g. via the select-and-move tool). */
	offset: { x: number; y: number };
	/** Epoch ms when the stroke began. Omitted on legacy strokes. */
	startedAt?: number;
	/** Epoch ms when the stroke ended. Omitted on legacy strokes. */
	finishedAt?: number;
}

/**
 * An image drawn underneath the strokes — a PDF page, a textbook photo, a slide.
 *
 * Annotation is just "ink over a background", so this one field unlocks PDF
 * markup without touching the stroke model: the vector ink stays independent of
 * the raster page, and hiding the background leaves the annotations intact.
 */
export interface InkCanvasBackground {
	/** Vault-relative path of the image file. */
	path: string;
	/** Pixel size of the source image, used to keep the aspect ratio. */
	width: number;
	height: number;
	/**
	 * 0–1. Fading the page keeps dense printed text from fighting the ink; the
	 * background is never fully hidden by this value (use the toggle for that).
	 */
	opacity?: number;
}

/** Serialisable snapshot of the entire canvas state. */
export interface InkCanvasSnapshot {
	/** Format discriminator — always 1 for this version. */
	version: 1;
	strokes: InkStroke[];
	/**
	 * Camera position at last save.
	 *
	 * Read on open when present, but **nothing currently writes it**: drawing
	 * viewports are persisted through the embed's viewBox instead, and writing mode
	 * uses ordinary scrolling. Kept in the shape for compatibility with files that
	 * carry it; do not assume it reflects the last view.
	 */
	camera?: CameraState;
	gridEnabled: boolean;
	/** Present only on inkWriting files. Height in px of each ruled line. */
	writingLineHeight?: number;
	/** Optional page image rendered under every stroke. */
	background?: InkCanvasBackground;
	/**
	 * Where this annotation page came from, when it was created from a PDF.
	 *
	 * Kept so a marked-up page can point back at its source: reopening the PDF at
	 * the right page is otherwise impossible once the background is a flat image.
	 */
	sourcePdf?: {
		path: string;
		/** Page label as the viewer reported it; `null` when it could not be read. */
		page: string | null;
	};
}

/** Camera position and zoom level. */
export interface CameraState {
	x: number;
	y: number;
	zoom: number;
}

/** Default stroke style applied to new strokes. */
export const DEFAULT_STROKE_STYLE: InkStrokeStyle = {
	size: 4,
	thinning: 0.5,
	smoothing: 0.5,
	streamline: 0.5,
	simulatePressure: true,
	color: 'currentColor',
};

/** Convert an InkStrokeStyle to perfect-freehand StrokeOptions. */
export function toStrokeOptions(style: InkStrokeStyle): InkStrokeOutlineOptions {
	const easing = inkStrokeUsesPenEasing(style) ? penStrokePressureEasing : identityStrokePressureEasing;
	return {
		size: style.size,
		thinning: style.thinning,
		smoothing: style.smoothing,
		streamline: style.streamline,
		simulatePressure: style.simulatePressure,
		easing,
		last: true,
		start: { cap: true, taper: 0 },
		end: { cap: true, taper: 0 },
		captureZoom: style.captureZoom ?? INK_STROKE_ZOOM_REFERENCE,
	};
}

/** The active drawing tool. */
export type InkTool = 'draw' | 'erase' | 'select';

/**
 * Public interface exposed by the ink canvas to the rest of the system.
 * This is the contract that replaces tldraw's `Editor` for drawing mode.
 */
export interface InkCanvasEditor {
	// Undo / redo
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	getUndoCount(): number;

	// Tools
	setTool(tool: InkTool): void;
	getCurrentTool(): InkTool;
	/** Notified when the active tool changes (toolbar clicks, cmd/ctrl temporary erase, etc.). */
	subscribeToolChange(listener: (tool: InkTool) => void): () => void;

	// Stroke style
	getStrokeStyle(): InkStrokeStyle;
	setStrokeStyle(style: Partial<InkStrokeStyle>): void;

	// Camera
	getCamera(): CameraState;
	setCamera(camera: Partial<CameraState>): void;

	// Grid
	isGridEnabled(): boolean;
	setGridEnabled(enabled: boolean): void;

	// Selection
	getSelectedStrokeIds(): Set<string>;
	deleteSelectedStrokes(): void;

	// Data
	getSnapshot(): InkCanvasSnapshot;
	/**
	 * Swaps the page image without remounting the canvas. `null` removes it.
	 * The new value is included in subsequent `getSnapshot()` calls, so the next
	 * save persists it.
	 */
	setBackground(background: InkCanvasBackground | null): void;
	eraseAll(): void;

	// Programmatic stroke creation (e.g. Boox bridge)
	addStroke(stroke: InkStroke): void;

	// Coordinate mapping
	screenToPage(screenX: number, screenY: number): { x: number; y: number };

	// DOM access
	getContainerElement(): HTMLElement | null;
	getSvgElement(): SVGSVGElement | null;

	/** Writing mode only: returns the current computed page height in page units.
	 *  In draw mode this returns 0. */
	getPageHeight(): number;

	/** Writing mode only: sets page height (e.g. manual expand-lines). No-op in draw mode. */
	setWritingPageHeight(height: number): void;
}
