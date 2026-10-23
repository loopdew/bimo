import {
	DEFAULT_CONTENT_COLOUR_PRIMARY_STROKE,
	DEFAULT_CONTENT_COLOUR_WRITING_LINE,
	INK_SVG_STROKE_PATH_CLASS,
	INK_SVG_WRITING_LINE_CLASS,
} from 'src/default-content-colours';
import { INK_CANVAS_FORMAT_VERSION, WRITING_LINE_HEIGHT, WRITING_MIN_PAGE_HEIGHT } from 'src/constants';
import type { InkStroke, InkCanvasSnapshot } from './types';
import { getRenderedStrokeData } from './rendered-stroke-cache';
import { resolveBrushPreset } from './brush-presets';
///////////////////////////
///////////////////////////

/**
 * Render an array of strokes into a self-contained SVG string suitable for
 * saving as a `.svg` file. The viewBox is computed to tightly fit all strokes
 * with optional padding.
 */
export function renderStrokesToSvg(
	strokes: InkStroke[],
	snapshotJson: InkCanvasSnapshot,
	padding: number = 16,
	background?: BakedBackground,
): string {
	if (strokes.length === 0 && !background) {
		return buildSvgString('', '0 0 1 1', snapshotJson);
	}
	if (strokes.length === 0 && background) {
		// Annotating an empty page: the background alone defines the canvas size.
		return buildSvgString(background.markup, `0 0 ${background.width} ${background.height}`, snapshotJson);
	}

	const rendered = renderStrokePathsAndBounds(strokes);
	const bounds = rendered.bounds;
	const viewBox = [
		bounds.minX - padding,
		bounds.minY - padding,
		bounds.width + padding * 2,
		bounds.height + padding * 2,
	].join(' ');

	return buildSvgString(`${background?.markup ?? ''}${rendered.pathsMarkup}`, viewBox, snapshotJson);
}

/**
 * A page image pre-encoded as SVG markup.
 *
 * Produced asynchronously by `bake-background.ts` (reading the file and
 * re-encoding it as a compact JPEG), then handed to the synchronous renderers
 * below. Splitting it this way keeps the save path synchronous apart from one
 * awaited call, instead of making every exporter async.
 */
export interface BakedBackground {
	markup: string;
	width: number;
	height: number;
}

/**
 * Render writing strokes into a fixed-width SVG with horizontal guide lines.
 * Used for inkWriting file storage and embed preview.
 */
export function renderWritingStrokesToSvg(
	strokes: InkStroke[],
	snapshot: InkCanvasSnapshot,
	pageWidth: number,
	padding: number = 0,
	background?: BakedBackground,
): string {
	const lineHeight = snapshot.writingLineHeight ?? WRITING_LINE_HEIGHT;
	const rendered = renderStrokePathsAndBounds(strokes);
	let height = WRITING_MIN_PAGE_HEIGHT;
	if (strokes.length > 0) {
		const numFilledLines = Math.ceil((rendered.bounds.maxY + padding) / lineHeight);
		height = Math.max((numFilledLines + 0.5) * lineHeight, WRITING_MIN_PAGE_HEIGHT);
	}

	const margin = pageWidth * 0.05;
	let guideMarkup = '';
	const lineCount = Math.floor(height / lineHeight);
	for (let i = 1; i <= lineCount; i++) {
		const y = i * lineHeight;
		guideMarkup += `<line x1="${margin}" y1="${y}" x2="${pageWidth - margin}" y2="${y}" stroke="${DEFAULT_CONTENT_COLOUR_WRITING_LINE}" stroke-opacity="0.3" class="${INK_SVG_WRITING_LINE_CLASS}" />\n`;
	}

	const viewBox = `0 0 ${pageWidth} ${height}`;
	return buildSvgString(`${background?.markup ?? ''}${guideMarkup}${rendered.pathsMarkup}`, viewBox, snapshot);
}


/**
 * Baked-in ink colour for a saved SVG.
 *
 * `currentColor` only resolves inside the editor (it inherits the theme's text
 * colour), so a standalone `.svg` file would render nothing. Every brush except
 * the highlighter therefore bakes to the print-safe black; a colour the user
 * explicitly picked is kept so coloured notes survive a round trip.
 */
