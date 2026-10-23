import type { InkCanvasBackground, InkCanvasEditor } from 'src/ink-canvas/types';

//////////
//////////

/**
 * Live editors keyed by ink file path.
 *
 * Some changes are made *outside* the editor — setting a page image rewrites the
 * SVG metadata — and the open editor would otherwise keep painting its stale
 * in-memory snapshot until the embed remounted. This registry lets such a change
 * reach every editor currently showing that file.
 *
 * The same file can be open in several places at once (an embed in two notes, or
 * an embed plus the dedicated view), hence a set per path.
 */
const editorsByPath = new Map<string, Set<InkCanvasEditor>>();

export function registerInkEditorForPath(
	filePath: string,
	editor: InkCanvasEditor,
): () => void {
	let set = editorsByPath.get(filePath);
	if (!set) {
		set = new Set();
		editorsByPath.set(filePath, set);
	}
	set.add(editor);

	return () => {
		const current = editorsByPath.get(filePath);
		if (!current) return;
		current.delete(editor);
		if (current.size === 0) editorsByPath.delete(filePath);
	};
}

/**
 * Pushes a new page image into every open editor for this file.
 * Returns how many editors were updated (0 when the file is not open anywhere).
 */
export function applyBackgroundToOpenEditors(
	filePath: string,
	background: InkCanvasBackground | null,
): number {
	const set = editorsByPath.get(filePath);
	if (!set || set.size === 0) return 0;
	for (const editor of set) editor.setBackground(background);
	return set.size;
}
