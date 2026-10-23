import { Platform, type App } from 'obsidian';
import type { MdInkOverlay } from './md-ink-overlay';
import type { MdInkPaper, MdInkTool } from './types';

///////////////////////////
///////////////////////////

/**
 * Registry of live note overlays.
 *
 * Commands operate on "the note you are looking at", so the registry answers
 * that question from the active file instead of from editor focus: with the
 * pen in hand the editor never has focus, and `getActiveFile()` still points
 * at the right note.
 */
export class MdInkController {
	private readonly overlays = new Map<string, MdInkOverlay[]>();

	/**
	 * The tool the user last chose. Global rather than per-note: switching notes
	 * mid-annotation should not silently put the pen away, and a fresh overlay
	 * has no opinion of its own.
	 */
	tool: MdInkTool = 'pan';

	/**
	 * PDF overlays live outside the editor extension (Obsidian has none for PDF
	 * views), so they are fed by the same settings and tool changes through this
	 * sink. Unset until the PDF manager starts.
	 */
	pdfSink?: {
		setTool: (tool: MdInkTool) => void;
		setEnabled?: (enabled: boolean) => void;
		refreshOptions: (patch: {
			brush?: import('src/ink-canvas/brush-presets').InkBrushKind;
			size?: number;
			colour?: string;
			mouseDrawing?: boolean;
			fingerDraws?: boolean;
			eraserMode?: 'stroke' | 'pixel';
			eraserRadius?: number;
			shapeSnap?: boolean;
		}) => void;
	};

	/**
	 * Renames seen by the vault hook, keyed by the path the note used to have.
	 *
	 * The editor's own path check cannot tell "the user renamed this note" from
	 * "this tab now shows a different note" — both look like a changed path, and
	 * they need opposite treatment. This is the missing half: an explicit mark
	 * with a short lifetime, so a stale entry can never resurrect strokes onto an
	 * unrelated note.
	 */
	private readonly renames = new Map<string, { to: string; at: number }>();

	/** In-flight ink-file moves, keyed by the destination path. */
	private readonly moves = new Map<string, Promise<void>>();

	constructor(private readonly app: App) {
		this.installMobileSwipeGuard();
	}

	private installMobileSwipeGuard(): void {
		if (!Platform.isMobile) return;
		const workspace = this.app.workspace as any;
		if (!workspace) return;
		const proto = Object.getPrototypeOf(workspace);
		if (!proto || typeof proto.trigger !== 'function' || proto.trigger.__bimo_swipe_guard) return;

		const originalTrigger = proto.trigger;
		const self = this;
		proto.trigger = function (this: any, eventName: string, ...args: any[]) {
			try {
				// When actively in any writing or drawing tool (not pan), block ALL swipe gestures
				// (horizontal edge swipes opening sidebars, vertical pull-down opening command palette/quick action, etc.)
				if (eventName === 'swipe' || eventName === 'pull-down' || eventName === 'quick-action') {
					if (self.tool !== 'pan') {
						return this;
					}
				}
			} catch {
				/* fall through */
			}
			return originalTrigger.apply(this, [eventName, ...args]);
		};
		proto.trigger.__bimo_swipe_guard = true;

		// Intercept top-to-bottom drag gestures in capture phase
		// so Obsidian's pull-down Quick Action visual indicator / gesture engine never engages.
		if (typeof window !== 'undefined') {
			let touchStartY = 0;
			let touchStartX = 0;
			let isTopSwipeCandidate = false;

			const onTouchStart = (event: TouchEvent) => {
				if (self.tool === 'pan') {
					isTopSwipeCandidate = false;
					return;
				}
				if (event.touches.length !== 1) {
					isTopSwipeCandidate = false;
					return;
				}
				const touch = event.touches[0];
				touchStartY = touch.clientY;
				touchStartX = touch.clientX;

				const target = event.target as HTMLElement | null;
				if (target?.closest('button, input, select, textarea, .bimo-md-ink-pill, .bimo-magic-diary-banner, .bimo-magic-diary-reply')) {
					isTopSwipeCandidate = false;
					return;
				}

				// If starting in the top 140px of the screen or inside view-header/leaf header
				if (touchStartY < 140 || target?.closest('.view-header, .workspace-leaf-header, .view-actions')) {
					isTopSwipeCandidate = true;
				} else {
					isTopSwipeCandidate = false;
				}
			};

			const onTouchMove = (event: TouchEvent) => {
				if (!isTopSwipeCandidate || self.tool === 'pan') return;
				if (event.touches.length !== 1) return;
				const touch = event.touches[0];
				const dy = touch.clientY - touchStartY;
				const dx = touch.clientX - touchStartX;

				// If dragging downwards from top (dy > 12) dominantly over horizontal movement
				if (dy > 12 && Math.abs(dy) > Math.abs(dx)) {
					event.preventDefault();
					event.stopPropagation();
					event.stopImmediatePropagation();
				}
			};

			const onTouchEnd = () => {
				isTopSwipeCandidate = false;
			};

			window.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
			window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
			window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
			window.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
		}
	}

