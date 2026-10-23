import { buildExcalidrawScene } from 'src/logic/export/excalidraw-export';
import type { InkStroke } from 'src/ink-canvas/types';

//////////
//////////

function makeStroke(overrides: Partial<InkStroke> = {}): InkStroke {
	return {
		id: 's_test_1',
		points: [
			[10, 20, 0.5],
			[30, 40, 0.7],
			[50, 25, 0.6],
		],
		style: {
			size: 4,
			thinning: 0.6,
			smoothing: 0.1,
			streamline: 0,
			simulatePressure: false,
			color: 'currentColor',
		},
		offset: { x: 0, y: 0 },
		...overrides,
	};
}

function parse(scene: string) {
	return JSON.parse(scene) as {
		type: string;
		version: number;
		elements: Array<Record<string, unknown>>;
	};
}

describe('buildExcalidrawScene', () => {
	it('emits an empty but valid scene for no strokes', () => {
		const scene = parse(buildExcalidrawScene([]));
		expect(scene.type).toBe('excalidraw');
		expect(scene.version).toBe(2);
		expect(scene.elements).toHaveLength(0);
	});

	it('emits one freedraw element per stroke', () => {
		const scene = parse(buildExcalidrawScene([makeStroke(), makeStroke({ id: 's_test_2' })]));
		expect(scene.elements).toHaveLength(2);
		expect(scene.elements[0].type).toBe('freedraw');
	});

	it('anchors the element at the stroke minimum and stores relative points', () => {
		const scene = parse(buildExcalidrawScene([makeStroke()]));
		const element = scene.elements[0];
		// min x = 10, min y = 20 → origin moves there, first point becomes [0, 0].
		expect(element.x).toBe(10);
		expect(element.y).toBe(20);
		expect(element.points).toEqual([
			[0, 0],
			[20, 20],
			[40, 5],
		]);
	});

	it('includes the stroke offset in the element origin', () => {
		const scene = parse(buildExcalidrawScene([
			makeStroke({ offset: { x: 5, y: -3 } }),
		]));
		expect(scene.elements[0].x).toBe(15);
		expect(scene.elements[0].y).toBe(17);
	});

	it('bakes theme ink to the Excalidraw default instead of currentColor', () => {
		const scene = parse(buildExcalidrawScene([makeStroke()]));
		expect(scene.elements[0].strokeColor).toBe('#1e1e1e');
	});

	it('keeps an explicit stroke colour', () => {
		const stroke = makeStroke();
		stroke.style = { ...stroke.style, color: '#ffd400' };
		const scene = parse(buildExcalidrawScene([stroke]));
		expect(scene.elements[0].strokeColor).toBe('#ffd400');
	});

	it('maps 0–1 opacity onto Excalidraw 0–100', () => {
		const stroke = makeStroke();
		stroke.style = { ...stroke.style, opacity: 0.32 };
		const scene = parse(buildExcalidrawScene([stroke]));
		expect(scene.elements[0].opacity).toBe(32);
	});

	it('defaults opacity to 100 when the stroke has none', () => {
		const scene = parse(buildExcalidrawScene([makeStroke()]));
		expect(scene.elements[0].opacity).toBe(100);
	});

	it('carries stored pressures through instead of re-simulating them', () => {
		const scene = parse(buildExcalidrawScene([makeStroke()]));
		expect(scene.elements[0].pressures).toEqual([0.5, 0.7, 0.6]);
		expect(scene.elements[0].simulatePressure).toBe(false);
	});

	it('produces identical output for identical strokes', () => {
		const first = buildExcalidrawScene([makeStroke()]);
		const second = buildExcalidrawScene([makeStroke()]);
		expect(first).toBe(second);
	});
});
