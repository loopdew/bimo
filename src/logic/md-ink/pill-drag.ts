/**
 * Drag behaviour shared by the floating ink pills.
 *
 * Both the note pill and the PDF pill used to carry their own copy of this
 * logic, and both copies had the same four defects:
 *
 * 1. The offset was computed from the press point every frame
 *    (`base + client - start`) while the result was clamped. Once the pill hit
 *    an edge, the pointer kept travelling; coming back it had to retrace that
 *    invisible overshoot before the pill moved again. That is the "it sticks
 *    to the edge and then jumps" feel.
 * 2. `pointerup` was bound to the pill itself. If the pointer was released
 *    outside it — which is normal when dragging a small pill quickly — the up
 *    event never arrived and the pill stayed in a dragging state.
 * 3. Only the tool buttons stopped `pointerdown`; undo and clear did not, so
 *    pressing them started a drag (and pointer capture then swallowed the
 *    click). Those two buttons were effectively dead.
 * 4. A position was saved as absolute viewport coordinates. Reopening after a
 *    sidebar resize put the pill somewhere else, or outside the editor.
 *
 * The replacement keeps a single running position, moves it by the pointer
 * delta, listens on `window` while a drag is active, ignores presses that
 * start on any control, and stores the position relative to the host so it
 * survives layout changes.
 */

export interface PillPosition {
	left: number;
	top: number;
}

export interface PillDragOptions {
	readonly pill: HTMLElement;
	/** Region the pill must stay inside. */
	readonly host: HTMLElement;
	readonly storageKey: string;
	/**
	 * `fixed` pills live in viewport coordinates; `absolute` ones are placed
	 * against `host`, which must therefore be positioned.
	 */
	readonly positioning: 'fixed' | 'absolute';
	/** Where the pill goes on first run, after a double-click, and after a reset. */
	readonly defaultPosition: (context: {
		host: DOMRect;
		pill: { width: number; height: number };
	}) => PillPosition;
}

export interface PillDragHandle {
	/** Remove every listener; safe to call more than once. */
	destroy(): void;
	/** Forget the stored position and go back to the default corner. */
	reset(): void;
	/** Re-clamp the current position after the window or host resized. */
	reclamp(): void;
}

/** A press that never moves further than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
/** Gap kept between the pill and the edge of its allowed area. */
const EDGE_GAP_PX = 4;
/** Controls that must never start a drag, whatever they are nested in. */
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [contenteditable="true"]';

/**
 * Bumped when the meaning of the stored numbers changes.
 *
 * Before this controller existed both pills stored viewport coordinates.
 * Reading one of those as a host-relative offset would place the pill at
 * `host.left + 704` — clamped to the far edge, which looks like the drag was
 * ignored. Old entries are discarded instead; the pill falls back to its
 * default corner once, and the next drag stores the new shape.
 */
const STORAGE_VERSION = 2;

