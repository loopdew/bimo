import { mergeMdInkDocuments, type MdInkDocument, type MdInkStroke } from 'src/logic/md-ink/types';

//////////
//////////

/**
 * Regression cover for the data-loss path behind the three zero-stroke JSON
 * files in `.bimo/`.
 *
 * The disk read is asynchronous and the previous code replaced the in-memory
 * document unconditionally — both when hydrating (deleting a stroke drawn in
 * the meantime) and during teardown (writing an empty document over a real
 * one). These tests pin the merge rule that makes both safe.
 */

function stroke(id: string): MdInkStroke {
	return {
		id,
		points: [
			[0, 0, 0.5],
			[10, 10, 0.5],
		],
		style: { brush: 'pen', colour: '#000', size: 1 } as unknown as MdInkStroke['style'],
		anchorLine: 1,
		anchorText: 'line',
		offset: { x: 0, y: 0 },
	} as unknown as MdInkStroke;
}

function doc(notePath: string, ids: string[]): MdInkDocument {
	return {
		version: 1,
		notePath,
		paper: 'none',
		strokes: ids.map(stroke),
		updatedAt: 1,
	} as MdInkDocument;
}

describe('mergeMdInkDocuments', () => {
	test('an empty in-memory document takes the disk copy verbatim', () => {
		const merged = mergeMdInkDocuments(doc('A.md', []), doc('A.md', ['disk-1', 'disk-2']));
		expect(merged.strokes.map((s) => s.id)).toEqual(['disk-1', 'disk-2']);
	});

	test('a stroke drawn before the read resolved is not deleted', () => {
		const merged = mergeMdInkDocuments(doc('A.md', ['local-1']), doc('A.md', ['disk-1']));
		expect(merged.strokes.map((s) => s.id)).toEqual(['disk-1', 'local-1']);
	});

	test('keeps both sides when they do not overlap', () => {
		const merged = mergeMdInkDocuments(doc('A.md', ['local-1', 'local-2']), doc('A.md', ['disk-1']));
		expect(merged.strokes).toHaveLength(3);
	});

	test('never duplicates a stroke present in both', () => {
		const merged = mergeMdInkDocuments(doc('A.md', ['same']), doc('A.md', ['same']));
		expect(merged.strokes.map((s) => s.id)).toEqual(['same']);
	});

	test('keeps the disk document metadata', () => {
		const merged = mergeMdInkDocuments(doc('A.md', ['local-1']), {
			...doc('A.md', []),
			paper: 'grid',
			updatedAt: 99,
		} as MdInkDocument);
		expect(merged.paper).toBe('grid');
		expect(merged.updatedAt).toBe(99);
	});
});
