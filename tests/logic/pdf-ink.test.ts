import type { InkPoint } from 'src/ink-canvas/types';
import {
	createEmptyPdfInkDocument,
	fromPageSpace,
	toPageSpace,
} from 'src/logic/md-ink/pdf-ink-types';
import { parsePdfInkDocument, pdfInkFilePath } from 'src/logic/md-ink/pdf-ink-manager';

//////////
//////////

describe('pdf ink page-space conversion', () => {
	const points: InkPoint[] = [[100, 50, 0.5], [300, 150, 0.9]];

	it('normalises pixel coordinates to 0–1', () => {
		const normalised = toPageSpace(points, 400, 200);
		expect(normalised[0][0]).toBeCloseTo(0.25);
		expect(normalised[0][1]).toBeCloseTo(0.25);
		expect(normalised[1][0]).toBeCloseTo(0.75);
		expect(normalised[1][1]).toBeCloseTo(0.75);
	});

	it('preserves pressure untouched', () => {
		const normalised = toPageSpace(points, 400, 200);
		expect(normalised[1][2]).toBe(0.9);
	});

	it('round-trips at the same page size', () => {
		const back = fromPageSpace(toPageSpace(points, 400, 200), 400, 200);
		expect(back[0][0]).toBeCloseTo(100);
		expect(back[1][1]).toBeCloseTo(150);
	});

	it('re-projects onto a zoomed page box', () => {
		const normalised = toPageSpace(points, 400, 200);
		const zoomed = fromPageSpace(normalised, 800, 400);
		// Same relative position, twice the pixels.
		expect(zoomed[0][0]).toBeCloseTo(200);
		expect(zoomed[1][1]).toBeCloseTo(300);
	});

	it('returns no points for a zero-sized page', () => {
		expect(toPageSpace(points, 0, 0)).toHaveLength(0);
	});
});

describe('pdf ink document storage', () => {
	it('builds a namespaced file path', () => {
		expect(pdfInkFilePath('讲义/Lecture 2.pdf')).toMatch(/^\.bimo\/pdf-ink\/[0-9a-f]{8}\.json$/);
	});

	it('keeps well-formed strokes', () => {
		const raw = JSON.stringify({
			version: 1,
			strokes: [
				{ id: 'a', page: 1, points: [[0.1, 0.2, 0.5]], style: { size: 0.01 } },
				{ id: 'b', page: 2, points: [], style: {} },
				{ id: 'c' },
			],
		});
		const doc = parsePdfInkDocument(raw, 'x.pdf');
		expect(doc.strokes.map((s) => s.id)).toEqual(['a', 'b']);
	});

	it('survives corrupt JSON', () => {
		expect(parsePdfInkDocument('}', 'x.pdf').strokes).toHaveLength(0);
	});

	it('starts empty for a new pdf', () => {
		const doc = createEmptyPdfInkDocument('lecture.pdf');
		expect(doc.strokes).toEqual([]);
		expect(doc.pdfPath).toBe('lecture.pdf');
	});

	it('returns an empty document when stored pdfPath mismatches (hash collision guard)', () => {
		const raw = JSON.stringify({
			version: 1,
			pdfPath: 'other.pdf',
			strokes: [{ id: 'a', page: 1, points: [[0.1, 0.2, 0.5]], style: { size: 0.01 } }],
		});
		const doc = parsePdfInkDocument(raw, 'lecture.pdf');
		expect(doc.strokes).toHaveLength(0);
		expect(doc.pdfPath).toBe('lecture.pdf');
	});
});