interface StoredPosition {
	version: number;
	left: number;
	top: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function isStoredPosition(value: unknown): value is StoredPosition {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { version?: unknown; left?: unknown; top?: unknown };
	return candidate.version === STORAGE_VERSION
		&& typeof candidate.left === 'number' && Number.isFinite(candidate.left)
		&& typeof candidate.top === 'number' && Number.isFinite(candidate.top);
}

export function attachPillDrag(options: PillDragOptions): PillDragHandle {
	const { pill, host, storageKey, positioning, defaultPosition } = options;

	let dragging = false;
	let dragged = false;
	let activePointerId = -1;
	let startX = 0;
	let startY = 0;
	let lastX = 0;
	let lastY = 0;
	/** Current position in the pill's own coordinate space. */
	let current: PillPosition = { left: 0, top: 0 };
	/** Host rect captured when the press landed; refreshed when a drag ends. */
	let hostRect: DOMRect | null = null;
	let disposed = false;

	const pillSize = () => ({
		width: pill.offsetWidth || 180,
		height: pill.offsetHeight || 32,
	});

	/** Where the pill currently is, in the coordinate space named by `positioning`. */
	function readPosition(): PillPosition {
		const rect = pill.getBoundingClientRect();
		if (positioning === 'fixed') return { left: rect.left, top: rect.top };
		const bounds = hostRect ?? host.getBoundingClientRect();
		return { left: rect.left - bounds.left, top: rect.top - bounds.top };
	}

	function writePosition(position: PillPosition): void {
		pill.style.right = 'auto';
		pill.style.left = `${position.left}px`;
		pill.style.top = `${position.top}px`;
	}

	/**
	 * Keep the pill on screen.
	 *
	 * For `fixed` pills the allowed area is the host rect intersected with the
	 * viewport: the editor box is document-tall, so clamping to it alone would
	 * allow a position far below the visible area.
	 */
	function clampPosition(position: PillPosition, bounds: DOMRect): PillPosition {
		const size = pillSize();
		if (positioning === 'fixed') {
			const minLeft = Math.max(bounds.left, 0) + EDGE_GAP_PX;
			const minTop = Math.max(bounds.top, 0) + EDGE_GAP_PX;
			const maxLeft = Math.min(bounds.right, window.innerWidth || bounds.right) - size.width - EDGE_GAP_PX;
			const maxTop = Math.min(bounds.bottom, window.innerHeight || bounds.bottom) - size.height - EDGE_GAP_PX;
			return {
				left: clamp(position.left, minLeft, Math.max(minLeft, maxLeft)),
				top: clamp(position.top, minTop, Math.max(minTop, maxTop)),
			};
		}
		const maxLeft = bounds.width - size.width - EDGE_GAP_PX;
		const maxTop = bounds.height - size.height - EDGE_GAP_PX;
		return {
			left: clamp(position.left, EDGE_GAP_PX, Math.max(EDGE_GAP_PX, maxLeft)),
			top: clamp(position.top, EDGE_GAP_PX, Math.max(EDGE_GAP_PX, maxTop)),
		};
	}

	function readStored(): StoredPosition | null {
		try {
			const raw = window.localStorage.getItem(storageKey);
			if (!raw) return null;
			const parsed: unknown = JSON.parse(raw);
			return isStoredPosition(parsed) ? parsed : null;
		} catch {
			/* A corrupt or blocked preference must not stop the pill appearing. */
			return null;
		}
	}

	function store(position: PillPosition, bounds: DOMRect): void {
		const left = positioning === 'fixed' ? position.left - bounds.left : position.left;
		const top = positioning === 'fixed' ? position.top - bounds.top : position.top;
		try {
			window.localStorage.setItem(storageKey, JSON.stringify({ version: STORAGE_VERSION, left, top }));
		} catch {
			/* Storage can be full or blocked; the drag already took effect. */
		}
	}

	/**
	 * Stored positions are relative to the host, so a sidebar resize or a
	 * different window width keeps the pill in the same place relative to the
	 * note instead of drifting off the edge.
	 */
	function desiredFromStore(stored: StoredPosition, bounds: DOMRect): PillPosition {
		return positioning === 'fixed'
			? { left: bounds.left + stored.left, top: bounds.top + stored.top }
			: { left: stored.left, top: stored.top };
	}

	function placeDefault(): void {
		const bounds = host.getBoundingClientRect();
		const target = clampPosition(defaultPosition({ host: bounds, pill: pillSize() }), bounds);
		current = target;
		writePosition(target);
	}

	function place(): void {
		if (disposed) return;
		const bounds = host.getBoundingClientRect();
		const stored = readStored();
		const target = stored
			? clampPosition(desiredFromStore(stored, bounds), bounds)
			: clampPosition(defaultPosition({ host: bounds, pill: pillSize() }), bounds);
		current = target;
		writePosition(target);
	}

	function detachDragListeners(): void {
		window.removeEventListener('pointermove', onPointerMove, true);
		window.removeEventListener('pointerup', onPointerUp, true);
		window.removeEventListener('pointercancel', onPointerUp, true);
		window.removeEventListener('blur', onWindowBlur);
	}

	function finishDrag(event?: Event): void {
		if (!dragging) return;
		dragging = false;
		detachDragListeners();
		pill.classList.remove('is-dragging');
		try {
			if (activePointerId >= 0) pill.releasePointerCapture(activePointerId);
		} catch {
			/* The pointer may already be gone; nothing to release. */
		}
		activePointerId = -1;

		if (!dragged) return;
		dragged = false;
		const bounds = host.getBoundingClientRect();
		hostRect = bounds;
		current = clampPosition(current, bounds);
		writePosition(current);
		store(current, bounds);
		if (event) event.preventDefault?.();
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragging) return;
		if (activePointerId >= 0 && event.pointerId !== activePointerId) return;

		// A press that never leaves the threshold is a click on the pill body,
		// not a drag; moving the pill by a pixel on every tap reads as jitter.
		if (!dragged) {
			const totalX = Math.abs(event.clientX - startX);
			const totalY = Math.abs(event.clientY - startY);
			if (totalX < DRAG_THRESHOLD_PX && totalY < DRAG_THRESHOLD_PX) return;
			dragged = true;
		}

		const bounds = hostRect ?? host.getBoundingClientRect();
		hostRect = bounds;

		// Move by the delta since the previous frame, then clamp. When the pill
		// is stopped by an edge, `current` takes the clamped value, so the
		// overshoot is not accumulated and reversing direction moves immediately.
		const dx = event.clientX - lastX;
		const dy = event.clientY - lastY;
		lastX = event.clientX;
		lastY = event.clientY;
		if (dx === 0 && dy === 0) return;

		const next = clampPosition({ left: current.left + dx, top: current.top + dy }, bounds);
		current = next;
		writePosition(next);
		event.preventDefault();
	}

