import { Notice, setIcon, type App, type TFile } from 'obsidian';
import type MyPlugin from 'src/main';
import { PdfInkOverlay } from './pdf-ink-overlay';
import { createEmptyPdfInkDocument, type PdfInkDocument } from './pdf-ink-types';
import { attachPillDrag, type PillDragHandle } from './pill-drag';

///////////////////////////
///////////////////////////

/**
 * Keeps one {@link PdfInkOverlay} per open PDF leaf.
 *
 * Obsidian has no editor extension for PDF views, so this watches the workspace
 * layout instead: a PDF tab opened, closed or reordered is the only signal we
 * get. Attaching is idempotent and cheap — the expensive part (scanning page
 * boxes) lives inside the overlay.
 */

const PDF_INK_FOLDER = '.bimo/pdf-ink';
const SAVE_DEBOUNCE_MS = 700;
/** Where the dragged PDF pill position lives; one preference for every PDF. */
const PDF_PILL_POSITION_KEY = 'bimo-pdf-ink-pill-position';

function pdfInkFileKey(pdfPath: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < pdfPath.length; i++) {
		hash ^= pdfPath.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function pdfInkFilePath(pdfPath: string): string {
	return `${PDF_INK_FOLDER}/${pdfInkFileKey(pdfPath)}.json`;
}

export function parsePdfInkDocument(raw: string, pdfPath: string): PdfInkDocument {
	try {
		const parsed = JSON.parse(raw) as Partial<PdfInkDocument>;
		const strokes = Array.isArray(parsed.strokes)
			? parsed.strokes.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.points) && typeof s.page === 'number')
			: [];
		return { version: 1, pdfPath, strokes, updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now() };
	} catch {
		return createEmptyPdfInkDocument(pdfPath);
	}
}

interface AttachedPdf {
	overlay: PdfInkOverlay;
	filePath: string;
	timer: ReturnType<typeof setTimeout> | null;
	pill: HTMLElement | null;
	/** Owns the window listeners an active drag installs. */
	pillDrag: PillDragHandle | null;
	/** Kept so a rebuilt viewer subtree can be re-hosted by repairPills. */
	host: HTMLElement | null;
}

/**
 * A tool pill for PDF views.
 *
 * Obsidian has no editor extension for PDFs, so this is plain DOM on the view
 * container. It mirrors the note pill's markup and classes rather than sharing
 * code: the two have different hosts, lifetimes and available actions (a PDF
 * has no per-page undo stack), and a shared abstraction would be mostly
 * conditionals.
 */
function createPdfPill(
	host: HTMLElement,
	getTool: () => string,
	onSelect: (tool: string) => void,
	onClear: () => void,
): { pill: HTMLElement; drag: PillDragHandle } {
	const pill = document.createElement('div');
	pill.className = 'bimo-md-ink-pill bimo-md-ink-pill--pdf';

	const tools: Array<{ tool: string; icon: string; label: string }> = [
		{ tool: 'pen', icon: 'pencil', label: 'Pen' },
		{ tool: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
		{ tool: 'eraser', icon: 'eraser', label: 'Eraser' },
		{ tool: 'pan', icon: 'hand', label: 'Pan' },
	];

	for (const { tool, icon, label } of tools) {
		const button = document.createElement('button');
		button.type = 'button';
		button.title = label;
		button.dataset.mdInkTool = tool;
		button.classList.toggle('is-active', getTool() === tool);
		setIcon(button, icon);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onSelect(tool);
			for (const other of Array.from(pill.querySelectorAll<HTMLButtonElement>('[data-md-ink-tool]'))) {
				other.classList.toggle('is-active', other.dataset.mdInkTool === tool);
			}
			pill.classList.toggle('is-live', tool !== 'pan');
		});
		pill.appendChild(button);
	}

	const gap = document.createElement('span');
	gap.className = 'bimo-md-ink-pill__gap';
	pill.appendChild(gap);

	const clear = document.createElement('button');
	clear.type = 'button';
	clear.title = 'Clear ink on this PDF';
	setIcon(clear, 'trash-2');
	clear.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClear();
	});
	pill.appendChild(clear);

	pill.classList.toggle('is-live', getTool() !== 'pan');
	host.appendChild(pill);
	// Absolute coordinates against the leaf container: the PDF pill belongs to
	// its viewer, and scrolling the page must not leave it behind in the window.
	const drag = attachPillDrag({
		pill,
		host,
		storageKey: PDF_PILL_POSITION_KEY,
		positioning: 'absolute',
		defaultPosition: ({ host: bounds, pill: size }) => ({
			left: bounds.width - size.width - 16,
			top: 52,
		}),
	});
	return { pill, drag };
}

