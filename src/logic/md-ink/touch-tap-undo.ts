export interface TouchTapUndoOptions {
	onUndo: () => void;
	onRedo: () => void;
	/** Maximum duration (ms) between first touchstart and last touchend for a valid tap. */
	maxDurationMs?: number;
	/** Maximum movement (px) allowed for any finger before the gesture is treated as a pan/pinch. */
	maxMovePx?: number;
}

export interface TouchTapUndoHandle {
	destroy(): void;
}

interface TrackedTouch {
	startX: number;
	startY: number;
}

/**
 * Industry-standard tablet/mobile handwriting gestures (Procreate / GoodNotes / Concepts):
 * - Two-finger quick tap -> Undo
 * - Three-finger quick tap -> Redo
 *
 * Strictly bounded by time (<= 280ms) and movement (<= 14px) so pinch-to-zoom and
 * two-finger scrolling are never falsely triggered.
 */
export function attachTouchTapUndo(
	target: HTMLElement | SVGElement,
	options: TouchTapUndoOptions,
): TouchTapUndoHandle {
	const maxDurationMs = options.maxDurationMs ?? 280;
	const maxMovePx = options.maxMovePx ?? 14;

	let gestureStartTime = 0;
	let maxTouchCount = 0;
	let cancelled = false;
	const startPositions = new Map<number, TrackedTouch>();

	const reset = () => {
		gestureStartTime = 0;
		maxTouchCount = 0;
		cancelled = false;
		startPositions.clear();
	};

	const onTouchStart = (event: TouchEvent) => {
		const now = Date.now();
		if (startPositions.size === 0 && maxTouchCount === 0) {
			gestureStartTime = now;
			cancelled = false;
		}

		for (let i = 0; i < event.changedTouches.length; i += 1) {
			const t = event.changedTouches[i];
			startPositions.set(t.identifier, { startX: t.clientX, startY: t.clientY });
		}

		const currentCount = event.touches.length;
		if (currentCount > maxTouchCount) {
			maxTouchCount = currentCount;
		}
		if (maxTouchCount > 3) {
			cancelled = true;
		}
	};

	const onTouchMove = (event: TouchEvent) => {
		if (cancelled || maxTouchCount < 2) return;
		for (let i = 0; i < event.changedTouches.length; i += 1) {
			const t = event.changedTouches[i];
			const start = startPositions.get(t.identifier);
			if (!start) continue;
			if (Math.hypot(t.clientX - start.startX, t.clientY - start.startY) > maxMovePx) {
				cancelled = true;
				return;
			}
		}
	};

	const onTouchEnd = (event: TouchEvent) => {
		if (!cancelled && maxTouchCount >= 2 && event.touches.length === 0) {
			const elapsed = Date.now() - gestureStartTime;
			if (elapsed <= maxDurationMs) {
				for (let i = 0; i < event.changedTouches.length; i += 1) {
					const t = event.changedTouches[i];
					const start = startPositions.get(t.identifier);
					if (start && Math.hypot(t.clientX - start.startX, t.clientY - start.startY) > maxMovePx) {
						cancelled = true;
						break;
					}
				}
				if (!cancelled) {
					if (maxTouchCount === 2) {
						options.onUndo();
					} else if (maxTouchCount === 3) {
						options.onRedo();
					}
				}
			}
		}

		if (event.touches.length === 0) {
			reset();
		}
	};

	const onTouchCancel = () => {
		reset();
	};

	target.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
	target.addEventListener('touchmove', onTouchMove as EventListener, { passive: true });
	target.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
	target.addEventListener('touchcancel', onTouchCancel as EventListener, { passive: true });

	return {
		destroy() {
			target.removeEventListener('touchstart', onTouchStart as EventListener);
			target.removeEventListener('touchmove', onTouchMove as EventListener);
			target.removeEventListener('touchend', onTouchEnd as EventListener);
			target.removeEventListener('touchcancel', onTouchCancel as EventListener);
			reset();
		},
	};
}
