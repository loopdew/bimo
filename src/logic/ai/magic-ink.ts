//////////
//////////

/**
 * Watches a handwriting page and decides when a pause is long enough, and the
 * new ink substantial enough, to be worth an automatic reply.
 *
 * The old panel required the user to open a dialog and type a question. That is
 * a chat box wearing a parchment costume: the point of writing in the margin is
 * that you never leave the page. This watcher is the part that makes "write,
 * stop, and the answer writes itself back" possible.
 *
 * Three gates, each guarding a distinct failure:
 * - `idleMs` — answering mid-word is noise. Wait for an actual pause.
 * - `minNewStrokes` — a stray dot or a diacritic should not cost a request.
 * - `cooldownMs` — after a reply, the user often keeps writing immediately;
 *   without a cooldown every further stroke re-asks and the card flickers.
 */

export interface MagicInkWatcherOptions {
	/** Silence required before asking. */
	idleMs?: number;
	/** New strokes required since the last answer. */
	minNewStrokes?: number;
	/** Minimum gap between two answers. */
	cooldownMs?: number;
	/** Injectable clock, so the gates are testable without fake timers. */
	now?: () => number;
}

export const MAGIC_INK_DEFAULT_IDLE_MS = 1600;
export const MAGIC_INK_DEFAULT_MIN_NEW_STROKES = 2;
export const MAGIC_INK_DEFAULT_COOLDOWN_MS = 4000;

/**
 * Where the card should sit so it does not cover the line just written.
 *
 * A fixed bottom-right card is the wrong place half the time: people finish a
 * page at the bottom, and the answer then lands on top of the sentence that
 * prompted it. Measuring the last stroke against the page's own ink is enough
 * to pick the empty half.
 */
export function replyPlacementForLastStroke(
	strokes: ReadonlyArray<{ points?: ReadonlyArray<readonly [number, number, number]> }>,
): 'top' | 'bottom' {
	if (strokes.length === 0) return 'bottom';

	let minY = Infinity;
	let maxY = -Infinity;
	for (const stroke of strokes) {
		for (const point of stroke.points ?? []) {
			const y = point[1];
			if (!Number.isFinite(y)) continue;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) return 'bottom';

	const lastY = lastStrokeCentreY(strokes[strokes.length - 1]);
	if (!Number.isFinite(lastY)) return 'bottom';

	// Lower third of the written area: answer above, keep the last line visible.
	const ratio = (lastY - minY) / (maxY - minY);
	return ratio > 0.62 ? 'top' : 'bottom';
}

function lastStrokeCentreY(stroke: { points?: ReadonlyArray<readonly [number, number, number]> }): number {
	const points = stroke.points ?? [];
	if (points.length === 0) return NaN;
	let sum = 0;
	let count = 0;
	for (const point of points) {
		if (!Number.isFinite(point[1])) continue;
		sum += point[1];
		count += 1;
	}
	return count === 0 ? NaN : sum / count;
}

export class MagicInkWatcher {
	private readonly idleMs: number;
	private readonly minNewStrokes: number;
	private readonly cooldownMs: number;
	private readonly now: () => number;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private strokeCount = 0;
	/** Stroke count at the moment the last answer was requested. */
	private answeredAtStrokeCount = 0;
	private lastAnsweredAt = 0;
	private active = false;

	constructor(
		private readonly onIdle: () => void,
		options: MagicInkWatcherOptions = {},
	) {
		this.idleMs = options.idleMs ?? MAGIC_INK_DEFAULT_IDLE_MS;
		this.minNewStrokes = options.minNewStrokes ?? MAGIC_INK_DEFAULT_MIN_NEW_STROKES;
		this.cooldownMs = options.cooldownMs ?? MAGIC_INK_DEFAULT_COOLDOWN_MS;
		this.now = options.now ?? (() => Date.now());
	}

	get isActive(): boolean {
		return this.active;
	}

	/**
	 * Starts watching from the current page state, so enabling the mode on a
	 * page that already has ink does not immediately fire a request.
	 */
	start(strokeCount: number): void {
		this.active = true;
		this.strokeCount = strokeCount;
		this.answeredAtStrokeCount = strokeCount;
		// Starting the mode is not an answer: backdate the cooldown so the first
		// pause after enabling it is answered instead of silently dropped.
		this.lastAnsweredAt = this.now() - this.cooldownMs;
		this.clearTimer();
	}

	stop(): void {
		this.active = false;
		this.clearTimer();
	}

	/** Call on every stroke change coming out of the canvas. */
	touch(strokeCount: number): void {
		if (!this.active) return;
		this.strokeCount = strokeCount;
		this.clearTimer();
		this.timer = setTimeout(() => this.fireIfWorthwhile(), this.idleMs);
	}

	/**
	 * The request was sent (or skipped by the caller): remember it so the gates
	 * are measured from here, and keep the timer quiet until the next stroke.
	 */
	markAnswered(): void {
		this.answeredAtStrokeCount = this.strokeCount;
		this.lastAnsweredAt = this.now();
		this.clearTimer();
	}

	/** Exposed for tests and for the caller to check before spending a request. */
	shouldAsk(): boolean {
		if (!this.active) return false;
		const newStrokes = this.strokeCount - this.answeredAtStrokeCount;
		if (newStrokes < this.minNewStrokes) return false;
		return this.now() - this.lastAnsweredAt >= this.cooldownMs;
	}

	private fireIfWorthwhile(): void {
		this.timer = null;
		if (!this.shouldAsk()) return;
		this.markAnswered();
		this.onIdle();
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
