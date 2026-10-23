import { MagicInkWatcher, replyPlacementForLastStroke } from 'src/logic/ai/magic-ink';

describe('MagicInkWatcher', () => {
	let now = 0;
	let fired = 0;

	beforeEach(() => {
		jest.useFakeTimers();
		now = 100_000;
		fired = 0;
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	function build(overrides: Partial<{ idleMs: number; minNewStrokes: number; cooldownMs: number }> = {}) {
		return new MagicInkWatcher(() => { fired += 1; }, {
			idleMs: 1000,
			minNewStrokes: 2,
			cooldownMs: 3000,
			now: () => now,
			...overrides,
		});
	}

	it('does nothing before start()', () => {
		const watcher = build();
		watcher.touch(10);
		jest.advanceTimersByTime(5000);
		expect(fired).toBe(0);
	});

	it('fires after a pause when enough new strokes were written', () => {
		const watcher = build();
		watcher.start(0);
		watcher.touch(3);
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(1);
	});

	it('ignores a pause during which almost nothing was written', () => {
		const watcher = build();
		watcher.start(10);
		watcher.touch(11); // one stroke — a dot is not a thought
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(0);
	});

	it('restarts the idle window on every new stroke', () => {
		const watcher = build();
		watcher.start(0);
		watcher.touch(3);
		jest.advanceTimersByTime(800);
		watcher.touch(4);
		jest.advanceTimersByTime(800);
		expect(fired).toBe(0); // only 800 ms of silence since the last stroke
		jest.advanceTimersByTime(300);
		expect(fired).toBe(1);
	});

	it('respects the cooldown right after an answer', () => {
		const watcher = build();
		watcher.start(0);
		watcher.touch(5);
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(1);

		// The writer keeps going immediately: more ink, but inside the cooldown.
		now += 1000;
		watcher.touch(9);
		jest.advanceTimersByTime(2000);
		expect(fired).toBe(1);

		now += 3000;
		watcher.touch(10);
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(2);
	});

	it('measures new strokes from the last answer, not the last stroke', () => {
		const watcher = build({ cooldownMs: 0 });
		watcher.start(0);
		watcher.touch(4);
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(1);

		// Three more strokes then silence: worth asking again.
		watcher.touch(7);
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(2);

		// One more stroke: below the threshold.
		watcher.touch(8);
		jest.advanceTimersByTime(1000);
		expect(fired).toBe(2);
	});

	it('stops cleanly and never fires after stop()', () => {
		const watcher = build();
		watcher.start(0);
		watcher.touch(6);
		watcher.stop();
		jest.advanceTimersByTime(10_000);
		expect(fired).toBe(0);
	});

	it('starting on a page that already has ink does not fire immediately', () => {
		const watcher = build();
		watcher.start(40);
		jest.advanceTimersByTime(5000);
		expect(fired).toBe(0);
	});
});

describe('replyPlacementForLastStroke', () => {
	const stroke = (ys: number[]) => ({
		points: ys.map((y) => [0, y, 0.5] as const),
	});

	it('falls back to the bottom card when the page is empty', () => {
		expect(replyPlacementForLastStroke([])).toBe('bottom');
	});

	it('answers above the ink when the last line is at the bottom', () => {
		const strokes = [
			stroke([100, 110]),
			stroke([500, 520]),
		];
		expect(replyPlacementForLastStroke(strokes)).toBe('top');
	});

	it('keeps the card at the bottom when the last line is near the top', () => {
		const strokes = [
			stroke([600, 620]),
			stroke([120, 130]),
		];
		expect(replyPlacementForLastStroke(strokes)).toBe('bottom');
	});

	it('ignores strokes with no points instead of returning NaN', () => {
		const strokes = [{ points: [] }, stroke([300, 310]), { points: [] }];
		expect(['top', 'bottom']).toContain(replyPlacementForLastStroke(strokes));
	});

	it('returns bottom when every point is on one line', () => {
		expect(replyPlacementForLastStroke([stroke([200, 200, 200])])).toBe('bottom');
	});
});