export class PdfInkManager {
	private readonly attached = new Map<string, AttachedPdf>();
	/** In-flight ink-file moves, keyed by the destination path. */
	private readonly pendingMoves = new Map<string, Promise<void>>();
	private started = false;

	/**
	 * Carry a PDF's ink across a rename.
	 *
	 * Same hash-of-path problem as notes: without this the strokes stay under a
	 * key derived from the old name and the renamed PDF opens blank. The copy
	 * refuses to overwrite an existing target, so a concurrent save from a live
	 * overlay (which always holds newer strokes) wins regardless of ordering.
	 */
	async moveInk(fromPath: string, toPath: string): Promise<void> {
		if (fromPath === toPath) return;
		const adapter = this.app.vault.adapter;
		const from = pdfInkFilePath(fromPath);
		const to = pdfInkFilePath(toPath);

		const move = (async () => {
			try {
				if (!(await adapter.exists(from))) return;
				if (await adapter.exists(to)) return;
				await adapter.write(to, await adapter.read(from));
				await adapter.remove(from);
			} catch (error) {
				console.warn('[bimo] pdf-ink move failed', fromPath, toPath, error);
			}
		})();

		this.pendingMoves.set(toPath, move);
		try {
			await move;
		} finally {
			if (this.pendingMoves.get(toPath) === move) this.pendingMoves.delete(toPath);
		}

		// An already mounted overlay keeps saving through `doc.pdfPath`; point it
		// at the new key or every following write recreates the old file.
		for (const entry of this.attached.values()) {
			const doc = entry.overlay?.getDocument();
			if (entry.filePath !== fromPath || !doc) continue;
			doc.pdfPath = toPath;
			entry.filePath = toPath;
		}
	}

	constructor(private readonly plugin: MyPlugin) {}

