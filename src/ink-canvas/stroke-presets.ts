import type { ResolvedStrokeInputTreatAs } from 'src/logic/device-settings/device-settings-types';
import type { InkStrokeStyle } from './types';
import { resolveBrushPreset } from './brush-presets';
import {
	clampCaptureZoom,
	INK_STROKE_ZOOM_REFERENCE,
	numericForCaptureZoom,
} from './stroke-zoom-scale';

/**
 * Pen @ 1× — `streamline: 0` for a faithful, pen-following stroke. Live preview and the committed
 * stroke render the same `points` through the same `getStroke(points, toStrokeOptions(style))` call,
 * so this value applies to both equally (WYSIWYG) — see `ink-canvas-live-drawing.md`.
 * At zoom-**out**, `streamline` lerps toward the zoom-out target
 * (`STREAMLINE_SMOOTHING_ZOOM_OUT_TARGET.pen`) for both layers together, since the scaled value lives
 * on `style`.
 */
export const PEN_NUMERIC_STROKE_PARTIAL: Pick<
	InkStrokeStyle,
	'thinning' | 'smoothing' | 'streamline' | 'simulatePressure'
> = {
	thinning: 0.6,
	smoothing: 0.1,
	streamline: 0,
	simulatePressure: false,
};

/** Mouse @ 1× — zoom-out target 0.4 at 0.1× (+0.2 vs reference). */
export const MOUSE_NUMERIC_STROKE_PARTIAL: Pick<
	InkStrokeStyle,
	'thinning' | 'smoothing' | 'streamline' | 'simulatePressure'
> = {
	thinning: 0.6,
	smoothing: 0.4,
	streamline: 0.4,
	simulatePressure: true,
};

/** Multiply editor stroke width when using mouse treat-as (simulated stroke reads narrower than pen). */
// 1.6 matches optically to mouse in pen setting, but not necessarily pen in pen setting.
// TODO: We should let pen as pen be 1, but mouse as pen should be 1.6
export const OPTICAL_MOUSE_TO_PEN_RATIO = 1.8;

/**
 * Builds a full stroke style for persistence: merges the brush preset with the
 * pen/mouse numeric split and the user-chosen size and colour from the editor toolbar.
 *
 * Resolution order for each numeric:
 * 1. the brush preset owns `thinning` / `streamline` / `opacity` / size multiplier —
 *    a highlighter must stay flat (no thinning) even on a pressure-sensitive pen;
 * 2. the pen/mouse split still owns `smoothing` (mouse input needs more of it to
 *    look human) and `simulatePressure`;
 * 3. the user's size and colour win over the brush defaults.
 *
 * A stroke with no `brush` key resolves to `pen`, which reproduces the upstream
 * numbers exactly — legacy files and 绘图 mode keep their original feel.
 */
export function buildInkStrokeStyleForTreatAs(
	base: InkStrokeStyle,
	treatAs: ResolvedStrokeInputTreatAs,
	captureZoom: number = INK_STROKE_ZOOM_REFERENCE,
): InkStrokeStyle {
	const preset = resolveBrushPreset(base.brush);
	const treatAsPen = treatAs === 'pen';
	const numeric =
		treatAsPen ? PEN_NUMERIC_STROKE_PARTIAL : MOUSE_NUMERIC_STROKE_PARTIAL;
	const size = treatAs === 'mouse'
		? base.size * OPTICAL_MOUSE_TO_PEN_RATIO
		: base.size;
	const zoom = clampCaptureZoom(captureZoom);
	// The default pen must stay byte-identical to upstream for both input kinds, so
	// its streamline comes from the pen/mouse split. Every other brush brings its own
	// lag curve, floored by the mouse value so a mouse-drawn highlighter still smooths.
	const streamline = preset.kind === 'pen'
		? numeric.streamline
		: Math.max(preset.streamline, numeric.streamline);
	return {
		...base,
		...numeric,
		// Brush owns thinning (a highlighter stays flat even under pen pressure).
		thinning: preset.thinning,
		opacity: preset.opacity,
		size: size * preset.sizeMultiplier,
		streamline: numericForCaptureZoom(streamline, zoom, treatAs),
		smoothing: numericForCaptureZoom(
			treatAsPen ? preset.smoothing : Math.max(numeric.smoothing, preset.smoothing),
			zoom,
			treatAs,
		),
		inputKind: treatAs,
		captureZoom: zoom,
	};
}
