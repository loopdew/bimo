import type { App } from 'obsidian';
import type MyPlugin from 'src/main';

///////////////////////////
///////////////////////////

/**
 * Writes what the ink layers actually look like at runtime to a file in the
 * vault.
 *
 * The reason this exists: every failure of "I cannot write" has four very
 * different causes — the layer was never mounted, it was mounted but the
 * pointer is not routed to it, it has a zero-size box, or the event never
 * reaches it. From the outside all four look identical, and the only way to
 * tell them apart used to be asking the user to read a Notice aloud.
 *
 * This runs once after the workspace is ready and can also be run on demand, so
 * the state of a live Obsidian can be inspected without the UI.
 */

const REPORT_PATH = '.bimo/diagnostics.txt';

function describeBox(el: Element | undefined): string {
	if (!el) return '-';
	const rect = el.getBoundingClientRect();
	if (!rect) return '-';
	return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

function pointerEventsOf(el: Element | undefined): string {
	if (!el) return '-';
	const inline = (el as HTMLElement).style?.pointerEvents;
	if (inline) return inline;
	try {
		return window.getComputedStyle(el).pointerEvents || '-';
	} catch {
		return '-';
	}
}

export function collectMarkdownReport(app: App): string[] {
	const lines: string[] = [];
	let count = 0;

	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view.getViewType() !== 'markdown') return;
		const view = leaf.view as unknown as { file?: { path: string }; containerEl?: HTMLElement };
		const file = view.file;
		if (!file) return;
		count++;

		const container = view.containerEl;
		const scroller = container?.querySelector('.cm-scroller') ?? null;
		const content = container?.querySelector('.cm-content') ?? null;
		const layers = Array.from(container?.querySelectorAll<HTMLElement>('.bimo-md-ink-layer') ?? []);
		const svgs = container?.querySelectorAll('.bimo-md-ink-svg') ?? [];
		// Note pills are hosted on `document.body`, so the leaf-scoped count is
		// always 0 for them; the global count is what shows whether one exists.
		const pills = container?.querySelectorAll('.bimo-md-ink-pill') ?? [];
		const globalPills = document.querySelectorAll('.bimo-md-ink-pill').length;
		const first = layers[0];

		lines.push(
			[
				`md[${count}] ${file.path}`,
				`scroller=${scroller ? 1 : 0}`,
				`content=${content ? 1 : 0}`,
				`layers=${layers.length}`,
				`svg=${svgs.length}`,
				`pill=${pills.length}/${globalPills}`,
				`tool=${first?.dataset?.tool ?? '-'}`,
				`pe=${pointerEventsOf(first)}`,
				`box=${describeBox(first)}`,
				`parent=${first?.parentElement?.className ?? '-'}`,
			].join(' '),
		);
	});

	if (count === 0) lines.push('md[0] (no markdown leaf open)');
	return lines;
}

export function collectPdfReport(app: App): string[] {
	const lines: string[] = [];
	let count = 0;

	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view.getViewType() !== 'pdf') return;
		count++;

		const view = leaf.view as unknown as {
			file?: { path: string };
			containerEl?: HTMLElement;
			pdfViewer?: { dom?: { viewerEl?: HTMLElement } };
		};
		const container = view.containerEl;

		// `view.pdfViewer.dom.viewerEl` is the same entry point PDF++ uses. When
		// it resolves, the class-based selectors below are only a cross-check:
		// they prove the element exists inside the leaf container too.
		const viewerEl = view.pdfViewer?.dom?.viewerEl;

		const anyPages = container?.querySelectorAll('[data-page-number]').length ?? 0;
		const exactPages = container?.querySelectorAll('div.page[data-page-number]').length ?? 0;
		const thumbnails = container?.querySelectorAll('div.thumbnail[data-page-number]').length ?? 0;
		const viewerPages = viewerEl?.querySelectorAll('div.page[data-page-number]').length ?? 0;
		const canvases = container?.querySelectorAll('canvas').length ?? 0;
		const iframes = container?.querySelectorAll('iframe').length ?? 0;
		const layers = Array.from(container?.querySelectorAll<SVGSVGElement>('.bimo-pdf-ink-svg') ?? []);
		const first = layers[0];
		const pageEl = first?.closest('div.page[data-page-number]') as HTMLElement | null;

		lines.push(
			[
				`pdf[${count}] ${view.file?.path ?? '?'}`,
				`pdfViewer=${view.pdfViewer ? 1 : 0}`,
				`viewerEl=${viewerEl ? 1 : 0}`,
				`pages=${anyPages}`,
				`exact=${exactPages}`,
				`thumbs=${thumbnails}`,
				`viewerPages=${viewerPages}`,
				`canvas=${canvases}`,
				`iframe=${iframes}`,
				`layers=${layers.length}`,
				`box=${describeBox(first)}`,
				`pe=${pointerEventsOf(first)}`,
				`pagePos=${pageEl ? window.getComputedStyle(pageEl).position : '-'}`,
			].join(' '),
		);
	});

	if (count === 0) lines.push('pdf[0] (no pdf leaf open)');
	return lines;
}

export function buildReport(plugin: MyPlugin): string {
	const settings = plugin.settings;
	const header = [
		`bimo runtime diagnostics`,
		`written: ${new Date().toISOString()}`,
		`manifest: ${plugin.manifest.version}`,
		`mdInkEnabled=${settings.mdInkEnabled}`,
		`mdInkMouseDrawing=${settings.mdInkMouseDrawing}`,
		`mdInkTool=${plugin.mdInk?.tool ?? '-'}`,
		`pdfInkAttached=${plugin.pdfInk ? 'loaded' : 'missing'}`,
		'',
	];

	return [...header, ...collectMarkdownReport(plugin.app), ...collectPdfReport(plugin.app), ''].join('\n');
}

export async function writeRuntimeDiagnostics(plugin: MyPlugin): Promise<string> {
	const report = buildReport(plugin);
	try {
		const adapter = plugin.app.vault.adapter;
		const folder = REPORT_PATH.slice(0, REPORT_PATH.lastIndexOf('/'));
		if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
		await adapter.write(REPORT_PATH, report);
	} catch (error) {
		console.warn('[bimo] diagnostics write failed', error);
	}
	return report;
}