	start(): void {
		if (this.started) return;
		this.started = true;

		this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => this.sync()));
		this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.sync()));
		this.plugin.app.workspace.onLayoutReady(() => this.sync());
	}

	/** Tool changes must reach PDF overlays too, not only note overlays. */
	setTool(tool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'pan'): void {
		// The slot exists before the overlay does: attaching reads the ink file
		// from disk first, and a tool click can land inside that window.
		for (const entry of this.attached.values()) entry.overlay?.setOptions({ tool });
	}

	/** The master switch in settings hiding the feature. */
	setEnabled(enabled: boolean): void {
		if (!enabled) this.detachAll();
		else this.sync();
	}

	refreshOptions(patch: Parameters<PdfInkOverlay['setOptions']>[0]): void {
		for (const entry of this.attached.values()) entry.overlay?.setOptions(patch);
	}

	/**
	 * What the current PDF view actually exposes.
	 *
	 * The viewer's DOM is Obsidian's, not ours, and it has changed between
	 * versions. Rather than guess, this reports what was found so a broken
	 * selector is diagnosable in one click instead of by reading source.
	 */
	diagnose(): string {
		const active = this.app.workspace.activeLeaf?.view;
		if (!active || active.getViewType() !== 'pdf') return 'no-pdf-view';

		const container = (active as unknown as { containerEl?: HTMLElement }).containerEl;
		if (!container) return 'no-container';

		const viewer = (active as unknown as { pdfViewer?: { dom?: { viewerEl?: HTMLElement } } }).pdfViewer;
		const viewerEl = viewer?.dom?.viewerEl;

		const pages = container.querySelectorAll('[data-page-number]').length;
		const exact = container.querySelectorAll('div.page[data-page-number]').length;
		const thumbs = container.querySelectorAll('div.thumbnail[data-page-number]').length;
		const viewerPages = viewerEl?.querySelectorAll('div.page[data-page-number]').length ?? 0;
		const canvases = container.querySelectorAll('canvas').length;
		const iframes = container.querySelectorAll('iframe').length;
		const candidates = container.querySelectorAll(
			'[data-page-number], .pdf-page, .pdfViewer .page, .pdf-container .page',
		).length;
		const layers = Array.from(container.querySelectorAll<SVGSVGElement>('.bimo-pdf-ink-svg'));
		const attached = this.attached.size;

		// A mounted layer that is zero-sized and one that is merely inert look the
		// same from the outside; report both so the failure is not ambiguous.
		const first = layers[0];
		const rect = first?.getBoundingClientRect();
		const box = rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : '-';
		const pe = first ? first.style.pointerEvents || window.getComputedStyle(first).pointerEvents : '-';

		return `pages=${pages} exact=${exact} thumbs=${thumbs} viewer=${viewerEl ? 1 : 0} viewerPages=${viewerPages} candidates=${candidates} canvas=${canvases} iframe=${iframes} layers=${layers.length} box=${box} pe=${pe} attached=${attached}`;
	}

	private get app(): App {
		return this.plugin.app;
	}

	/**
	 * Put the pill back if something removed it.
	 *
	 * The PDF viewer owns its subtree and may replace it at any point (first
	 * render, reload after a zoom change, printing). A detached pill still
	 * exists as an object, so nothing else would notice it had vanished — the
	 * user simply has no toolbar.
	 */
	private repairPills(): void {
		for (const entry of this.attached.values()) {
			if (!entry.pill || !entry.overlay) continue;
			if (entry.pill.isConnected) continue;
			if (entry.host) entry.host.appendChild(entry.pill);
		}
	}

	sync(): void {
		if (!this.plugin.settings.mdInkEnabled) {
			this.detachAll();
			return;
		}

		const live = new Set<string>();

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() !== 'pdf') return;

			const view = leaf.view as unknown as {
				file?: TFile;
				containerEl?: HTMLElement;
				pdfViewer?: { dom?: { viewerEl?: HTMLElement } };
			};
			const file = view.file;
			const container = view.containerEl;
			if (!file || !container) return;

			const key = `${leaf.id}:${file.path}`;
			live.add(key);

			if (this.attached.has(key)) return;
			// `pdfViewer.dom.viewerEl` is the viewer's own page container. Scoping
			// the scan to it keeps sidebar thumbnails (`div.thumbnail` also carries
			// `data-page-number`) out of the page set; the leaf container stays the
			// fallback and is still where the tool pill goes.
			const scanRoot = view.pdfViewer?.dom?.viewerEl ?? container;
			void this.attach(key, file, scanRoot, container);
		});

		for (const key of [...this.attached.keys()]) {
			if (!live.has(key)) this.detach(key);
		}

		this.repairPills();
	}

	private async attach(
		key: string,
		file: TFile,
		scanRoot: HTMLElement,
		container: HTMLElement,
	): Promise<void> {
		// Reserve the slot synchronously so a second layout-change during the
		// async load does not mount a duplicate overlay.
		const placeholder: AttachedPdf = {
			overlay: null as unknown as PdfInkOverlay,
			filePath: file.path,
			timer: null,
			pill: null,
			pillDrag: null,
			host: null,
		};
		this.attached.set(key, placeholder);

		const doc = await this.load(file.path);
		if (!this.attached.has(key)) return;

		const overlay = new PdfInkOverlay(
			this.app,
			scanRoot,
			file.path,
			{
				brush: this.plugin.settings.mdInkBrush,
				size: this.plugin.settings.mdInkSize,
				colour: this.plugin.settings.mdInkColour,
				mouseDrawing: this.plugin.settings.mdInkMouseDrawing,
				fingerDraws: this.plugin.settings.mdInkFingerDraws,
				eraserRadius: this.plugin.settings.mdInkEraserRadius,
				shapeSnap: this.plugin.settings.mdInkShapeSnap,
				tool: this.plugin.mdInk.tool,
				onChange: () => this.scheduleSave(placeholder),
			},
			doc,
		);

		placeholder.overlay = overlay;

		// Host the pill on the leaf container, not `.view-content`.
		//
		// Verified in a live 1.14.5 instance: the pill object existed and was
		// appended, yet `.view-content` held only `pdf-toolbar` and
		// `pdf-container` — pdf.js rebuilds that subtree once the document
		// finishes loading, taking any foreign child with it. The leaf container
		// outlives that rebuild.
		const host = container;
		if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
		placeholder.host = host;
		const pillParts = createPdfPill(
			host,
			() => this.plugin.mdInk.tool,
			(tool) => this.plugin.mdInk.setTool(tool as 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'pan'),
			() => {
				overlay.clearAll();
				new Notice('PDF ink cleared.');
			},
		);
		placeholder.pill = pillParts.pill;
		placeholder.pillDrag = pillParts.drag;
	}

	private detach(key: string): void {
		const entry = this.attached.get(key);
		if (!entry) return;
		this.flush(entry);
		entry.overlay?.destroy();
		entry.pillDrag?.destroy();
		entry.pillDrag = null;
		entry.pill?.remove();
		this.attached.delete(key);
	}

	private scheduleSave(entry: AttachedPdf): void {
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = setTimeout(() => {
			entry.timer = null;
			this.flush(entry);
		}, SAVE_DEBOUNCE_MS);
	}

	private flush(entry: AttachedPdf): void {
		if (entry.timer) {
			clearTimeout(entry.timer);
			entry.timer = null;
		}
		if (!entry.overlay) return;
		void this.save(entry.overlay.getDocument());
	}

	private detachAll(): void {
		for (const key of [...this.attached.keys()]) this.detach(key);
	}

	/** Remove every overlay and pill; used when the plugin unloads or reloads. */
	destroy(): void {
		this.started = false;
		this.detachAll();
		this.sweepOrphans();
	}

	/**
	 * Remove layers that no entry points at any more.
	 *
	 * A reload creates a fresh manager with an empty map, so anything the
	 * previous instance mounted becomes unreachable — measured in a live
	 * instance as three SVGs all claiming page 1 after two reloads. Detaching
	 * known entries cannot reach those, so sweep by class.
	 */
	private sweepOrphans(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const container = (leaf.view as unknown as { containerEl?: HTMLElement }).containerEl;
			if (!container) return;
			for (const svg of Array.from(container.querySelectorAll('.bimo-pdf-ink-svg'))) svg.remove();
			for (const pill of Array.from(container.querySelectorAll('.bimo-md-ink-pill--pdf'))) pill.remove();
		});
	}

	private async load(pdfPath: string): Promise<PdfInkDocument> {
		// A rename may still be copying the JSON; reading first would return an
		// empty document, and the next save would persist it over the real one.
		const pending = this.pendingMoves.get(pdfPath);
		if (pending) await pending;
		const adapter = this.app.vault.adapter;
		const path = pdfInkFilePath(pdfPath);
		try {
			if (!(await adapter.exists(path))) return createEmptyPdfInkDocument(pdfPath);
			return parsePdfInkDocument(await adapter.read(path), pdfPath);
		} catch (error) {
			console.warn('[bimo] pdf-ink load failed', pdfPath, error);
			return createEmptyPdfInkDocument(pdfPath);
		}
	}

	private async save(doc: PdfInkDocument): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = pdfInkFilePath(doc.pdfPath);
		try {
			if (!(await adapter.exists(PDF_INK_FOLDER))) await adapter.mkdir(PDF_INK_FOLDER);
			await adapter.write(path, JSON.stringify({ ...doc, updatedAt: Date.now() }));
		} catch (error) {
			console.warn('[bimo] pdf-ink save failed', doc.pdfPath, error);
		}
	}

	hasInkOnActivePdf(): boolean {
		for (const entry of this.attached.values()) {
			if (entry.overlay?.hasInk()) return true;
		}
		return false;
	}

	clearActive(): void {
		for (const entry of this.attached.values()) entry.overlay?.clearAll();
	}
}
