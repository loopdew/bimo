import {
	renderStrokesToSvg,
	renderWritingStrokesToSvg,
	type BakedBackground,
} from 'src/ink-canvas/svg-export';
import type { InkCanvasSnapshot, InkStroke } from 'src/ink-canvas/types';

//////////
//////////

const baked: BakedBackground = {
	markup: '<image href="data:image/jpeg;base64,AAAA" x="0" y="0" width="800" height="1000" />\n',
	width: 800,
	height: 1000,
};

const emptySnapshot: InkCanvasSnapshot = {
	version: 1,
	strokes: [],
	gridEnabled: false,
};

function stroke(): InkStroke {
	return {
		id: 's1',
		points: [[10, 20, 0.5], [40, 60, 0.6]],
		style: {
			size: 4,
			thinning: 0.6,
			smoothing: 0.1,
			streamline: 0,
			simulatePressure: false,
			color: 'currentColor',
		},
		offset: { x: 0, y: 0 },
	};
}

describe('background baking in svg export', () => {
	it('omits the page image when nothing is set', () => {
		const svg = renderWritingStrokesToSvg([], emptySnapshot, 2000);
		expect(svg).not.toContain('<image');
	});

	it('places the page image before the writing guide lines', () => {
		const svg = renderWritingStrokesToSvg([], emptySnapshot, 2000, 0, baked);
		const imageIndex = svg.indexOf('<image');
		const guideIndex = svg.indexOf('ink-type-writing-line');
		expect(imageIndex).toBeGreaterThan(-1);
		expect(guideIndex).toBeGreaterThan(-1);
		// Under the ink means earlier in document order.
		expect(imageIndex).toBeLessThan(guideIndex);
	});

	it('draws the page image under committed strokes', () => {
		const snapshot: InkCanvasSnapshot = { ...emptySnapshot, strokes: [stroke()] };
		const svg = renderWritingStrokesToSvg(snapshot.strokes, snapshot, 2000, 0, baked);
		expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('ink-type-stroke'));
	});

	it('sizes an otherwise empty drawing canvas from the page image', () => {
		const svg = renderStrokesToSvg([], emptySnapshot, 16, baked);
		expect(svg).toContain('viewBox="0 0 800 1000"');
		expect(svg).toContain('<image');
	});

	it('keeps the 1×1 placeholder when a drawing has neither ink nor background', () => {
		const svg = renderStrokesToSvg([], emptySnapshot);
		expect(svg).toContain('viewBox="0 0 1 1"');
	});

	it('keeps the ink-derived viewBox when both are present', () => {
		const snapshot: InkCanvasSnapshot = { ...emptySnapshot, strokes: [stroke()] };
		const svg = renderStrokesToSvg(snapshot.strokes, snapshot, 16, baked);
		// Strokes span 10..40 × 20..60 with 16 padding → 0 0 x, i.e. not the page size.
		expect(svg).not.toContain('viewBox="0 0 800 1000"');
		expect(svg).toContain('<image');
	});

	it('round-trips background and sourcePdf through the snapshot shape', () => {
		// Guards the fields that `getSnapshot()` used to drop, which silently
		// deleted the page image on the first autosave after opening.
		const snapshot: InkCanvasSnapshot = {
			...emptySnapshot,
			background: { path: 'Ink/PDF/x/p1.png', width: 800, height: 1000, opacity: 0.45 },
			sourcePdf: { path: '讲义/Lecture 3.pdf', page: '1' },
		};
		const serialised = JSON.parse(JSON.stringify(snapshot)) as InkCanvasSnapshot;
		expect(serialised.background?.path).toBe('Ink/PDF/x/p1.png');
		expect(serialised.background?.opacity).toBe(0.45);
		expect(serialised.sourcePdf?.page).toBe('1');
	});
});
