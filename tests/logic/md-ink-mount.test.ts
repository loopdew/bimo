import { EditorState } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { DEFAULT_SETTINGS } from 'src/types/plugin-settings';
import { createMdInkExtension, resolveNotePath } from 'src/logic/md-ink/md-ink-extension';

//////////
//////////

/**
 * Runtime proof that the overlay actually attaches.
 *
 * Every other test in this feature checks pure logic. This one builds a real
 * CodeMirror editor in jsdom, appends the extension the way Obsidian would, and
 * asserts the DOM the user is supposed to see. If a future refactor breaks the
 * ViewPlugin's lifecycle, it fails here instead of silently doing nothing in a
 * live vault.
 */

function buildPlugin(holder: { view: EditorView | null }, overrides: Record<string, unknown> = {}) {
	return {
		settings: { ...DEFAULT_SETTINGS, mdInkEnabled: true, ...overrides },
		app: {
			workspace: {
				iterateAllLeaves: (cb: (leaf: unknown) => void) => {
					cb({
						view: {
							editor: holder.view ? { cm: holder.view } : undefined,
							file: { path: 'Notes/Test.md', extension: 'md' },
						},
					});
				},
			},
			vault: {
				adapter: {
					exists: async () => false,
					read: async () => '{"version":1,"strokes":[]}',
					write: async () => undefined,
					mkdir: async () => undefined,
				},
			},
		},
		mdInk: {
			tool: 'pan',
			register: jest.fn(),
			unregister: jest.fn(),
			setTool: jest.fn(),
			refreshOptions: jest.fn(),
			// The extension asks the controller about renames and pending moves
			// before it reads a document; both must exist or mounting throws.
			wasRenamed: () => false,
			awaitMove: async () => undefined,
		},
	};
}

function mountEditor(doc = 'first line\nsecond line\nthird line') {
	const holder: { view: EditorView | null } = { view: null };
	const plugin = buildPlugin(holder);

	const view = new EditorView({
		state: EditorState.create({ doc }),
		parent: document.body,
	});
	holder.view = view;

	// Appending rather than constructing with the extension mirrors reality: the
	// editor exists first, the plugin registers its extension on load.
	view.dispatch({ effects: StateEffect.appendConfig.of(createMdInkExtension(plugin as never)) });

	return { view, plugin, holder };
}

