import { App, Editor, Notice, TFile, loadPdfJs } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import { createNewWritingFile } from 'src/commands/create-new-writing-file';
import { setInkFileBackground } from 'src/logic/background/set-background';
import { buildWritingEmbed } from 'src/components/formats/current/utils/build-embeds';
import { activateNextEmbed, recordRecentFileSelection } from 'src/logic/utils/storage';
import { describePageSelection } from './pdf-page-selection';
import { pdfCacheFolder, resolveInkRootFolder, stablePathHash } from './pdf-paths';
import { upsertAnnotationIndex } from './annotation-index';

//////////
//////////

/** Where rendered PDF pages land before they become backgrounds. */
const PDF_PAGE_FOLDER = 'Ink/PDF';

/**
 * Render scale. 2× on a typical 612×792 pt page yields ~1224×1584 px — enough
 * that printed body text stays legible when zoomed in, without the 5 MB files a
 * 3–4× render would produce.
 */
const RENDER_SCALE = 2;

/** Minimal shape of the objects Obsidian's `loadPdfJs()` hands back. */
interface PdfDocumentLike {
	numPages: number;
	getPage: (pageNumber: number) => Promise<PdfPageLike>;
	destroy?: () => Promise<void>;
}

interface PdfPageLike {
	getViewport: (params: { scale: number }) => { width: number; height: number };
	render: (params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
}

/**
 * A rectangular area of a PDF page, in PDF user space: points, origin at the
 * bottom-left, y increasing upwards. This is exactly what PDF++ writes into its
 * `&rect=x1,y1,x2,y2` link parameter, so a copied PDF++ selection needs no
 * conversion before it reaches this type.
 */
export type PdfRect = [number, number, number, number];

interface RenderedPage {
	dataUrl: string;
	width: number;
	height: number;
}

async function openPdfDocument(file: TFile): Promise<PdfDocumentLike | null> {
	try {
		const pdfjs = (await loadPdfJs()) as { getDocument: (params: { data: Uint8Array }) => { promise: Promise<PdfDocumentLike> } };
		if (!pdfjs?.getDocument) return null;
		const buffer = await file.vault.readBinary(file);
		const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
		return doc ?? null;
	} catch (error) {
		console.debug('笔墨: could not open PDF with loadPdfJs', error);
		return null;
	}
}

async function renderPage(
	doc: PdfDocumentLike,
	pageNumber: number,
	rect?: PdfRect | null,
): Promise<RenderedPage | null> {
	try {
		const page = await doc.getPage(pageNumber);
		const viewport = page.getViewport({ scale: RENDER_SCALE });
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.floor(viewport.width));
		canvas.height = Math.max(1, Math.floor(viewport.height));

		const context = canvas.getContext('2d');
		if (!context) return null;

		// PDF pages are transparent; without this the PNG has a see-through page
		// and the ink would sit on whatever is behind the embed.
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);

		await page.render({ canvasContext: context, viewport }).promise;

		const cropped = rect ? cropCanvas(canvas, page.getViewport({ scale: 1 }), rect) : null;
		const output = cropped ?? canvas;

		return {
			dataUrl: output.toDataURL('image/png'),
			width: output.width,
			height: output.height,
		};
	} catch (error) {
		console.debug(`笔墨: could not render PDF page ${pageNumber}`, error);
		return null;
	}
}

/**
 * Cuts a region out of a rendered page.
 *
 * The rect arrives in PDF user space (bottom-left origin, y up) while the canvas
 * is top-left origin with y down, so the vertical edges are mirrored. Getting
 * this wrong produces a crop that looks plausible but is vertically flipped,
 * which is why the conversion lives in one place.
 */
function cropCanvas(
	canvas: HTMLCanvasElement,
	pageSizeAtScale1: { width: number; height: number },
	rect: PdfRect,
): HTMLCanvasElement | null {
	const [x1, y1, x2, y2] = rect;
	if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return null;
	if (x2 <= x1 || y2 <= y1) return null;

	const scaleX = canvas.width / pageSizeAtScale1.width;
	const scaleY = canvas.height / pageSizeAtScale1.height;

	const sourceX = Math.max(0, x1 * scaleX);
	const sourceY = Math.max(0, (pageSizeAtScale1.height - y2) * scaleY);
	const sourceWidth = Math.min(canvas.width - sourceX, (x2 - x1) * scaleX);
	const sourceHeight = Math.min(canvas.height - sourceY, (y2 - y1) * scaleY);
	if (sourceWidth < 1 || sourceHeight < 1) return null;

	const cropped = document.createElement('canvas');
	cropped.width = Math.round(sourceWidth);
	cropped.height = Math.round(sourceHeight);
	const context = cropped.getContext('2d');
	if (!context) return null;
	context.drawImage(
		canvas,
		sourceX, sourceY, sourceWidth, sourceHeight,
		0, 0, cropped.width, cropped.height,
	);
	return cropped;
}

