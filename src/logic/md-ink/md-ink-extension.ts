import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { MarkdownView, Notice, type TFile } from 'obsidian';
import { t } from 'src/i18n';
import type MyPlugin from 'src/main';
import { MdInkOverlay } from './md-ink-overlay';
import { MdInkStorage } from './md-ink-store';
import { mergeMdInkDocuments, type MdInkDocument } from './types';

///////////////////////////
///////////////////////////

/**
 * Per-editor glue between CodeMirror and the ink overlay.
 *
 * One overlay per Markdown view. The overlay survives document edits — it only
 * needs a repaint, because strokes are anchored to lines, not to pixels.
 */

const SAVE_DEBOUNCE_MS = 700;

/**
 * Find the vault file behind a CodeMirror view without trusting `getActiveFile`.
 *
 * Two passes on purpose. The editor-identity pass is the accurate one, but it
 * only works after the MarkdownView has assigned `.editor.cm` — during the
 * extension constructor that assignment has usually not happened yet, so the
 * first pass returns nothing on a perfectly valid note. The DOM pass rescues
 * that case by matching the leaf whose container hosts this view.
 */
export function resolveNotePath(plugin: MyPlugin, view: EditorView): string | null {
	let found: string | null = null;
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (found) return;
		const editor = (leaf.view as unknown as { editor?: { cm?: EditorView } }).editor;
		if (editor?.cm === view) {
			const file = (leaf.view as unknown as { file?: TFile }).file;
			if (file?.extension === 'md') found = file.path;
		}
	});
	if (found) return found;

	const leafEl = view.dom.closest('.workspace-leaf');
	if (!leafEl) return null;

	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (found) return;
		const container = (leaf.view as unknown as { containerEl?: HTMLElement }).containerEl;
		const file = (leaf.view as unknown as { file?: TFile }).file;
		if (!container || file?.extension !== 'md') return;
		if (container === leafEl || container.contains(leafEl)) found = file.path;
	});
	return found;
}

/** The overlay must not mount inside an embedded writing/drawing canvas. */
function isInsideEmbed(container: HTMLElement): boolean {
	return !!container.closest('.ddc_ink_writing-embed, .ddc_ink_drawing-embed, .bimo-md-ink-layer');
}

const FIRST_USE_HINT_KEY = 'bimo-md-ink-hint-shown';

/**
 * Explain the one thing the UI cannot show by itself.
 *
 * The layer starts on the pan tool, so the first stroke a new user attempts
 * does nothing at all — correctly, since that tool must not block text
 * selection. Without this they conclude the feature is broken, which is exactly
 * what happened before this was added.
 */
function maybeShowFirstUseHint(): void {
	try {
		if (window.localStorage.getItem(FIRST_USE_HINT_KEY) === '1') return;
		window.localStorage.setItem(FIRST_USE_HINT_KEY, '1');
	} catch {
		return;
	}
	new Notice(
		t('Handwriting is ready. Pick the pencil in the corner to draw; the hand icon goes back to normal editing. The toolbar itself can be dragged anywhere.'),
		9000,
	);
}

