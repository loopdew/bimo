import { parsePageSelection, describePageSelection } from 'src/logic/pdf/pdf-page-selection';

//////////
//////////

describe('parsePageSelection', () => {
	it('defaults to page 1 for blank input', () => {
		expect(parsePageSelection('', 20)).toEqual([1]);
		expect(parsePageSelection('   ', 20)).toEqual([1]);
	});

	it('parses a single page', () => {
		expect(parsePageSelection('3', 20)).toEqual([3]);
	});

	it('parses an inclusive range', () => {
		expect(parsePageSelection('1-3', 20)).toEqual([1, 2, 3]);
	});

	it('parses a mixed list', () => {
		expect(parsePageSelection('1-2, 5, 8', 20)).toEqual([1, 2, 5, 8]);
	});

	it('de-duplicates and sorts', () => {
		expect(parsePageSelection('5,2-3,2,5', 20)).toEqual([2, 3, 5]);
	});

	it('accepts full-width separators from a Chinese IME', () => {
		expect(parsePageSelection('1～3，5', 20)).toEqual([1, 2, 3, 5]);
	});

	it('normalises a reversed range', () => {
		expect(parsePageSelection('4-2', 20)).toEqual([2, 3, 4]);
	});

	it('drops pages outside the document instead of clamping', () => {
		expect(parsePageSelection('1,99', 5)).toEqual([1]);
		expect(parsePageSelection('7-9', 5)).toEqual([]);
		expect(parsePageSelection('0', 5)).toEqual([]);
	});

	it('ignores junk tokens', () => {
		expect(parsePageSelection('abc, 2', 10)).toEqual([2]);
		expect(parsePageSelection('2.5', 10)).toEqual([]);
	});

	it('returns nothing when the document has no pages', () => {
		expect(parsePageSelection('1', 0)).toEqual([]);
	});
});

describe('describePageSelection', () => {
	it('lists short selections verbatim', () => {
		expect(describePageSelection([1, 2])).toBe('1, 2');
	});

	it('summarises long selections', () => {
		const label = describePageSelection([1, 2, 3, 4, 5, 6]);
		expect(label).toContain('1, 2, 3, 4');
		expect(label).toContain('6');
	});

	it('handles an empty selection', () => {
		expect(describePageSelection([])).toBe('—');
	});
});