function base64FromDataUrl(dataUrl: string): Uint8Array | null {
	const comma = dataUrl.indexOf(',');
	if (comma === -1) return null;
	try {
		const binary = window.atob(dataUrl.slice(comma + 1));
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	} catch {
		return null;
	}
}

/** Creates every missing segment of a folder path. */
export async function ensureFolder(plugin: InkPlugin, folder: string): Promise<boolean> {
	const vault = plugin.app.vault;
	const segments = folder.split('/').filter((segment) => segment.length > 0);
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (vault.getAbstractFileByPath(current)) continue;
		try {
			await vault.createFolder(current);
		} catch {
			// A race with another writer means the folder now exists; anything else
			// surfaces when the file write below fails.
		}
	}
	return Boolean(vault.getAbstractFileByPath(folder));
}

/**
 * Where a page image lives: `Ink/PDF/<hash>-<name>/p<page>@<scale>x.png`.
 *
 * Deliberately deterministic — annotating the same page twice reuses one image
 * instead of filling the vault with timestamped duplicates. The trade-off is
 * that a changed PDF keeps its old page images; deleting the folder forces a
 * re-render.
 */
function pageImagePath(
	inkRoot: string,
	pdfFile: TFile,
	pageNumber: number,
	rect?: PdfRect | null,
): string {
	// Cropped and full-page renders of the same page must not share a file, or
	// annotating page 3 twice — once whole, once as a PDF++ rectangle — would
	// silently reuse whichever image was written first.
	const crop = rect ? `-r${stablePathHash(rect.join(','))}` : '';
	return `${pdfCacheFolder(inkRoot, pdfFile)}/p${pageNumber}@${RENDER_SCALE}x${crop}.png`;
}


/**
 * The page number currently in view, used as the prompt's default.
 *
 * Best-effort DOM read: the viewer stores `data-page-number` on the page element.
 * A miss simply means the prompt opens at page 1.
 */
export function readVisiblePdfPageNumber(app: App): number | null {
	for (const leaf of app.workspace.getLeavesOfType('pdf')) {
		const container = leaf.view.containerEl;
		const current = container.querySelector('.pdf-viewer .page[data-page-number]');
		const value = current?.getAttribute('data-page-number');
		if (value) {
			const parsed = Number.parseInt(value, 10);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
		}
	}
	return null;
}

/**
 * Vault path of the PDF the user is actually looking at.
 *
 * The active leaf wins. Scanning `getLeavesOfType('pdf')` first used to return
 * whichever PDF happened to be opened earliest, so with two lecture PDFs open
 * side by side, annotating the second one silently produced pages from the
 * first.
 */
export function activePdfPath(app: App): { path: string; page: number | null } | null {
	const activeView = app.workspace.activeLeaf?.view as
		| { file?: { path?: string }; getViewType?: () => string }
		| undefined;
	if (activeView?.getViewType?.() === 'pdf' && typeof activeView.file?.path === 'string') {
		return { path: activeView.file.path, page: readVisiblePdfPageNumber(app) };
	}

	const leaves = app.workspace.getLeavesOfType('pdf');
	for (const leaf of leaves) {
		const view = leaf.view as { file?: { path?: string } };
		const path = view.file?.path;
		if (typeof path === 'string') {
			return { path, page: readVisiblePdfPageNumber(app) };
		}
	}
	return null;
}

/** Page count, used to validate the page prompt before rendering anything. */
export async function countPdfPages(file: TFile): Promise<number | null> {
	const doc = await openPdfDocument(file);
	if (!doc) return null;
	const total = doc.numPages;
	if (doc.destroy) {
		try {
			await doc.destroy();
		} catch {
			// Ignore: the count is already known.
		}
	}
	return Number.isFinite(total) && total > 0 ? total : null;
}

export interface PdfAnnotationTarget {
	pdfFile: TFile;
	pageNumbers: number[];
	/**
	 * Crop every page to this rectangle (PDF user space). Used by the PDF++
	 * hand-off: a copied rectangular selection becomes one block showing just
	 * that region instead of the whole page.
	 */
	rect?: PdfRect | null;
}

export type PdfAnnotateOutcome =
	| {
		ok: true;
		created: Array<{ page: number; inkFilePath: string; imagePath: string }>;
		failed: number[];
		/** Pages whose image already existed and was not re-rendered. */
		reused: number;
		/** Annotation index document, when one could be written. */
		indexPath: string | null;
	}
	| { ok: false; reason: string };

/**
 * Creates one annotation block per PDF page, each with that page as its
 * background, and inserts the embeds at the cursor.
 *
 * Uses Obsidian's own `loadPdfJs()` rather than scraping the viewer's canvas:
 * the viewer only paints visible pages, so scraping made "annotate page 7"
 * impossible without scrolling there by hand. Rendering through PDF.js works for
 * any page, at any scale, with no dependency on the viewer's DOM.
 */