describe('note ink mounting', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('attaches the layer, the svg and the tool pill to the editor', () => {
		const { view } = mountEditor();

		expect(document.querySelector('.bimo-md-ink-layer')).not.toBeNull();
		expect(document.querySelector('.bimo-md-ink-svg')).not.toBeNull();
		expect(document.querySelector('.bimo-md-ink-pill')).not.toBeNull();

		// The layer must hang off the scroller, not off the editable content:
		// CodeMirror rebuilds `.cm-content` on edits and drops foreign nodes.
		const layer = document.querySelector<HTMLElement>('.bimo-md-ink-layer');
		expect(layer).not.toBeNull();
		expect(layer?.parentElement).not.toBe(view.contentDOM);
		expect(layer?.parentElement?.classList.contains('cm-scroller')).toBe(true);
		expect(view.dom.contains(layer)).toBe(true);

		view.destroy();
	});

	it('registers the overlay against the note path', () => {
		const { view, plugin } = mountEditor();

		expect(plugin.mdInk.register).toHaveBeenCalledWith('Notes/Test.md', expect.anything());

		view.destroy();
	});

	it('starts inert so the editor behaves normally', () => {
		const { view } = mountEditor();
		const layer = document.querySelector<HTMLElement>('.bimo-md-ink-layer');

		// Pan is the default tool, and pan must not intercept the pointer.
		expect(layer?.dataset.tool).toBe('pan');
		expect(layer?.style.pointerEvents).toBe('none');

		view.destroy();
	});

	it('renders a pill button per tool plus undo and clear', () => {
		const { view } = mountEditor();
		const tools = document.querySelectorAll('[data-md-ink-tool]');
		expect(tools).toHaveLength(5);

		view.destroy();
	});

	it('does not mount when the feature is switched off', () => {
		const holder: { view: EditorView | null } = { view: null };
		const plugin = buildPlugin(holder, { mdInkEnabled: false });
		const view = new EditorView({ state: EditorState.create({ doc: 'x' }), parent: document.body });
		holder.view = view;

		view.dispatch({ effects: StateEffect.appendConfig.of(createMdInkExtension(plugin as never)) });

		expect(document.querySelector('.bimo-md-ink-layer')).toBeNull();

		view.destroy();
	});

	it('does not mount inside an embedded writing block', () => {
		const host = document.createElement('div');
		host.className = 'ddc_ink_writing-embed';
		document.body.appendChild(host);

		const holder: { view: EditorView | null } = { view: null };
		const plugin = buildPlugin(holder);
		const view = new EditorView({ state: EditorState.create({ doc: 'x' }), parent: host });
		holder.view = view;

		view.dispatch({ effects: StateEffect.appendConfig.of(createMdInkExtension(plugin as never)) });

		expect(document.querySelector('.bimo-md-ink-layer')).toBeNull();

		view.destroy();
	});

	/**
	 * The real-world race: Obsidian builds the editor before the MarkdownView
	 * publishes `.editor.cm`, so a single attempt at construction sees no leaf.
	 * Without the retry the layer never appears, and nothing ever triggers a
	 * second attempt on a note the user does not type into.
	 */
	it('mounts after the leaf is wired up, without waiting for an edit', () => {
		jest.useFakeTimers();
		try {
			const holder: { view: EditorView | null } = { view: null };
			let leafReady = false;
			const plugin = buildPlugin(holder);
			const realIterate = plugin.app.workspace.iterateAllLeaves;
			plugin.app.workspace.iterateAllLeaves = (cb: (leaf: unknown) => void) => {
				if (!leafReady) return;
				realIterate(cb);
			};

			const view = new EditorView({ state: EditorState.create({ doc: 'x' }), parent: document.body });
			view.dispatch({ effects: StateEffect.appendConfig.of(createMdInkExtension(plugin as never)) });
			expect(document.querySelector('.bimo-md-ink-layer')).toBeNull();

			leafReady = true;
			holder.view = view;
			jest.advanceTimersByTime(200);

			expect(document.querySelector('.bimo-md-ink-layer')).not.toBeNull();
			expect(plugin.mdInk.register).toHaveBeenCalledWith('Notes/Test.md', expect.anything());

			view.destroy();
		} finally {
			jest.useRealTimers();
		}
	});

	it('keeps the layer attached across an edit', () => {
		const { view } = mountEditor();
		const layer = document.querySelector('.bimo-md-ink-layer');

		view.dispatch({ changes: { from: 0, insert: 'inserted line\n' } });

		expect(layer?.isConnected).toBe(true);
		expect(view.dom.contains(layer)).toBe(true);
		expect(document.querySelectorAll('.bimo-md-ink-layer')).toHaveLength(1);

		view.destroy();
	});

	it('puts the pill back in its corner on double-click', () => {
		const { view } = mountEditor();
		const pill = document.querySelector<HTMLElement>('.bimo-md-ink-pill');
		expect(pill).not.toBeNull();

		pill!.style.left = '120px';
		pill!.style.top = '80px';
		pill!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

		// The pill is `position: fixed`, so a reset recomputes the editor's
		// corner instead of clearing the styles — clearing them would park it at
		// the window's 0,0. jsdom reports a zero-sized editor, so the exact
		// values are clamped to the minimum inset; what matters is that a real
		// coordinate was written rather than an empty string.
		expect(pill!.style.left).not.toBe('');
		expect(pill!.style.top).not.toBe('');
		expect(pill!.style.left).not.toBe('120px');

		view.destroy();
	});

	it('removes its DOM when the view is destroyed', () => {
		const { view } = mountEditor();
		expect(document.querySelector('.bimo-md-ink-layer')).not.toBeNull();

		view.destroy();
		expect(document.querySelector('.bimo-md-ink-layer')).toBeNull();
		expect(document.querySelector('.bimo-md-ink-pill')).toBeNull();
	});
});

describe('resolveNotePath', () => {
	it('reads the file behind the CodeMirror view', () => {
		const { view, plugin } = mountEditor();
		expect(resolveNotePath(plugin as never, view)).toBe('Notes/Test.md');
		view.destroy();
	});

	it('returns null for a view that belongs to no leaf', () => {
		const view = new EditorView({ state: EditorState.create({ doc: 'x' }), parent: document.body });
		const plugin = buildPlugin({ view: null });
		expect(resolveNotePath(plugin as never, view)).toBeNull();
		view.destroy();
	});
});

// Keep the ViewUpdate import meaningful for future assertions.
export type { ViewUpdate };
