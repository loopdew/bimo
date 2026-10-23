import {
	buildInkStrokeStyleForTreatAs,
	PEN_NUMERIC_STROKE_PARTIAL,
	MOUSE_NUMERIC_STROKE_PARTIAL,
	OPTICAL_MOUSE_TO_PEN_RATIO,
} from 'src/ink-canvas/stroke-presets';
import {
	getBrushPreset,
	isInkBrushKind,
	nearestBrushSizeStep,
	resolveBrushPreset,
	INK_BRUSH_PRESETS,
} from 'src/ink-canvas/brush-presets';
import type { InkStrokeStyle } from 'src/ink-canvas/types';

//////////
//////////

const baseStyle: InkStrokeStyle = {
	size: 4,
	thinning: 0.5,
	smoothing: 0.5,
	streamline: 0.5,
	simulatePressure: true,
	color: 'currentColor',
};

describe('brush presets', () => {
	it('recognises every shipped brush and rejects junk', () => {
		for (const preset of INK_BRUSH_PRESETS) {
			expect(isInkBrushKind(preset.kind)).toBe(true);
		}
		expect(isInkBrushKind('charcoal')).toBe(false);
		expect(isInkBrushKind(undefined)).toBe(false);
	});

	it('falls back to the pen for legacy strokes with no brush key', () => {
		expect(resolveBrushPreset(undefined).kind).toBe('pen');
		expect(resolveBrushPreset('nope').kind).toBe('pen');
	});

	it('snaps an arbitrary size onto the nearest exposed step', () => {
		expect(nearestBrushSizeStep(2.4)).toBe(2.5);
		expect(nearestBrushSizeStep(4.1)).toBe(4);
		expect(nearestBrushSizeStep(6.9)).toBe(7);
	});
});

describe('buildInkStrokeStyleForTreatAs with a brush', () => {
	it('reproduces the upstream pen numbers exactly when no brush is set', () => {
		const style = buildInkStrokeStyleForTreatAs(baseStyle, 'pen', 1);
		expect(style.thinning).toBe(PEN_NUMERIC_STROKE_PARTIAL.thinning);
		expect(style.smoothing).toBe(PEN_NUMERIC_STROKE_PARTIAL.smoothing);
		expect(style.streamline).toBe(PEN_NUMERIC_STROKE_PARTIAL.streamline);
		expect(style.size).toBe(4);
		expect(style.opacity).toBe(1);
	});

	it('reproduces the upstream mouse numbers exactly when no brush is set', () => {
		const style = buildInkStrokeStyleForTreatAs(baseStyle, 'mouse', 1);
		expect(style.smoothing).toBe(MOUSE_NUMERIC_STROKE_PARTIAL.smoothing);
		expect(style.streamline).toBe(MOUSE_NUMERIC_STROKE_PARTIAL.streamline);
		expect(style.size).toBe(4 * OPTICAL_MOUSE_TO_PEN_RATIO);
		expect(style.simulatePressure).toBe(true);
		expect(style.inputKind).toBe('mouse');
	});

	it('keeps a highlighter flat and translucent on a pressure-sensitive pen', () => {
		const style = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'highlighter' }, 'pen', 1);
		expect(style.thinning).toBe(0);
		expect(style.opacity).toBe(getBrushPreset('highlighter').opacity);
		expect(style.opacity).toBeLessThan(1);
	});

	it('scales the pencil below the shared size slider', () => {
		const pencil = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'pencil' }, 'pen', 1);
		const pen = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'pen' }, 'pen', 1);
		expect(pencil.size).toBeLessThan(pen.size);
	});

	it('scales the marker and highlighter above the shared size slider', () => {
		const pen = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'pen' }, 'pen', 1);
		const marker = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'marker' }, 'pen', 1);
		const highlighter = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'highlighter' }, 'pen', 1);
		expect(marker.size).toBeGreaterThan(pen.size);
		expect(highlighter.size).toBeGreaterThan(marker.size);
	});

	it('lets a brush override the mouse smoothing floor only upwards', () => {
		const pen = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'pen' }, 'mouse', 1);
		const highlighter = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'highlighter' }, 'mouse', 1);
		expect(pen.smoothing).toBe(MOUSE_NUMERIC_STROKE_PARTIAL.smoothing);
		expect(highlighter.smoothing).toBeGreaterThanOrEqual(MOUSE_NUMERIC_STROKE_PARTIAL.smoothing);
	});

	it('keeps the user colour across brush switches', () => {
		const style = buildInkStrokeStyleForTreatAs(
			{ ...baseStyle, brush: 'highlighter', color: '#e5484d' },
			'pen',
			1,
		);
		expect(style.color).toBe('#e5484d');
	});

	it('records which brush authored the stroke for persistence', () => {
		const style = buildInkStrokeStyleForTreatAs({ ...baseStyle, brush: 'brush' }, 'pen', 1);
		expect(style.brush).toBe('brush');
	});
});