export function createMdInkExtension(plugin: MyPlugin): Extension {
	const storage = new MdInkStorage(plugin.app);

	return ViewPlugin.fromClass(
		class {
			private overlay: MdInkOverlay | null = null;
			private notePath: string | null = null;
			private saveTimer: ReturnType<typeof setTimeout> | null = null;
			private retryTimer: ReturnType<typeof setTimeout> | null = null;
			private mountAttempts = 0;
			private disposed = false;
			/**
			 * Set only after the on-disk document has been merged in.
			 *
			 * Saving before that point writes an empty document and can overwrite
			 * real strokes on disk — which is exactly what produced the
			 * zero-stroke JSON files in `.bimo/` during the first live attempt.
			 */
			private hydrated = false;

			constructor(private readonly view: EditorView) {
				this.tryMount();
			}

			update(update: ViewUpdate): void {
				if (!plugin.settings.mdInkEnabled) {
					// Suspend rather than destroy. This view plugin instance lives as
					// long as the editor, and the settings switch cannot unregister
					// it; a permanent dispose here left the layer dead for the rest
					// of the session — it mounted, but never loaded or saved again.
					if (this.overlay) this.teardown(false);
					return;
				}
				if (this.disposed) return;
				if (!this.view.contentDOM) return;

				if (!this.overlay) {
					this.tryMount();
					return;
				}

				if (update.docChanged || update.geometryChanged || update.viewportChanged) {
					this.overlay.requestRender();
				}

				const current = resolveNotePath(plugin, this.view);
				if (current && current !== this.notePath) {
					void this.rekey(current);
				}
			}

			destroy(): void {
				this.teardown(true);
			}

			/**
			 * Follow a path change on this editor.
			 *
			 * Two situations produce one:
			 *
			 * 1. The note was renamed. The strokes belong to it and must move too.
			 * 2. The same tab now shows a different note. The strokes must not.
			 *
			 * `wasRenamed` is the discriminator, because the paths alone cannot
			 * distinguish them. Without it, a delete (or a tab reuse) would either
			 * carry one note's ink onto another or drop the user's strokes on every
			 * rename.
			 */
			private async rekey(nextPath: string): Promise<void> {
				const previous = this.notePath;
				const overlay = this.overlay;
				if (!overlay || !previous) return;

				// Optional: if the mdInk onload step failed, the extension can still
				// be registered while `plugin.mdInk` is missing. A crash here would
				// take the whole editor down for a feature that is merely absent.
				const renamed = plugin.mdInk?.wasRenamed?.(previous, nextPath) ?? false;

				this.notePath = nextPath;
				plugin.mdInk.unregister(previous, overlay);
				plugin.mdInk.register(nextPath, overlay);
				// Block saves while the file is being re-keyed: a write now would
				// land under whichever path happens to be current mid-migration.
				this.hydrated = false;

				if (!renamed) {
					// Replace, not merge: this editor now shows a different file.
					void this.loadFor(nextPath, true);
					return;
				}

				await plugin.mdInk?.awaitMove?.(nextPath);
				const fromDisk = await storage.load(nextPath);
				if (this.disposed || this.overlay !== overlay) return;
				// Merge, not replace: anything drawn before the rename settled is
				// still this note's ink and must survive.
				overlay.replaceDocument(
					mergeMdInkDocuments({ ...overlay.getDocument(), notePath: nextPath }, fromDisk),
				);
				this.hydrated = true;
			}

			private tryMount(): void {
				if (!plugin.settings.mdInkEnabled) return;
				if (isInsideEmbed(this.view.dom)) return;
				// Exotic Markdown-derived views (empty panes, previews) have no
				// content layer to hang an overlay on. The connection check is
				// deliberately absent here: at construction the editor is not in the
				// document yet, and requiring that would stop every first mount.
				if (!this.view.contentDOM) return;

				let notePath = resolveNotePath(plugin, this.view);
				if (!notePath && this.mountAttempts >= 20) {
					// Every leaf match failed. If this editor is the active note's,
					// the workspace still knows which file that is.
					notePath = this.resolveWithActiveFallback();
				}
				if (!notePath) {
					// The view exists but its leaf has not been wired up yet. Retry
					// rather than wait for an edit that may never come — a freshly
					// opened note that nobody types into must still get its layer.
					this.scheduleMountRetry();
					return;
				}

				this.notePath = notePath;
				// Re-arm the hydration gate. A remount after a settings toggle would
				// otherwise inherit `true` from the previous overlay, and a stroke
				// drawn in the few milliseconds before the disk read resolved could
				// save an empty document over the real one.
				this.hydrated = false;
				this.overlay = new MdInkOverlay(
					this.view,
					notePath,
					{
						brush: plugin.settings.mdInkBrush,
						size: plugin.settings.mdInkSize,
						colour: plugin.settings.mdInkColour,
						mouseDrawing: plugin.settings.mdInkMouseDrawing,
						fingerDraws: plugin.settings.mdInkFingerDraws,
						paper: plugin.settings.mdInkPaper,
						eraserRadius: plugin.settings.mdInkEraserRadius,
						shapeSnap: plugin.settings.mdInkShapeSnap,
						onChange: () => this.scheduleSave(),
						onToolSelected: (tool) => plugin.mdInk.setTool(tool),
						onStyleChange: (patch) => {
							if (patch.brush !== undefined) plugin.settings.mdInkBrush = patch.brush;
							if (patch.colour !== undefined) plugin.settings.mdInkColour = patch.colour;
							if (patch.size !== undefined) plugin.settings.mdInkSize = patch.size;
							if (patch.paper !== undefined) plugin.settings.mdInkPaper = patch.paper;
							if (patch.fingerDraws !== undefined) plugin.settings.mdInkFingerDraws = patch.fingerDraws;
							plugin.mdInk.refreshOptions(patch);
							void plugin.saveSettings();
						},
						getAiSettings: () => plugin.settings.customTranscriptionProvider,
					},
				);
				// Inherit the tool the user last chose; a new note must not silently
				// put the pen down in the middle of annotating.
				this.overlay.setTool(plugin.mdInk.tool);
				plugin.mdInk.register(notePath, this.overlay);
				void this.loadFor(notePath);
				maybeShowFirstUseHint();
			}

			/** Last-resort path: this editor is the active note's own view. */
			private resolveWithActiveFallback(): string | null {
				const active = plugin.app.workspace.getActiveFile();
				if (!active || active.extension !== 'md') return null;
				const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
				const activeCm = (activeView?.editor as unknown as { cm?: EditorView } | undefined)?.cm;
				return activeCm === this.view ? active.path : null;
			}

			/**
			 * Retry a failed mount on a short timer.
			 *
			 * Capped because a genuinely file-less editor (a scratch buffer, a
			 * hover preview) will never resolve; twenty attempts over ~1.2s covers
			 * Obsidian's layout pass without spinning forever.
			 */
			private scheduleMountRetry(): void {
				if (this.disposed || this.overlay || this.retryTimer) return;
				if (this.mountAttempts >= 20) return;
				this.mountAttempts++;
				this.retryTimer = setTimeout(() => {
					this.retryTimer = null;
					if (this.disposed || this.overlay) return;
					this.tryMount();
				}, 60);
			}

			private async loadFor(notePath: string, replace = false): Promise<void> {
				// A rename may still be copying the JSON into place; reading now
				// would return an empty document and the next save would persist it
				// over the real file.
				await plugin.mdInk?.awaitMove?.(notePath);
				const doc = await storage.load(notePath);
				if (this.disposed || this.notePath !== notePath) return;
				if (replace) {
					this.overlay?.replaceDocument(doc);
				} else {
					// Merge rather than replace: a fast first stroke can land
					// before this promise resolves, and replacing would delete it.
					this.overlay?.hydrateFromDisk(doc);
				}
				this.hydrated = true;
			}

			private scheduleSave(): void {
				// Never write a document that has not been hydrated: an empty
				// save overwrites the real file on disk.
				if (!this.hydrated) return;
				if (this.saveTimer) clearTimeout(this.saveTimer);
				this.saveTimer = setTimeout(() => {
					this.saveTimer = null;
					const overlay = this.overlay;
					if (!overlay || !this.notePath || !this.hydrated) return;
					void storage.save(overlay.getDocument());
				}, SAVE_DEBOUNCE_MS);
			}

			/**
			 * Unmount the layer.
			 *
			 * `permanent` separates the two callers: the view plugin being
			 * destroyed, and the settings switch being turned off. Only the first
			 * may leave the instance unusable, because only the first is followed
			 * by a new instance.
			 */
			private teardown(permanent: boolean): void {
				if (permanent) this.disposed = true;
				// A suspended instance gets a fresh retry budget: without it, a
				// feature switched back on in an editor whose first mount had failed
				// twenty times would never retry again.
				else this.mountAttempts = 0;
				if (this.saveTimer) {
					clearTimeout(this.saveTimer);
					this.saveTimer = null;
				}
				if (this.retryTimer) {
					clearTimeout(this.retryTimer);
					this.retryTimer = null;
				}
				if (this.overlay && this.notePath) {
					// A teardown before hydration means the editor is holding a
					// placeholder document. Writing it would destroy whatever is
					// on disk; leave the file alone instead.
					if (this.hydrated) void storage.save(this.overlay.getDocument());
					plugin.mdInk.unregister(this.notePath, this.overlay);
				}
				this.overlay?.destroy();
				this.overlay = null;
			}
		},
	);
}

