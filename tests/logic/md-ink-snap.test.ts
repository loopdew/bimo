import type { InkPoint } from 'src/ink-canvas/types';
import {
	snapStrokePoints,
	snapToRectangle,
	snapToStraightLine,
} from 'src/logic/md-ink/types';

//////////
//////////

/** A straight run with a small wobble, as a hand actually draws it. */
function wobblyLine(wobble: number, count = 12): InkPoint[] {
	const points: InkPoint[] = [];
	for (let i = 0; i < count; i++) {
		const t = i / (count - 1);
		points.push([100 + t * 200, 100 + Math.sin(i) * wobble, 0.5]);
	}
	return points;
}

/** A closed-ish box drawn in four runs, ends nearly meeting. */
function boxStroke(gapPx: number): InkPoint[] {
	return [
		[100, 100, 0.5],
		[200, 101, 0.5],
		[300, 100, 0.5],
		[301, 200, 0.5],
		[300, 300, 0.5],
		[200, 299, 0.5],
		[100, 300, 0.5],
		[99, 200, 0.5],
		[100 + gapPx, 100 + gapPx, 0.5],
	];
}

describe('snapToStraightLine', () => {
	it('straightens a nearly straight run into two points', () => {
		const snapped = snapToStraightLine(wobblyLine(1.5), 6);
		expect(snapped).not.toBeNull();
		expect(snapped!).toHaveLength(2);
		expect(snapped![0][0]).toBeCloseTo(100);
		expect(snapped![1][0]).toBeCloseTo(300);
	});

	it('leaves a genuinely curved stroke alone', () => {
		expect(snapToStraightLine(wobblyLine(30), 6)).toBeNull();
	});

	it('ignores strokes too short to be deliberate', () => {
		const tiny: InkPoint[] = [[0, 0, 0.5], [5, 1, 0.5], [10, 0, 0.5]];
		expect(snapToStraightLine(tiny, 6)).toBeNull();
	});

	it('preserves the average pressure', () => {
		const points: InkPoint[] = [[0, 0, 0.2], [50, 0, 0.4], [100, 0, 0.6]];
		const snapped = snapToStraightLine(points, 6);
		expect(snapped![0][2]).toBeCloseTo(0.4);
		expect(snapped![1][2]).toBeCloseTo(0.4);
	});
});

describe('snapToRectangle', () => {
	it('closes a box whose ends nearly meet', () => {
		const snapped = snapToRectangle(boxStroke(4), 8);
		expect(snapped).not.toBeNull();
		// Four corners plus the closing point.
		expect(snapped!).toHaveLength(5);
		// The bounding box of the drawn points, wobble included.
		expect(snapped![0][0]).toBeCloseTo(99);
		expect(snapped![1][0]).toBeCloseTo(301);
	});

	it('refuses an obviously open path', () => {
		const open: InkPoint[] = [[0, 0, 0.5], [100, 0, 0.5], [100, 100, 0.5], [0, 100, 0.5]];
		expect(snapToRectangle(open, 8)).toBeNull();
	});

	it('refuses a sliver that is not a box', () => {
		const sliver: InkPoint[] = [
			[0, 0, 0.5], [100, 0, 0.5], [100, 4, 0.5], [0, 4, 0.5], [0, 0, 0.5],
		];
		expect(snapToRectangle(sliver, 8)).toBeNull();
	});
});

describe('snapStrokePoints', () => {
	it('prefers the rectangle when the stroke closes', () => {
		const snapped = snapStrokePoints(boxStroke(4), 8);
		expect(snapped).toHaveLength(5);
	});

	it('falls back to a line for an open run', () => {
		expect(snapStrokePoints(wobblyLine(1.5), 6)).toHaveLength(2);
	});

	it('returns the original points when nothing fits', () => {
		const curved = wobblyLine(40);
		expect(snapStrokePoints(curved, 6)).toBe(curved);
	});

	it('passes very short strokes through untouched', () => {
		const two: InkPoint[] = [[0, 0, 0.5], [10, 10, 0.5]];
		expect(snapStrokePoints(two, 6)).toBe(two);
	});
});
