import { collectMarkdownReport, collectPdfReport } from 'src/logic/md-ink/diagnostics';

//////////
//////////

/**
 * The diagnostics report is what turns "it does not work" into one of four
 * specific failure modes. These tests pin the two things that make it useful:
 * it must never throw on an empty or unusual workspace, and it must count the
 * page elements a real PDF view exposes — including telling real pages apart
 * from sidebar thumbnails, which carry the same `data-page-number` attribute.
 */

function makeApp(leaves: unknown[]) {
	return {
		workspace: {
			iterateAllLeaves: (cb: (leaf: unknown) => void) => leaves.forEach((leaf) => cb(leaf)),
		},
	} as never;
}

function mdLeaf(path: string, layerCount = 0, tool?: string) {
	const container = document.createElement('div');

	const scroller = document.createElement('div');
	scroller.className = 'cm-scroller';
	const content = document.createElement('div');
	content.className = 'cm-content';
	scroller.appendChild(content);

	for (let i = 0; i < layerCount; i++) {
		const layer = document.createElement('div');
		layer.className = 'bimo-md-ink-layer';
		if (tool) layer.dataset.tool = tool;
		scroller.appendChild(layer);
	}

	container.appendChild(scroller);

	return {
		view: {
			getViewType: () => 'markdown',
			file: { path, extension: 'md' },
			containerEl: container,
		},
	};
}

function pdfLeaf(path: string, pages: number, withViewer: boolean) {
	const container = document.createElement('div');
	const viewerEl = document.createElement('div');

	for (let i = 1; i <= pages; i++) {
		const page = document.createElement('div');
		page.className = 'page';
		page.dataset.pageNumber = String(i);
		viewerEl.appendChild(page);
	}
	container.appendChild(viewerEl);

	// A sidebar thumbnail shares the attribute but is not a page. Counting it
	// would make a broken selector look healthy.
	const thumb = document.createElement('div');
	thumb.className = 'thumbnail';
	thumb.dataset.pageNumber = '1';
	container.appendChild(thumb);

	return {
		view: {
			getViewType: () => 'pdf',
			file: { path },
			containerEl: container,
			pdfViewer: withViewer ? { dom: { viewerEl } } : undefined,
		},
	};
}

describe('markdown report', () => {
	test('reports an empty workspace instead of throwing', () => {
		const lines = collectMarkdownReport(makeApp([]));
		expect(lines).toEqual(['md[0] (no markdown leaf open)']);
	});

	test('separates "layer missing" from "layer present"', () => {
		const lines = collectMarkdownReport(makeApp([mdLeaf('Notes/A.md', 0)]));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('scroller=1');
		expect(lines[0]).toContain('layers=0');
	});

	test('reports the layer tool and parent so a wrong mount point is visible', () => {
		const lines = collectMarkdownReport(makeApp([mdLeaf('Notes/B.md', 1, 'pen')]));
		expect(lines[0]).toContain('layers=1');
		expect(lines[0]).toContain('tool=pen');
		expect(lines[0]).toContain('parent=cm-scroller');
	});

	test('lists every open note, not only the first', () => {
		const lines = collectMarkdownReport(makeApp([mdLeaf('Notes/A.md', 0), mdLeaf('Notes/B.md', 1, 'pan')]));
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('Notes/B.md');
	});
});

describe('pdf report', () => {
	test('reports an empty workspace instead of throwing', () => {
		const lines = collectPdfReport(makeApp([]));
		expect(lines).toEqual(['pdf[0] (no pdf leaf open)']);
	});

	test('counts real pages and excludes sidebar thumbnails', () => {
		const lines = collectPdfReport(makeApp([pdfLeaf('Docs/lecture.pdf', 3, true)]));
		expect(lines[0]).toContain('exact=3');
		expect(lines[0]).toContain('thumbs=1');
		expect(lines[0]).toContain('pages=4');
	});

	test('reports whether pdfViewer.dom.viewerEl resolved', () => {
		const lines = collectPdfReport(makeApp([pdfLeaf('Docs/lecture.pdf', 2, true)]));
		expect(lines[0]).toContain('pdfViewer=1');
		expect(lines[0]).toContain('viewerEl=1');
		expect(lines[0]).toContain('viewerPages=2');
	});

	test('still works when the viewer entry point is absent', () => {
		const lines = collectPdfReport(makeApp([pdfLeaf('Docs/old.pdf', 1, false)]));
		expect(lines[0]).toContain('pdfViewer=0');
		expect(lines[0]).toContain('exact=1');
	});
});
