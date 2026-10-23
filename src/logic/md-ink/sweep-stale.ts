import type { App } from 'obsidian';

///////////////////////////
///////////////////////////

/**
 * Remove ink DOM left behind by a previous instance of this plugin.
 *
 * Both layers live in DOM that belongs to Obsidian (`.cm-scroller`, PDF page
 * boxes), so nothing removes them when the plugin goes away. Measured in a
 * live 1.14.5 instance: after two reloads three SVGs all claimed page 1, and
 * `disablePlugin()` did not run `onunload` at all — so cleanup cannot depend on
 * the unload hook.
 *
 * Called at the start of `onload`, when no live instance can own these nodes.
 */
export function sweepStaleInkDom(app: App): number {
	let removed = 0;
	app.workspace.iterateAllLeaves((leaf) => {
		const container = (leaf.view as unknown as { containerEl?: HTMLElement }).containerEl;
		if (!container) return;
		const stale = container.querySelectorAll('.bimo-md-ink-layer, .bimo-pdf-ink-svg, .bimo-md-ink-pill');
		for (const element of Array.from(stale)) {
			element.remove();
			removed++;
		}
	});

	// Note pills are hosted on `document.body` (so a `transform` on an editor
	// wrapper cannot capture their fixed positioning), which puts them outside
	// every leaf container. Without this pass a reload would leave one ghost
	// pill per previously open note, all stacked in the same corner.
	for (const pill of Array.from(document.querySelectorAll('.bimo-md-ink-pill'))) {
		pill.remove();
		removed++;
	}
	return removed;
}
