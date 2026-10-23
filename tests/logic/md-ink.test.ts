import {
	createEmptyMdInkDocument,
	dotPath,
	fingerprintLine,
	resolveAnchorLine,
	type MdInkStroke,
} from 'src/logic/md-ink/types';
import {
	mdInkFilePath,
	mdInkFileKey,
	parseMdInkDocument,
	serializeMdInkDocument,
} from 'src/logic/md-ink/md-ink-store';

//////////
//////////

function strokeAtLine(line: number, lineText: string): MdInkStroke {
	return {
		id: `s${line}`,
		points: [[0, 0, 0.5], [10, 10, 0.5]],
		style: { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true, color: 'currentColor' },
		anchor: { line, lineText },
		offset: { x: 0, y: 0 },
		createdAt: 0,
	};
}

describe('dotPath', () => {
	it('produces a closed circle path at the point', () => {
		const d = dotPath(100, 50, 4);
		expect(d).toContain('M 96 50');
		// Two arcs in opposite directions close the circle.
		expect(d.match(/a /g)).toHaveLength(2);
	});

	it('never degenerates below a visible size', () => {
		// A zero-radius path renders nothing, which would look like lost ink.
		expect(dotPath(0, 0, 0)).toContain('M -0.6 0');
	});
});

describe('md-ink fingerprinting', () => {
	it('trims and truncates so formatting noise does not break matching', () => {
		expect(fingerprintLine('  ## Heading  ')).toBe('## Heading');
		expect(fingerprintLine('x'.repeat(200))).toHaveLength(120);
	});
});

describe('resolveAnchorLine', () => {
	const doc = ['# Title', '', 'First paragraph.', 'Second paragraph.'];

	it('keeps the stored line when the text still matches', () => {
		expect(resolveAnchorLine(doc, { line: 3, lineText: 'First paragraph.' })).toBe(2);
	});

	it('follows the text when paragraphs are inserted above', () => {
		const shifted = ['# Title', '', 'New intro.', '', 'First paragraph.', 'Second paragraph.'];
		expect(resolveAnchorLine(shifted, { line: 3, lineText: 'First paragraph.' })).toBe(4);
	});

	it('picks the nearest match when a line is repeated', () => {
		const repeated = ['', 'a', '', 'b', '', 'c'];
		// Stored at line 1 (index 0); index 2 and 4 also hold "".
		expect(resolveAnchorLine(repeated, { line: 1, lineText: '' })).toBe(0);
		const storedLow = ['', 'a', '', 'b', ''];
		expect(resolveAnchorLine(storedLow, { line: 5, lineText: '' })).toBe(4);
	});

	it('returns null when the source line was edited away', () => {
		expect(resolveAnchorLine(['completely different'], { line: 3, lineText: 'First paragraph.' })).toBeNull();
	});

	it('falls back to the stored index when the line was blank', () => {
		expect(resolveAnchorLine(['a', 'b'], { line: 2, lineText: '' })).toBe(1);
	});

	it('returns null for a line past the end of the document', () => {
		expect(resolveAnchorLine(['only'], { line: 9, lineText: '' })).toBeNull();
	});
});

describe('md-ink storage keys', () => {
	it('is stable for the same path', () => {
		expect(mdInkFileKey('03-Maps/Home.md')).toBe(mdInkFileKey('03-Maps/Home.md'));
	});

	it('differs across paths and survives path separators', () => {
		expect(mdInkFileKey('a/b.md')).not.toBe(mdInkFileKey('a/c.md'));
		expect(mdInkFilePath('a/b.md')).toMatch(/^\.bimo\/md-ink\/[0-9a-f]{8}\.json$/);
	});
});

describe('md-ink document round-trip', () => {
	it('serialises and parses back the strokes', () => {
		const doc = createEmptyMdInkDocument('notes/Test.md');
		doc.paper = 'grid';
		doc.strokes.push(strokeAtLine(2, 'hello'));

		const restored = parseMdInkDocument(serializeMdInkDocument(doc), 'notes/Test.md');
		expect(restored.paper).toBe('grid');
		expect(restored.strokes).toHaveLength(1);
		expect(restored.strokes[0].anchor.lineText).toBe('hello');
	});

	it('returns an empty document for corrupt JSON instead of throwing', () => {
		const restored = parseMdInkDocument('{not json', 'notes/Test.md');
		expect(restored.strokes).toHaveLength(0);
		expect(restored.notePath).toBe('notes/Test.md');
	});

	it('drops strokes that are missing geometry', () => {
		const restored = parseMdInkDocument(
			JSON.stringify({ version: 1, paper: 'none', strokes: [{ id: 'x' }, strokeAtLine(1, 'ok')] }),
			'notes/Test.md',
		);
		expect(restored.strokes).toHaveLength(1);
	});

	it('falls back to no paper for an unknown value', () => {
		const restored = parseMdInkDocument(JSON.stringify({ version: 1, paper: 'marble', strokes: [] }), 'a.md');
		expect(restored.paper).toBe('none');
	});

	it('returns an empty document when stored notePath mismatches (hash collision guard)', () => {
		const doc = createEmptyMdInkDocument('notes/Original.md');
		doc.strokes.push(strokeAtLine(1, 'secret'));
		const restored = parseMdInkDocument(serializeMdInkDocument(doc), 'notes/Colliding.md');
		expect(restored.strokes).toHaveLength(0);
		expect(restored.notePath).toBe('notes/Colliding.md');
	});
});