	/** Record that `from` became `to`, and keep the move promise for later reads. */
	noteRename(from: string, to: string, move: Promise<void>): void {
		this.renames.set(from, { to, at: Date.now() });
		this.moves.set(to, move);
		void move.finally(() => {
			if (this.moves.get(to) === move) this.moves.delete(to);
		});
	}

	/** Whether `to` is a rename of `from` (recent enough to act on). */
	wasRenamed(from: string, to: string): boolean {
		const entry = this.renames.get(from);
		if (!entry) return false;
		if (entry.to !== to) return false;
		if (Date.now() - entry.at > 10_000) {
			this.renames.delete(from);
			return false;
		}
		return true;
	}

	/**
	 * Wait for a pending ink-file move.
	 *
	 * Without this the overlay can save to the new key before the old file has
	 * been copied there, and the copy then lands on top of newer strokes.
	 */
	async awaitMove(path: string): Promise<void> {
		const pending = this.moves.get(path);
		if (pending) await pending;
	}

	register(notePath: string, overlay: MdInkOverlay): void {
		const list = this.overlays.get(notePath) ?? [];
		if (!list.includes(overlay)) list.push(overlay);
		this.overlays.set(notePath, list);
	}

	unregister(notePath: string, overlay: MdInkOverlay): void {
		const list = this.overlays.get(notePath);
		if (!list) return;
		const next = list.filter((item) => item !== overlay);
		if (next.length === 0) this.overlays.delete(notePath);
		else this.overlays.set(notePath, next);
	}

	entries(): Array<[string, MdInkOverlay]> {
		const result: Array<[string, MdInkOverlay]> = [];
		for (const [path, list] of this.overlays) {
			for (const overlay of list) result.push([path, overlay]);
		}
		return result;
	}

	/** The overlay belonging to the note in the active tab. */
	active(): MdInkOverlay | null {
		const path = this.app.workspace.getActiveFile()?.path;
		if (!path) return null;
		const list = this.overlays.get(path);
		return list && list.length > 0 ? list[list.length - 1] : null;
	}

	has(notePath: string): boolean {
		return (this.overlays.get(notePath)?.length ?? 0) > 0;
	}

	/** Every overlay, ordered so the active note comes last (last wins). */
	setToolEverywhere(tool: MdInkTool): void {
		for (const [, overlay] of this.entries()) overlay.setTool(tool);
	}

	/** Change the tool globally and on every mounted note and PDF at once. */
	setTool(tool: MdInkTool): void {
		this.tool = tool;
		if (typeof document !== 'undefined' && document.body) {
			document.body.classList.toggle('bimo-md-ink-writing-active', tool !== 'pan');
		}
		this.setToolEverywhere(tool);
		this.pdfSink?.setTool(tool);
	}

