import {
	applyIndexEntries,
	buildNewIndexDocument,
	mergeEntries,
	parseExistingEntries,
} from 'src/logic/pdf/annotation-index';
import type { TFile } from 'obsidian';

//////////
//////////

const START = '<!-- bimo:pdf-index:start -->';
const END = '<!-- bimo:pdf-index:end -->';

function page(pageNumber: number, path = `Ink/Writing/p${pageNumber}.svg`) {
	return { page: pageNumber, inkFilePath: path };
}

const pdfFile = { path: '讲义/Lecture 3.pdf', basename: 'Lecture 3' } as TFile;

describe('mergeEntries', () => {
	it('sorts by page number', () => {
		const merged = mergeEntries([], [page(3), page(1), page(2)]);
		expect(merged.map((entry) => entry.page)).toEqual([1, 2, 3]);
	});

	it('lets a newer annotation replace an older one for the same page', () => {
		const merged = mergeEntries([page(2, 'old.svg')], [page(2, 'new.svg')]);
		expect(merged).toHaveLength(1);
		expect(merged[0].inkFilePath).toBe('new.svg');
	});

	it('keeps pages that were not re-annotated', () => {
		const merged = mergeEntries([page(1), page(2)], [page(3)]);
		expect(merged.map((entry) => entry.page)).toEqual([1, 2, 3]);
	});
});

describe('parseExistingEntries', () => {
	it('reads back what was written', () => {
		const markdown = applyIndexEntries('', [page(1), page(5)]);
		const parsed = parseExistingEntries(markdown);
		expect(parsed).toEqual([page(1), page(5)]);
	});

	it('ignores content outside the markers', () => {
		const markdown = [
			'# 我的批注',
			'- 12 无关的链接 [[other.md|别的]]',
			START,
			'- 第 1 页 → [[Ink/Writing/p1.svg|第 1 页]]',
			END,
			'- 99 也别读进来 [[x|y]]',
		].join('\n');
		expect(parseExistingEntries(markdown)).toEqual([page(1)]);
	});

	it('returns nothing when the markers are missing', () => {
		expect(parseExistingEntries('# 没有标记')).toEqual([]);
	});

	it('returns nothing when the markers are out of order', () => {
		expect(parseExistingEntries(`${END}\n- 第 1 页 → [[p1.svg|第 1 页]]\n${START}`)).toEqual([]);
	});
});

describe('applyIndexEntries', () => {
	it('replaces only the marker block', () => {
		const original = `前言\n\n${START}\n- 第 1 页 → [[old.svg|第 1 页]]\n${END}\n\n后记`;
		const updated = applyIndexEntries(original, [page(2)]);
		expect(updated).toContain('前言');
		expect(updated).toContain('后记');
		expect(updated).toContain('p2.svg');
		expect(updated).not.toContain('old.svg');
	});

	it('appends a block when the document has none', () => {
		const updated = applyIndexEntries('# 标题\n', [page(1)]);
		expect(updated).toContain(START);
		expect(updated).toContain(END);
		expect(updated.indexOf('# 标题')).toBeLessThan(updated.indexOf(START));
	});

	it('is idempotent for the same entries', () => {
		const once = applyIndexEntries('', [page(1), page(2)]);
		const twice = applyIndexEntries(once, [page(1), page(2)]);
		expect(twice).toBe(once);
	});

	it('adds a page-anchored link back to the PDF when the path is known', () => {
		const updated = applyIndexEntries('', [page(3)], '讲义/Lecture 3.pdf');
		expect(updated).toContain('[[讲义/Lecture 3.pdf#page=3|PDF]]');
	});

	it('omits the PDF link when no path is supplied', () => {
		const updated = applyIndexEntries('', [page(3)]);
		expect(updated).not.toContain('#page=');
	});
});

describe('buildNewIndexDocument', () => {
	it('starts with frontmatter the vault rules require', () => {
		const doc = buildNewIndexDocument(pdfFile, 'Lecture 3 · 批注索引', [page(1)]);
		expect(doc.startsWith('---\n')).toBe(true);
		expect(doc).toContain('title:');
		expect(doc).toContain('date:');
		expect(doc).toContain('tags:');
	});

	it('links back to the source PDF', () => {
		const doc = buildNewIndexDocument(pdfFile, 'T', [page(1)]);
		expect(doc).toContain('[[讲义/Lecture 3.pdf|Lecture 3]]');
	});

	it('contains every page entry', () => {
		const doc = buildNewIndexDocument(pdfFile, 'T', [page(1), page(7)]);
		expect(doc).toContain('p1.svg');
		expect(doc).toContain('p7.svg');
	});

	it('makes each page entry jump back to that page in the PDF', () => {
		const doc = buildNewIndexDocument(pdfFile, 'T', [page(1), page(7)]);
		expect(doc).toContain('[[讲义/Lecture 3.pdf#page=1|PDF]]');
		expect(doc).toContain('[[讲义/Lecture 3.pdf#page=7|PDF]]');
	});
});
