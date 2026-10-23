import { resolveAnnotationNoteName, resolveAnnotationNotePath } from 'src/logic/pdf/annotation-target';

describe('resolveAnnotationNoteName', () => {
	it('substitutes the PDF name', () => {
		expect(resolveAnnotationNoteName('{pdf} - 批注', 'Lecture 3', '2026-10-23')).toBe('Lecture 3 - 批注');
	});

	it('substitutes the date', () => {
		expect(resolveAnnotationNoteName('{date} {pdf}', '讲义', '2026-10-23')).toBe('2026-10-23 讲义');
	});

	it('is case-insensitive about the placeholders', () => {
		expect(resolveAnnotationNoteName('{PDF}', '讲义', '2026-10-23')).toBe('讲义');
	});

	it('strips characters Obsidian rejects in a path', () => {
		expect(resolveAnnotationNoteName('{pdf}', 'a/b:c*d?', '2026-10-23')).toBe('abcd');
	});

	it('falls back when the template is blank', () => {
		expect(resolveAnnotationNoteName('', '讲义', '2026-10-23')).toBe('讲义 - 批注');
	});

	it('falls back when the template collapses to nothing', () => {
		// A template made only of a stripped character would otherwise create ".md".
		expect(resolveAnnotationNoteName('/', '讲义', '2026-10-23')).toBe('讲义 - 批注');
	});

	it('does not create subfolders', () => {
		expect(resolveAnnotationNoteName('{pdf}/notes', '讲义', '2026-10-23')).toBe('讲义notes');
	});
});

describe('resolveAnnotationNotePath', () => {
	const pdfFile = { basename: 'Lecture 3', parent: { path: '01-Courses/物理/讲义' } };

	it('places the note beside its PDF', () => {
		expect(resolveAnnotationNotePath(pdfFile as never, '{pdf} - 批注', '2026-10-23'))
			.toBe('01-Courses/物理/讲义/Lecture 3 - 批注.md');
	});

	it('handles a PDF at the vault root', () => {
		const rootPdf = { basename: 'Syllabus', parent: null };
		expect(resolveAnnotationNotePath(rootPdf as never, '{pdf} 批注', '2026-10-23'))
			.toBe('Syllabus 批注.md');
	});
});