	/**
	 * Tear down every mounted overlay.
	 *
	 * Editor extensions are removed by Obsidian on unload, but a plugin reload
	 * can leave the DOM in place — verified in a live instance, where two SVGs
	 * both claimed page 1 after one reload. The layers are not owned by
	 * CodeMirror, so nothing else would remove them.
	 */
	destroyAll(): void {
		for (const [, overlay] of this.entries()) {
			try {
				overlay.destroy();
			} catch (error) {
				console.debug('[bimo] overlay destroy failed', error);
			}
		}
		this.overlays.clear();

		// Layers from a previous plugin instance have no registry entry to
		// remove them, and `.cm-scroller` is not cleaned by Obsidian either.
		for (const layer of Array.from(document.querySelectorAll('.bimo-md-ink-layer'))) layer.remove();
		for (const pill of Array.from(document.querySelectorAll('.bimo-md-ink-pill'))) pill.remove();
	}

	/** Apply a settings change to overlays that are already mounted. */
	refreshOptions(patch: Parameters<MdInkOverlay['setOptions']>[0]): void {
		for (const [, overlay] of this.entries()) overlay.setOptions(patch);
		this.pdfSink?.refreshOptions({
			brush: patch.brush,
			size: patch.size,
			colour: patch.colour,
			mouseDrawing: patch.mouseDrawing,
			fingerDraws: patch.fingerDraws,
			eraserMode: patch.eraserMode,
			eraserRadius: patch.eraserRadius,
			shapeSnap: patch.shapeSnap,
		});
	}

	/**
	 * Turn the ink layer on or off without remounting anything.
	 *
	 * Editor extensions cannot be unregistered once registered, so the toggle
	 * cannot uninstall the plugin's view plugin — it hides the layers instead.
	 * New editors check the setting before mounting at all.
	 */
	setEnabled(enabled: boolean): void {
		this.pdfSink?.setEnabled?.(enabled);
		if (!enabled) {
			for (const [, overlay] of this.entries()) {
				overlay.setEnabled(false);
			}
			this.tool = 'pan';
			return;
		}
		for (const [, overlay] of this.entries()) {
			overlay.setEnabled(true);
		}
	}

	setPaperEverywhere(paper: MdInkPaper): void {
		for (const [, overlay] of this.entries()) overlay.setPaper(paper);
	}

	/** Reclamp every mounted note pill (e.g. after switching tabs or resizing panes). */
	reclampPills(): void {
		for (const [, overlay] of this.entries()) overlay.reclampPill();
	}

	/**
	 * One line describing what is actually mounted.
	 *
	 * Reading source cannot tell you whether the editor extension fired, whether
	 * the ink file loaded, or whether the pill is in the DOM — and every one of
	 * those has a different fix. This makes the answer a single click.
	 */
	diagnose(): string {
		const entries = this.entries();
		const activePath = this.app.workspace.getActiveFile()?.path ?? '-';
		const parts = entries.map(([path, overlay]) => {
			const doc = overlay.getDocument();
			return `${path} strokes=${doc.strokes.length} tool=${overlay.getTool()}`;
		});
		const pills = document.querySelectorAll('.bimo-md-ink-pill').length;
		const layers = document.querySelectorAll('.bimo-md-ink-layer').length;

		// A mounted layer that still computes to `pointer-events: none` looks
		// identical to a working one from the outside — the cursor even changes.
		// Report both the resolved value and the painted box so a zero-sized
		// layer is distinguishable from an inert one.
		const layerEl = document.querySelector<HTMLElement>('.bimo-md-ink-layer');
		const pointerEvents = layerEl ? window.getComputedStyle(layerEl).pointerEvents : '-';
		const rect = layerEl?.getBoundingClientRect();
		const box = rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : '-';

		return `layers=${layers} pills=${pills} pe=${pointerEvents} box=${box} overlays=${entries.length} active=${activePath} | ${parts.join(' ; ') || 'none'}`;
	}
}