/**
 * Nudge existing editors when the user changes notes.
 *
 * `registerEditorExtension` only affects editors created after it runs, so a
 * note that was already open when the plugin loaded has no layer and — without
 * an edit — no reason to update. A no-op transaction is the smallest way to
 * make every ViewPlugin.update run again, which is where a failed mount
 * retries. Without this the only fix is closing and reopening the note.
 */
/** Force every open Markdown editor through one update tick. */
export function nudgeAllEditors(plugin: MyPlugin): number {
	let nudged = 0;
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view.getViewType() !== 'markdown') return;
		const editor = (leaf.view as unknown as { editor?: { cm?: EditorView } }).editor;
		if (!editor?.cm) return;
		try {
			editor.cm.dispatch({});
			nudged++;
		} catch {
			/* A view mid-teardown can throw; the next nudge will catch it. */
		}
	});
	return nudged;
}

export function watchActiveNotes(plugin: MyPlugin): void {
	const nudge = (): void => {
		if (!plugin.settings.mdInkEnabled) return;
		plugin.mdInk?.reclampPills?.();
		const active = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = active?.editor as unknown as { cm?: EditorView } | undefined;
		const cm = editor?.cm;
		if (!cm) return;
		try {
			cm.dispatch({});
		} catch {
			/* A destroyed view can throw; the next event will retry. */
		}
	};

	plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', nudge));
	plugin.registerEvent(plugin.app.workspace.on('layout-change', nudge));

	// Mount whatever is already open. A reload must not require the user to
	// switch away from a tab and back before handwriting works in it.
	plugin.app.workspace.onLayoutReady(() => {
		nudge();
		// The layout settles a beat after "ready" on a cold start; one more pass
		// costs nothing and catches editors created during that beat.
		window.setTimeout(nudge, 900);
	});
}

/** Flush pending saves for every open overlay — used on unload and before reload. */
export async function flushAllMdInk(plugin: MyPlugin): Promise<void> {
	const storage = new MdInkStorage(plugin.app);
	const entries = plugin.mdInk.entries();
	await Promise.all(entries.map(([, overlay]) => storage.save(overlay.getDocument())));
}

export type { MdInkDocument };
