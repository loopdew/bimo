import { attachPillDrag, type PillDragHandle } from 'src/logic/md-ink/pill-drag';

/**
 * The pill's own drag behaviour.
 *
 * These assert the four defects the shared controller replaced, one test each,
 * so a future rewrite cannot quietly reintroduce them:
 *
 * - pressing a control must not start a drag (undo / clear were dead),
 * - releasing outside the pill must end the drag (it used to keep following),
 * - hitting an edge must not accumulate invisible overshoot (it used to stick),
 * - the stored position is host-relative, so a resize keeps it in place.
 */

const HOST = { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 };
const KEY = 'test-pill-position';

function rect(left: number, top: number, width = 180, height = 32): DOMRect {
	return {
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
		x: left,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

function fire(target: EventTarget, type: string, x: number, y: number, extra: Record<string, unknown> = {}): void {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
	target.dispatchEvent(event);
}

interface Harness {
	pill: HTMLElement;
	host: HTMLElement;
	handle: PillDragHandle;
}

function mount(positioning: 'fixed' | 'absolute' = 'fixed'): Harness {
	const host = document.createElement('div');
	const pill = document.createElement('div');
	host.appendChild(pill);
	document.body.appendChild(host);

	host.getBoundingClientRect = () => rect(HOST.left, HOST.top, HOST.width, HOST.height);
	pill.getBoundingClientRect = () => {
		const left = Number.parseFloat(pill.style.left) || 0;
		const top = Number.parseFloat(pill.style.top) || 0;
		// An absolutely positioned pill paints relative to the host, so its
		// client rect is offset by the host's own box.
		return positioning === 'fixed'
			? rect(left, top)
			: rect(HOST.left + left, HOST.top + top);
	};

	const handle = attachPillDrag({
		pill,
		host,
		storageKey: KEY,
		positioning,
		// `absolute` pills are placed in host coordinates, `fixed` ones in
		// viewport coordinates; the default has to follow the same space.
		defaultPosition: ({ host: bounds, pill: size }) => ({
			left: bounds.right - size.width - 16,
			top: positioning === 'fixed' ? bounds.top + 8 : 8,
		}),
	});
	return { pill, host, handle };
}

function left(h: Harness): number {
	return Number.parseFloat(h.pill.style.left);
}

function top(h: Harness): number {
	return Number.parseFloat(h.pill.style.top);
}

describe('pill drag', () => {
	let originalRaf: typeof window.requestAnimationFrame;

	beforeEach(() => {
		window.localStorage.clear();
		// The controller re-places on the next frame; letting that run would
		// repair the position mid-assertion and hide exactly what is under test.
		originalRaf = window.requestAnimationFrame;
		window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
	});

	afterEach(() => {
		window.requestAnimationFrame = originalRaf;
		document.body.innerHTML = '';
	});

	it('places itself at the default corner when nothing is stored', () => {
		const h = mount();
		// host.right (900) - width (180) - 16
		expect(left(h)).toBe(704);
		expect(top(h)).toBe(58);
	});

	it('moves by the pointer delta and stores a host-relative position', () => {
		const h = mount();
		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 300, 80);
		expect(left(h)).toBe(604);
		// The host's visible top is 50, so the pill cannot go above 54.
		expect(top(h)).toBe(54);

		fire(window, 'pointerup', 300, 80);

		const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { left: number; top: number };
		// Relative to the host, not to the viewport.
		expect(stored.left).toBe(504);
		expect(stored.top).toBe(4);
	});

	it('treats a press that never leaves the threshold as a click', () => {
		const h = mount();
		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 401, 100);
		expect(left(h)).toBe(704);
		fire(window, 'pointerup', 401, 100);
		expect(window.localStorage.getItem(KEY)).toBeNull();
	});

	it('does not start a drag from a control inside the pill', () => {
		const h = mount();
		const button = document.createElement('button');
		h.pill.appendChild(button);
		fire(button, 'pointerdown', 400, 100);
		expect(h.pill.classList.contains('is-dragging')).toBe(false);
	});

	it('ends the drag when the pointer is released outside the pill', () => {
		const h = mount();
		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 350, 100);
		fire(window, 'pointerup', 350, 100);

		expect(h.pill.classList.contains('is-dragging')).toBe(false);
		const before = left(h);
		fire(window, 'pointermove', 200, 100);
		expect(left(h)).toBe(before);
	});

	it('does not accumulate overshoot after being clamped at an edge', () => {
		const h = mount();
		fire(h.pill, 'pointerdown', 400, 100);

		// Push far past the right edge; the pill stops at the clamp.
		fire(window, 'pointermove', 900, 100);
		const clamped = left(h);
		// visible right (900) - width (180) - gap (4)
		expect(clamped).toBe(716);

		// One pixel back must move it one pixel back, not retrace 200px of
		// invisible travel first.
		fire(window, 'pointermove', 890, 100);
		expect(left(h)).toBe(706);
	});

	it('restores the stored position on the next mount', () => {
		const first = mount();
		fire(first.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 320, 90);
		fire(window, 'pointerup', 320, 90);
		const savedLeft = left(first);
		first.handle.destroy();

		const second = mount();
		expect(left(second)).toBe(savedLeft);
	});

	it('returns to the default corner on double-click', () => {
		const h = mount();
		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 320, 90);
		fire(window, 'pointerup', 320, 90);
		expect(window.localStorage.getItem(KEY)).not.toBeNull();

		fire(h.pill, 'dblclick', 320, 90);
		expect(window.localStorage.getItem(KEY)).toBeNull();
		expect(left(h)).toBe(704);
	});

	it('recomputes the default on reclamp when nothing was ever dragged', () => {
		const h = mount();
		// Simulate the first pass running before the editor had a box: the pill
		// was clamped into the corner and must not stay there.
		h.pill.style.left = '4px';
		h.pill.style.top = '4px';
		h.handle.reclamp();
		expect(left(h)).toBe(704);
		expect(top(h)).toBe(58);
	});

	it('keeps a dragged position on reclamp, clamped to the new host box', () => {
		const h = mount();
		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 300, 80);
		fire(window, 'pointerup', 300, 80);
		const dragged = left(h);

		h.handle.reclamp();
		expect(left(h)).toBe(dragged);
	});

	it('ignores a position stored by the old viewport-coordinate format', () => {
		// Written by the previous implementation: no `version`, and the numbers
		// are viewport coordinates. Reading them as host-relative offsets would
		// park the pill at the far edge.
		window.localStorage.setItem(KEY, JSON.stringify({ left: 704, top: 58 }));
		const h = mount();
		expect(left(h)).toBe(704);
		expect(top(h)).toBe(58);
	});

	it('stops responding once destroyed', () => {
		const h = mount();
		h.handle.destroy();
		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 200, 100);
		expect(left(h)).toBe(704);
	});

	it('clamps inside the host box for absolute positioning', () => {
		const h = mount('absolute');
		// Right edge of the host minus the pill and the gap.
		// Clamped to the host's own width, not to the viewport.
		expect(left(h)).toBe(616);

		fire(h.pill, 'pointerdown', 400, 100);
		fire(window, 'pointermove', 900, 400);
		expect(left(h)).toBe(616);
		expect(top(h)).toBe(308);
	});
});
