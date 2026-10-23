import { parsePdfPlusSelection } from 'src/logic/pdf/pdf-plus-link';

describe('parsePdfPlusSelection', () => {
	it('reads a full-page embed link', () => {
		expect(parsePdfPlusSelection('![[01-Courses/讲义.pdf#page=3]]')).toEqual({
			pdfPath: '01-Courses/讲义.pdf',
			page: 3,
			rect: null,
		});
	});

	it('reads a rectangular selection', () => {
		expect(parsePdfPlusSelection('![[讲义.pdf#page=7&rect=100,200,300,400]]')).toEqual({
			pdfPath: '讲义.pdf',
			page: 7,
			rect: [100, 200, 300, 400],
		});
	});

	it('accepts parameters in either order', () => {
		expect(parsePdfPlusSelection('[[讲义.pdf#rect=10,20,30,40&page=2]]')).toEqual({
			pdfPath: '讲义.pdf',
			page: 2,
			rect: [10, 20, 30, 40],
		});
	});

	it('ignores a display alias', () => {
		expect(parsePdfPlusSelection('![[讲义.pdf#page=1|第 1 页]]')?.page).toBe(1);
	});

	it('tolerates surrounding prose', () => {
		const text = '复制得到：![[讲义.pdf#page=4&rect=1,2,3,4]] 完成';
		expect(parsePdfPlusSelection(text)?.page).toBe(4);
	});

	it('rejects a link without a page', () => {
		expect(parsePdfPlusSelection('![[讲义.pdf]]')).toBeNull();
	});

	it('rejects a non-PDF link', () => {
		expect(parsePdfPlusSelection('![[笔记.md#page=2]]')).toBeNull();
	});

	it('rejects an inverted rectangle', () => {
		// y1 > y2 means the selection was flipped; silently drawing a mirrored
		// crop is worse than falling back to the whole page.
		expect(parsePdfPlusSelection('![[讲义.pdf#page=1&rect=300,400,100,200]]')?.rect).toBeNull();
	});

	it('rejects a rect with the wrong number of values', () => {
		expect(parsePdfPlusSelection('![[讲义.pdf#page=1&rect=1,2,3]]')?.rect).toBeNull();
	});

	it('returns null for text that is not a link', () => {
		expect(parsePdfPlusSelection('just text')).toBeNull();
	});
});
