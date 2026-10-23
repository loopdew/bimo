import { TFile } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { pdfCacheFolder, resolveInkRootFolder } from './pdf-paths';

//////////
//////////

/**
 * Markers around the generated page list.
 *
 * Everything outside them belongs to the user (notes, extra links, a manual
 * summary) and is never rewritten. Inside, the list is regenerated from the
 * merged map so page entries stay sorted no matter what order they were added.
 */
const INDEX_START = '<!-- bimo:pdf-index:start -->';
const INDEX_END = '<!-- bimo:pdf-index:end -->';

interface IndexedPage {
	page: number;
	inkFilePath: string;
}

/**
 * `- 第 3 页 → [[Ink/Writing/xxx.svg|第 3 页]] · [[讲义.pdf#page=3|PDF]]`
 *
 * The second link is the return path: from the annotation index straight back to
 * the page in the source PDF. Obsidian's `#page=N` fragment opens the PDF at
 * that page, so reading a handwritten note no longer means scrolling the lecture
 * by hand to find where it came from.
 */
function formatEntry(entry: IndexedPage, pdfPath?: string): string {
	// The key itself carries the placeholder, so English mode (which returns the
	// key verbatim) still interpolates correctly instead of printing a bare label.
	const label = t('Page {n}').replace('{n}', String(entry.page));
	const inkLink = `[[${entry.inkFilePath}|${label}]]`;
	if (!pdfPath) return `- ${label} → ${inkLink}`;
	const backLink = `[[${pdfPath}#page=${entry.page}|PDF]]`;
	return `- ${label} → ${inkLink} · ${backLink}`;
}

export function parseExistingEntries(markdown: string): IndexedPage[] {
	const start = markdown.indexOf(INDEX_START);
	const end = markdown.indexOf(INDEX_END);
	if (start === -1 || end === -1 || end < start) return [];

	const body = markdown.slice(start + INDEX_START.length, end);
	const entries: IndexedPage[] = [];
	const linePattern = /^-.*?\b(\d+)\b.*?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/gm;
	for (const match of body.matchAll(linePattern)) {
		const page = Number.parseInt(match[1], 10);
		if (!Number.isFinite(page) || page < 1) continue;
		entries.push({ page, inkFilePath: match[2] });
	}
	return entries;
}

/**
 * Merges existing entries with new ones.
 *
 * A page keeps the newest annotation file: re-annotating page 5 should point the
 * index at the block the user just created, not the orphaned earlier one.
 */
export function mergeEntries(existing: IndexedPage[], incoming: IndexedPage[]): IndexedPage[] {
	const byPage = new Map<number, IndexedPage>();
	for (const entry of existing) byPage.set(entry.page, entry);
	for (const entry of incoming) byPage.set(entry.page, entry);
	return [...byPage.values()].sort((left, right) => left.page - right.page);
}

function renderBlock(entries: IndexedPage[], pdfPath?: string): string {
	return [INDEX_START, ...entries.map((entry) => formatEntry(entry, pdfPath)), INDEX_END].join('\n');
}

/**
 * Applies the merged list to the index document.
 *
 * Splices only the marker block when it exists, so any prose the user added
 * around it survives every update.
 */
export function applyIndexEntries(markdown: string, entries: IndexedPage[], pdfPath?: string): string {
	const block = renderBlock(entries, pdfPath);
	const start = markdown.indexOf(INDEX_START);
	const end = markdown.indexOf(INDEX_END);
	if (start === -1 || end === -1 || end < start) {
		return `${markdown.replace(/\s*$/, '')}\n\n${block}\n`;
	}
	return markdown.slice(0, start) + block + markdown.slice(end + INDEX_END.length);
}

export function buildNewIndexDocument(pdfFile: TFile, title: string, entries: IndexedPage[]): string {
	const date = new Date().toISOString().slice(0, 10);
	return [
		'---',
		`title: ${title}`,
		`date: ${date}`,
		'tags:',
		'  - ink/pdf',
		'  - annotation',
		'---',
		'',
		`# ${title}`,
		'',
		`${t('Source document')}: [[${pdfFile.path}|${pdfFile.basename}]]`,
		'',
		renderBlock(entries, pdfFile.path),
		'',
	].join('\n');
}

export function annotationIndexPath(inkRoot: string, pdfFile: TFile): string {
	return `${pdfCacheFolder(inkRoot, pdfFile)}/index.md`;
}

/**
 * Creates or updates the annotation index for a PDF.
 *
 * Returns the index path, or `null` when it could not be written. A failure here
 * must not fail the annotation itself — the blocks were already created.
 */
export async function upsertAnnotationIndex(
	plugin: InkPlugin,
	pdfFile: TFile,
	incoming: IndexedPage[],
	/**
	 * The note that received the blocks. Required when a PDF is the active view:
	 * `getActiveFile()` returns the PDF there, and resolving the 笔墨 root from it
	 * would put the index beside the lecture instead of with the annotations.
	 */
	instigatingFile: TFile | null = null,
): Promise<string | null> {
	if (incoming.length === 0) return null;
	const vault = plugin.app.vault;
	const inkRoot = await resolveInkRootFolder(
		plugin,
		instigatingFile ?? plugin.app.workspace.getActiveFile(),
	);
	const path = annotationIndexPath(inkRoot, pdfFile);
	const title = `${pdfFile.basename} · ${t('Annotation index')}`;

	try {
		const existing = vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			const current = await vault.read(existing);
			const merged = mergeEntries(parseExistingEntries(current), incoming);
			await vault.modify(existing, applyIndexEntries(current, merged, pdfFile.path));
			return path;
		}

		const fresh = buildNewIndexDocument(pdfFile, title, mergeEntries([], incoming));
		await vault.create(path, fresh);
		return path;
	} catch (error) {
		console.debug('笔墨: could not update the annotation index', error);
		return null;
	}
}
