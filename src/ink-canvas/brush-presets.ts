///////////////////////////
///////////////////////////

/**
 * Brush presets layered on top of perfect-freehand.
 *
 * Upstream 笔墨 ships exactly one brush feel: `buildInkStrokeStyleForTreatAs`
 * derives every numeric from the pen/mouse split, and the stroke store has no
 * notion of "which tool made this". 笔墨 adds a brush identity per stroke so a
 * page can mix pencil notes, a marker heading and a highlighter wash.
 *
 * Everything here is persisted inside `InkStrokeStyle`, which is already
 * JSON-serialised into every saved `.svg` — so old files keep loading unchanged
 * (missing `brush` means `pen`) and new files stay readable by upstream 笔墨,
 * which simply ignores the extra keys.
 */
export type InkBrushKind = 'pen' | 'pencil' | 'technical' | 'marker' | 'highlighter' | 'crayon' | 'brush';

export interface InkBrushPreset {
	kind: InkBrushKind;
	/** English source string; doubles as the i18n key (see src/i18n). */
	label: string;
	/** Multiplier applied to the toolbar size, so one slider serves every brush. */
	sizeMultiplier: number;
	/** perfect-freehand `thinning` — how much pressure narrows the stroke. */
	thinning: number;
	/** perfect-freehand `smoothing`. */
	smoothing: number;
	/** perfect-freehand `streamline` — how far the path lags the pointer. */
	streamline: number;
	/** Fill opacity baked onto the rendered path (highlighter is translucent). */
	opacity: number;
	/** Colour used when the user has not picked one. `currentColor` follows the theme. */
	defaultColour: string;
}

/**
 * Ordered the way they appear in the toolbar. Sizes are relative to the shared
 * size slider: a highlighter drawn at "medium" is meant to cover a whole line.
 */
export const INK_BRUSH_PRESETS: readonly InkBrushPreset[] = [
	{
		kind: 'pen',
		label: 'Fountain pen',
		sizeMultiplier: 1,
		thinning: 0.6,
		smoothing: 0.1,
		streamline: 0,
		opacity: 1,
		defaultColour: 'currentColor',
	},
	{
		kind: 'pencil',
		label: 'Pencil',
		sizeMultiplier: 0.65,
		thinning: 0.9,
		smoothing: 0.18,
		streamline: 0.12,
		opacity: 0.82,
		defaultColour: 'currentColor',
	},
	{
		kind: 'technical',
		label: 'Technical pen',
		// Almost no pressure response and a small size: the "engineer's pen" look,
		// for labelled diagrams where varying line weight is noise.
		sizeMultiplier: 0.8,
		thinning: 0.05,
		smoothing: 0.06,
		streamline: 0,
		opacity: 1,
		defaultColour: 'currentColor',
	},
	{
		kind: 'marker',
		label: 'Marker',
		sizeMultiplier: 1.9,
		thinning: 0.12,
		smoothing: 0.42,
		streamline: 0.45,
		opacity: 0.95,
		defaultColour: 'currentColor',
	},
	{
		kind: 'highlighter',
		label: 'Highlighter',
		sizeMultiplier: 3.4,
		thinning: 0,
		smoothing: 0.55,
		streamline: 0.55,
		opacity: 0.32,
		defaultColour: '#ffd400',
	},
	{
		kind: 'crayon',
		label: 'Crayon',
		// Wide, soft and noticeably see-through — the closest this model gets to a
		// waxy texture, since perfect-freehand has no grain parameter.
		sizeMultiplier: 1.5,
		thinning: 0.35,
		smoothing: 0.7,
		streamline: 0.5,
		opacity: 0.72,
		defaultColour: 'currentColor',
	},
	{
		kind: 'brush',
		label: 'Brush pen',
		sizeMultiplier: 2.2,
		thinning: 0.88,
		smoothing: 0.55,
		streamline: 0.3,
		opacity: 1,
		defaultColour: 'currentColor',
	},
];

const PRESETS_BY_KIND: Record<InkBrushKind, InkBrushPreset> = INK_BRUSH_PRESETS.reduce(
	(acc, preset) => {
		acc[preset.kind] = preset;
		return acc;
	},
	{} as Record<InkBrushKind, InkBrushPreset>,
);

export function isInkBrushKind(value: unknown): value is InkBrushKind {
	return typeof value === 'string' && value in PRESETS_BY_KIND;
}

/** Unknown or legacy values fall back to the pen, never throw. */
export function resolveBrushPreset(kind: string | undefined): InkBrushPreset {
	return isInkBrushKind(kind) ? PRESETS_BY_KIND[kind] : PRESETS_BY_KIND.pen;
}

export function getBrushPreset(kind: InkBrushKind): InkBrushPreset {
	return PRESETS_BY_KIND[kind];
}

/** Swatches offered next to the brush picker. `currentColor` is the theme ink. */
export const INK_BRUSH_SWATCHES: readonly string[] = [
	'currentColor',
	'#e5484d',
	'#f76b15',
	'#ffd400',
	'#30a46c',
	'#0090ff',
	'#8e4ec6',
];

/** Size steps exposed as three increments of the shared size slider. */
export const INK_BRUSH_SIZE_STEPS: readonly number[] = [2.5, 4, 7];

/**
 * True when a page carries strokes whose colour would be baked differently now
 * than when they were saved.
 *
 * Background: before the colour fix, a highlighter stroke stored
 * `color: 'currentColor'`, and the exporter resolved that to print-safe black —
 * a 32%-opacity black wash, i.e. grey. Those files still hold `fill="black"`,
 * so they keep looking grey until they are written again. Saving the page once
 * rewrites every path, which is why this check exists rather than a migration:
 * the save path is already the fix.
 */
export function needsStrokeColourRewrite(
	strokes: ReadonlyArray<{ style?: { brush?: string; color?: string } }>,
): boolean {
	return strokes.some((stroke) => {
		const colour = stroke.style?.color;
		if (colour && colour !== 'currentColor') return false;
		const preset = resolveBrushPreset(stroke.style?.brush);
		return preset.defaultColour !== 'currentColor';
	});
}

export function nearestBrushSizeStep(size: number): number {
	let best = INK_BRUSH_SIZE_STEPS[0];
	let bestDistance = Infinity;
	for (const step of INK_BRUSH_SIZE_STEPS) {
		const distance = Math.abs(step - size);
		if (distance < bestDistance) {
			best = step;
			bestDistance = distance;
		}
	}
	return best;
}
