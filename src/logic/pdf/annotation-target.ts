import type { TFile } from 'obsidian';

//////////
//////////

/** Characters Obsidian refuses in a vault path segment. */
const INVALID_PATH_CHARS = /[\\/:*?"<>|]/g;

const FALLBACK_TEMPLATE = '{pdf} - 批注';

/**
 * Expands the annotation-note template.
 *
 * Only `{pdf}` and `{date}` are supported. A richer placeholder language would
 * need documentation nobody reads; these two cover the two conventions people
 * actually use — one note per PDF, or one note per PDF per day.
 *
 * Slashes are stripped rather than honoured: a template that silently creates
 * subfolders is a surprise, and a note that lands somewhere other than beside
 * its PDF is harder to find than one that does not.
 */
export function resolveAnnotationNoteName(
	template: string,
	pdfBaseName: string,
	date: string,
): string {
	const cleanPdf = pdfBaseName.replace(INVALID_PATH_CHARS, '').trim() || 'PDF';
	const raw = (template?.trim() || FALLBACK_TEMPLATE)
		.replace(/\{pdf\}/gi, cleanPdf)
		.replace(/\{date\}/gi, date)
		.replace(INVALID_PATH_CHARS, '')
		.trim();
	return raw || `${cleanPdf} - 批注`;
}

/** Vault path for a generated annotation note, beside its PDF. */
export function resolveAnnotationNotePath(
	pdfFile: TFile,
	template: string,
	date = new Date().toISOString().slice(0, 10),
): string {
	const folder = pdfFile.parent?.path ?? '';
	const name = resolveAnnotationNoteName(template, pdfFile.basename, date);
	return `${folder ? `${folder}/` : ''}${name}.md`;
}

/** Frontmatter + heading for a note this plugin creates on the user's behalf. */
export function buildAnnotationNoteBody(pdfFile: TFile, date: string): string {
	return [
		'---',
		`title: ${pdfFile.basename}`,
		`date: ${date}`,
		'tags:',
		'  - ink/pdf',
		'  - annotation',
		'---',
		'',
		`# ${pdfFile.basename}`,
		'',
		`[[${pdfFile.path}|${pdfFile.basename}]]`,
		'',
	].join('\n');
}
