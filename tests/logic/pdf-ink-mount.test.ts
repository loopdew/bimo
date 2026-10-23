import { PdfInkOverlay } from 'src/logic/md-ink/pdf-ink-overlay';
import { createEmptyPdfInkDocument } from 'src/logic/md-ink/pdf-ink-types';

//////////
//////////

/**
 * Runtime proof that the PDF layer reaches the page, not just that the maths is
 * right. Obsidian's viewer is its own wrapper around pdf.js and its DOM has
 * changed between releases, so the interesting question is never "does the
 * transform work" but "does anything get mounted at all".
 */

const OPTIONS = {
	brush: 'pen' as const,
	size: 4,
	colour: 'currentColor',
	mouseDrawing: true,
	fingerDraws: false,
	eraserRadius: 14,
	shapeSnap: true,
	tool: 'pen' as const,
};

function makeApp(): never {
	return {
		vault: {
			adapter: {
				exists: async () => false,
				read: async () => '',
				write: async () => undefined,
				mkdir: async () => undefined,
			},
		},
	} as never;
}

describe('pdf ink mounting', () => {
	type Globals = Record<string, unknown>;
	const globals = globalThis as unknown as Globals;
	let originalResizeObserver: unknown;

	beforeAll(() => {
		originalResizeObserver = globals.ResizeObserver;
		if (!originalResizeObserver) {
			globals.ResizeObserver = class {
				observe(): void {}
				unobserve(): void {}
				disconnect(): void {}
			};
		}
	});

	afterAll(() => {
		globals.ResizeObserver = originalResizeObserver;
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	function mount(build: (container: HTMLElement) => void) {
		const container = document.createElement('div');
		document.body.appendChild(container);
		build(container);
		const overlay = new PdfInkOverlay(
			makeApp(),
			container,
			'Talk/lecture.pdf',
			OPTIONS,
			createEmptyPdfInkDocument('Talk/lecture.pdf'),
		);
		return { container, overlay };
	}

	it('attaches a layer to every page stamped with data-page-number', () => {
		const { container, overlay } = mount((root) => {
			for (const number of ['1', '2', '3']) {
				const page = document.createElement('div');
				page.dataset.pageNumber = number;
				root.appendChild(page);
			}
		});

		// The SVG carries the attribute too; only the page boxes count.
		const pages = container.querySelectorAll('div[data-page-number]');
		expect(pages).toHaveLength(3);
		pages.forEach((page) => {
			expect(page.querySelector('.bimo-pdf-ink-svg')).not.toBeNull();
		});

		overlay.destroy();
	});

	it('falls back to the page class when the attribute is missing', () => {
		const { container, overlay } = mount((root) => {
			const page = document.createElement('div');
			page.className = 'pdf-page';
			root.appendChild(page);
		});

		expect(container.querySelector('.pdf-page .bimo-pdf-ink-svg')).not.toBeNull();

		overlay.destroy();
	});

	it('falls back to whatever element hosts a page canvas', () => {
		const { container, overlay } = mount((root) => {
			const wrapper = document.createElement('div');
			wrapper.className = 'vendor-specific-wrapper';
			wrapper.appendChild(document.createElement('canvas'));
			root.appendChild(wrapper);
		});

		expect(container.querySelector('.vendor-specific-wrapper .bimo-pdf-ink-svg')).not.toBeNull();

		overlay.destroy();
	});

	it('gives the page a positioning context for the absolute layer', () => {
		const { container, overlay } = mount((root) => {
			const page = document.createElement('div');
			page.className = 'pdf-page';
			root.appendChild(page);
		});

		const page = container.querySelector<HTMLElement>('.pdf-page');
		expect(page?.style.position).toBe('relative');

		overlay.destroy();
	});

	it('hands the pointer to the layer only while a drawing tool is active', () => {
		const { container, overlay } = mount((root) => {
			const page = document.createElement('div');
			page.dataset.pageNumber = '1';
			root.appendChild(page);
		});

		const svg = container.querySelector<SVGSVGElement>('.bimo-pdf-ink-svg');
		expect(svg?.style.pointerEvents).toBe('auto');

		overlay.setOptions({ tool: 'pan' });
		expect(svg?.style.pointerEvents).toBe('none');

		overlay.destroy();
	});

	it('removes every layer on destroy', () => {
		const { container, overlay } = mount((root) => {
			const page = document.createElement('div');
			page.dataset.pageNumber = '1';
			root.appendChild(page);
		});

		expect(container.querySelectorAll('.bimo-pdf-ink-svg')).toHaveLength(1);
		overlay.destroy();
		expect(container.querySelectorAll('.bimo-pdf-ink-svg')).toHaveLength(0);
	});
});