	function onPointerUp(event: PointerEvent): void {
		if (!dragging) return;
		if (activePointerId >= 0 && event.pointerId !== activePointerId) return;
		finishDrag(event);
	}

	function onWindowBlur(): void {
		// Alt-tabbing mid-drag never delivers pointerup; without this the pill
		// would keep following the pointer when focus returns.
		finishDrag();
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest(INTERACTIVE_SELECTOR)) return;

		event.preventDefault();
		event.stopPropagation();

		startX = event.clientX;
		startY = event.clientY;
		lastX = startX;
		lastY = startY;
		activePointerId = event.pointerId;
		hostRect = host.getBoundingClientRect();
		current = readPosition();
		dragging = true;
		dragged = false;
		pill.classList.add('is-dragging');

		try {
			pill.setPointerCapture(event.pointerId);
		} catch {
			/* Capture is an optimisation; the window listeners are what matter. */
		}

		window.addEventListener('pointermove', onPointerMove, true);
		window.addEventListener('pointerup', onPointerUp, true);
		window.addEventListener('pointercancel', onPointerUp, true);
		window.addEventListener('blur', onWindowBlur);
	}

	function onDoubleClick(event: MouseEvent): void {
		const target = event.target as HTMLElement | null;
		if (target?.closest(INTERACTIVE_SELECTOR)) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			window.localStorage.removeItem(storageKey);
		} catch {
			/* The visual reset is what the user asked for. */
		}
		placeDefault();
	}

	// Initial placement. A just-appended element has no box yet, so the first
	// pass sees width 0 and would clamp against the wrong edge.
	place();
	window.requestAnimationFrame(() => {
		if (!disposed) place();
	});

	pill.addEventListener('pointerdown', onPointerDown);
	pill.addEventListener('dblclick', onDoubleClick);

	return {
		destroy(): void {
			if (disposed) return;
			disposed = true;
			detachDragListeners();
			pill.removeEventListener('pointerdown', onPointerDown);
			pill.removeEventListener('dblclick', onDoubleClick);
		},
		reset(): void {
			try {
				window.localStorage.removeItem(storageKey);
			} catch {
				/* Ignore. */
			}
			placeDefault();
		},
		reclamp(): void {
			if (disposed) return;
			const bounds = host.getBoundingClientRect();

			// A pill the user never moved has no meaningful position to keep:
			// the first pass may have run before the editor had a box, which
			// clamps it into the top-left corner. Recompute the default instead
			// of preserving that accident.
			if (!readStored()) {
				const target = clampPosition(defaultPosition({ host: bounds, pill: pillSize() }), bounds);
				current = target;
				writePosition(target);
				return;
			}

			current = clampPosition(readPosition(), bounds);
			writePosition(current);
		},
	};
}