function resolvedStrokeColour(stroke: InkStroke): string {
	const colour = stroke.style.color;
	if (colour && colour !== 'currentColor') return colour;
	// A brush can ship its own ink (the highlighter is yellow). Falling back to
	// black here is what made highlighter strokes render as a 32% grey wash in
	// the locked preview: the editor resolved `currentColor` against the theme
	// text colour, the exported SVG resolved it against print-safe black.
	const presetColour = resolveBrushPreset(stroke.style.brush).defaultColour;
	if (presetColour && presetColour !== 'currentColor') return presetColour;
	return DEFAULT_CONTENT_COLOUR_PRIMARY_STROKE;
}

function buildStrokePathMarkup(
	d: string,
	offsetX: number,
	offsetY: number,
	stroke: InkStroke,
): string {
	const opacity = stroke.style.opacity;
	const opacityAttr = typeof opacity === 'number' && opacity < 1
		? ` fill-opacity="${Math.max(0, Math.min(1, opacity)).toFixed(3)}"`
		: '';
	const pathAttrs = `d="${d}" fill="${resolvedStrokeColour(stroke)}"${opacityAttr} class="${INK_SVG_STROKE_PATH_CLASS}"`;
	const hasOffset = offsetX !== 0 || offsetY !== 0;
	if (hasOffset) {
		return `<g transform="translate(${offsetX},${offsetY})"><path ${pathAttrs} /></g>\n`;
	}
	return `<path ${pathAttrs} />\n`;
}

// Building the full SVG document
///////////////////////////

function buildSvgString(
	pathsMarkup: string,
	viewBox: string,
	snapshotJson: InkCanvasSnapshot,
): string {
	const metadataJson = JSON.stringify(snapshotJson);

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
		`<metadata>`,
		`<ink-canvas version="${INK_CANVAS_FORMAT_VERSION}">${escapeXmlText(metadataJson)}</ink-canvas>`,
		`</metadata>`,
		pathsMarkup,
		`</svg>`,
	].join('\n');
}

function escapeXmlText(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function renderStrokePathsAndBounds(strokes: InkStroke[]): {
	pathsMarkup: string;
	bounds: StrokeBounds;
} {
	if (strokes.length === 0) {
		return {
			pathsMarkup: '',
			bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
		};
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let pathsMarkup = '';

	for (const stroke of strokes) {
		const rendered = getRenderedStrokeData(stroke);
		const strokeMinX = rendered.bounds.minX + stroke.offset.x;
		const strokeMinY = rendered.bounds.minY + stroke.offset.y;
		const strokeMaxX = rendered.bounds.maxX + stroke.offset.x;
		const strokeMaxY = rendered.bounds.maxY + stroke.offset.y;
		if (strokeMinX < minX) minX = strokeMinX;
		if (strokeMinY < minY) minY = strokeMinY;
		if (strokeMaxX > maxX) maxX = strokeMaxX;
		if (strokeMaxY > maxY) maxY = strokeMaxY;
		pathsMarkup += buildStrokePathMarkup(rendered.pathD, stroke.offset.x, stroke.offset.y, stroke);
	}

	return {
		pathsMarkup,
		bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
	};
}


// Bounds calculation
///////////////////////////

export interface StrokeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	width: number;
	height: number;
}

export function computeStrokesBounds(strokes: InkStroke[]): StrokeBounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const stroke of strokes) {
		const rendered = getRenderedStrokeData(stroke);
		const strokeMinX = rendered.bounds.minX + stroke.offset.x;
		const strokeMinY = rendered.bounds.minY + stroke.offset.y;
		const strokeMaxX = rendered.bounds.maxX + stroke.offset.x;
		const strokeMaxY = rendered.bounds.maxY + stroke.offset.y;
		if (strokeMinX < minX) minX = strokeMinX;
		if (strokeMinY < minY) minY = strokeMinY;
		if (strokeMaxX > maxX) maxX = strokeMaxX;
		if (strokeMaxY > maxY) maxY = strokeMaxY;
	}

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	};
}