export async function insertPdfAnnotations(
	plugin: InkPlugin,
	editor: Editor,
	target: PdfAnnotationTarget,
	/**
	 * The note that will receive the embeds. Required in practice: while a PDF is
	 * focused, `workspace.getActiveFile()` returns the *PDF*, and deriving the
	 * attachment folder from it put page images and handwriting next to the
	 * lecture PDF instead of in the configured `Ink/` tree.
	 */
	instigatingFile: TFile | null = null,
): Promise<PdfAnnotateOutcome> {
	const { pdfFile, pageNumbers, rect } = target;
	if (pageNumbers.length === 0) {
		return { ok: false, reason: t('No valid page numbers.') };
	}

	const doc = await openPdfDocument(pdfFile);
	if (!doc) {
		return { ok: false, reason: t('Could not open this PDF.') };
	}

	const activeFile = instigatingFile ?? plugin.app.workspace.getActiveFile();
	// Resolved through the same attachment helpers as the writing files, so page
	// images sit beside the handwriting rather than in a second root-level tree.
	const inkRoot = await resolveInkRootFolder(plugin, activeFile);
	if (!(await ensureFolder(plugin, pdfCacheFolder(inkRoot, pdfFile)))) {
		return { ok: false, reason: t('Could not create the Ink/PDF folder.') };
	}

	const created: Array<{ page: number; inkFilePath: string; imagePath: string }> = [];
	const failed: number[] = [];
	const pdfBaseName = pdfFile.basename.replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
	let reusedCount = 0;

	for (const pageNumber of pageNumbers) {
		const imagePath = pageImagePath(inkRoot, pdfFile, pageNumber, rect);
		let imageFile: TFile | null = null;

		// Reuse an existing render of this exact page: annotating page 7 in two
		// different notes should share one image, not duplicate half a megabyte.
		const existing = plugin.app.vault.getAbstractFileByPath(imagePath);
		if (existing instanceof TFile) {
			imageFile = existing;
			reusedCount += 1;
		} else {
			const rendered = await renderPage(doc, pageNumber, rect);
			if (!rendered) {
				failed.push(pageNumber);
				continue;
			}
			const bytes = base64FromDataUrl(rendered.dataUrl);
			if (!bytes) {
				failed.push(pageNumber);
				continue;
			}
			imageFile = await plugin.app.vault.createBinary(
				imagePath,
				bytes.buffer.slice(0) as ArrayBuffer,
			);
		}

		const inkFile = await createNewWritingFile(plugin, activeFile);

		const backgroundResult = await setInkFileBackground(
			plugin,
			inkFile,
			imageFile,
			{ path: pdfFile.path, page: String(pageNumber) },
		);
		if (!backgroundResult.ok) {
			failed.push(pageNumber);
			continue;
		}

		recordRecentFileSelection('inkWriting', inkFile.path);
		created.push({ page: pageNumber, inkFilePath: inkFile.path, imagePath });
	}

	if (doc.destroy) {
		try {
			await doc.destroy();
		} catch {
			// A document that refuses to close must not fail the whole operation.
		}
	}

	if (created.length === 0) {
		return { ok: false, reason: t('Could not prepare any of the selected pages.') };
	}

	// One insert at the end keeps the blocks adjacent instead of interleaving them
	// with whatever the loop touched in between. The heading carries the return
	// path: `#page=N` opens the source PDF at that page, so a block is never a
	// dead end once the PDF tab is gone.
	const embeds = created
		.map((entry) => buildWritingEmbed(entry.inkFilePath))
		.join('');
	const backLinks = created
		.map((entry) => `[[${pdfFile.path}#page=${entry.page}|${entry.page}]]`)
		.join(' · ');
	const heading = `\n### ${pdfBaseName}\n\n> ${t('Annotated pages')}: ${describePageSelection(created.map((entry) => entry.page))} · ${t('View in PDF')}: ${backLinks}\n`;

	activateNextEmbed();
	editor.replaceSelection(`${heading}${embeds}`);

	// The index is a convenience, not a prerequisite: if it cannot be written the
	// annotation blocks already exist and remain usable.
	const indexPath = await upsertAnnotationIndex(
		plugin,
		pdfFile,
		created.map((entry) => ({ page: entry.page, inkFilePath: entry.inkFilePath })),
		activeFile,
	);

	const summary = describePageSelection(created.map((entry) => entry.page));
	const reuseNote = reusedCount > 0
		? ` (${t('reused cached page images')}: ${reusedCount})`
		: '';
	new Notice(
		created.length === 1
			? `${t('PDF page is ready to annotate')}${reuseNote}`
			: `${t('PDF pages are ready to annotate')}: ${summary}${reuseNote}`,
	);

	return { ok: true, created, failed, reused: reusedCount, indexPath };
}
