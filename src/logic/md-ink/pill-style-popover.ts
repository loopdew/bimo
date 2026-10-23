import { setIcon } from 'obsidian';
import { t } from 'src/i18n';
import {
	INK_BRUSH_PRESETS,
	INK_BRUSH_SIZE_STEPS,
	INK_BRUSH_SWATCHES,
	nearestBrushSizeStep,
	type InkBrushKind,
} from 'src/ink-canvas/brush-presets';
import type { MdInkEraserMode, MdInkPaper } from './types';

export const INK_ERASER_RADIUS_STEPS = [8, 14, 24, 38] as const;

export function nearestEraserRadiusStep(radius: number): number {
	let nearest: number = INK_ERASER_RADIUS_STEPS[0];
	let minDiff = Math.abs(radius - nearest);
	for (const step of INK_ERASER_RADIUS_STEPS) {
		const diff = Math.abs(radius - step);
		if (diff < minDiff) {
			minDiff = diff;
			nearest = step;
		}
	}
	return nearest;
}

export interface PillStyleState {
	brush: InkBrushKind;
	colour: string;
	size: number;
	paper?: MdInkPaper;
	eraserMode?: MdInkEraserMode;
	eraserRadius?: number;
	fingerDraws?: boolean;
}

export interface PillStylePatch {
	brush?: InkBrushKind;
	colour?: string;
	size?: number;
	paper?: MdInkPaper;
	eraserMode?: MdInkEraserMode;
	eraserRadius?: number;
	fingerDraws?: boolean;
}

export interface PillStylePopoverOptions {
	readonly pill: HTMLElement;
	readonly showPaper?: boolean;
	readonly getState: () => PillStyleState;
	readonly onChange: (patch: PillStylePatch) => void;
}

export interface PillStylePopoverHandle {
	readonly button: HTMLButtonElement;
	readonly popover: HTMLElement;
	sync(): void;
	open(): void;
	close(): void;
	destroy(): void;
}

const PAPER_ITEMS: ReadonlyArray<{ kind: MdInkPaper; labelKey: string }> = [
	{ kind: 'none', labelKey: 'None' },
	{ kind: 'ruled', labelKey: 'Ruled' },
	{ kind: 'grid', labelKey: 'Grid' },
	{ kind: 'dots', labelKey: 'Dots' },
];

export function createPillStylePopover(options: PillStylePopoverOptions): PillStylePopoverHandle {
	const { pill, showPaper = false, getState, onChange } = options;

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'bimo-md-ink-pill__style-btn';
	button.dataset.mdInkAction = 'style';
	button.title = t('Brush style');
	setIcon(button, 'palette');

	const popover = document.createElement('div');
	popover.className = 'bimo-md-ink-popover';
	popover.style.display = 'none';

	popover.addEventListener('pointerdown', (event) => {
		event.stopPropagation();
	});
	popover.addEventListener('click', (event) => {
		event.stopPropagation();
	});

	// 1. Brush presets
	const brushSection = document.createElement('div');
	brushSection.className = 'bimo-md-ink-popover__section';
	const brushLabel = document.createElement('div');
	brushLabel.className = 'bimo-md-ink-popover__label';
	brushLabel.textContent = t('Brush');
	const brushRow = document.createElement('div');
	brushRow.className = 'bimo-md-ink-popover__chips';

	for (const preset of INK_BRUSH_PRESETS) {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'bimo-md-ink-popover__chip';
		chip.dataset.mdInkBrush = preset.kind;
		chip.textContent = t(preset.label);
		chip.title = t(preset.label);
		chip.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onChange({ brush: preset.kind });
			sync();
		});
		brushRow.appendChild(chip);
	}
	brushSection.append(brushLabel, brushRow);
	popover.appendChild(brushSection);

	// 2. Colour swatches
	const colourSection = document.createElement('div');
	colourSection.className = 'bimo-md-ink-popover__section';
	const colourLabel = document.createElement('div');
	colourLabel.className = 'bimo-md-ink-popover__label';
	colourLabel.textContent = t('Colour');
	const colourRow = document.createElement('div');
	colourRow.className = 'bimo-md-ink-popover__swatches';

	for (const swatch of INK_BRUSH_SWATCHES) {
		const swatchBtn = document.createElement('button');
		swatchBtn.type = 'button';
		swatchBtn.className = 'bimo-md-ink-popover__swatch';
		swatchBtn.dataset.mdInkColour = swatch;
		swatchBtn.title = swatch === 'currentColor' ? t('Theme ink') : swatch;
		swatchBtn.style.background = swatch === 'currentColor' ? 'var(--text-normal)' : swatch;
		swatchBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onChange({ colour: swatch });
			sync();
		});
		colourRow.appendChild(swatchBtn);
	}
	colourSection.append(colourLabel, colourRow);
	popover.appendChild(colourSection);

	// 3. Stroke sizes
	const sizeSection = document.createElement('div');
	sizeSection.className = 'bimo-md-ink-popover__section';
	const sizeLabel = document.createElement('div');
	sizeLabel.className = 'bimo-md-ink-popover__label';
	sizeLabel.textContent = t('Stroke size');
	const sizeRow = document.createElement('div');
	sizeRow.className = 'bimo-md-ink-popover__sizes';

	const dotDiameters = [6, 10, 14];
	INK_BRUSH_SIZE_STEPS.forEach((step, idx) => {
		const sizeBtn = document.createElement('button');
		sizeBtn.type = 'button';
		sizeBtn.className = 'bimo-md-ink-popover__size';
		sizeBtn.dataset.mdInkSize = String(step);
		sizeBtn.title = `${t('Stroke size')}: ${step}`;
		const dot = document.createElement('span');
		dot.className = 'bimo-md-ink-popover__size-dot';
		const px = dotDiameters[idx] ?? 8;
		dot.style.width = `${px}px`;
		dot.style.height = `${px}px`;
		sizeBtn.appendChild(dot);
		sizeBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onChange({ size: step });
			sync();
		});
		sizeRow.appendChild(sizeBtn);
	});
	sizeSection.append(sizeLabel, sizeRow);
	popover.appendChild(sizeSection);

	// 4. Paper style (for Markdown notes)
	if (showPaper) {
		const paperSection = document.createElement('div');
		paperSection.className = 'bimo-md-ink-popover__section';
		const paperLabel = document.createElement('div');
		paperLabel.className = 'bimo-md-ink-popover__label';
		paperLabel.textContent = t('Paper');
		const paperRow = document.createElement('div');
		paperRow.className = 'bimo-md-ink-popover__chips';

		for (const item of PAPER_ITEMS) {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'bimo-md-ink-popover__chip';
			chip.dataset.mdInkPaper = item.kind;
			chip.textContent = t(item.labelKey);
			chip.title = t(item.labelKey);
			chip.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onChange({ paper: item.kind });
				sync();
			});
			paperRow.appendChild(chip);
		}
		paperSection.append(paperLabel, paperRow);
		popover.appendChild(paperSection);
	}

	// 5. Eraser mode (Object / Stroke vs Pixel / Partial)
	const eraserSection = document.createElement('div');
	eraserSection.className = 'bimo-md-ink-popover__section';
	const eraserLabel = document.createElement('div');
	eraserLabel.className = 'bimo-md-ink-popover__label';
	eraserLabel.textContent = t('Eraser mode');
	const eraserRow = document.createElement('div');
	eraserRow.className = 'bimo-md-ink-popover__chips';

	const ERASER_MODE_ITEMS: ReadonlyArray<{ mode: MdInkEraserMode; labelKey: string }> = [
		{ mode: 'stroke', labelKey: 'Object eraser' },
		{ mode: 'pixel', labelKey: 'Partial eraser' },
	];

	for (const item of ERASER_MODE_ITEMS) {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'bimo-md-ink-popover__chip';
		chip.dataset.mdInkEraserMode = item.mode;
		chip.textContent = t(item.labelKey);
		chip.title = t(item.labelKey);
		chip.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onChange({ eraserMode: item.mode });
			sync();
		});
		eraserRow.appendChild(chip);
	}
	eraserSection.append(eraserLabel, eraserRow);
	popover.appendChild(eraserSection);

	// 6. Eraser radius / size
	const eraserSizeSection = document.createElement('div');
	eraserSizeSection.className = 'bimo-md-ink-popover__section';
	const eraserSizeLabel = document.createElement('div');
	eraserSizeLabel.className = 'bimo-md-ink-popover__label';
	eraserSizeLabel.textContent = t('Eraser size');
	const eraserSizeRow = document.createElement('div');
	eraserSizeRow.className = 'bimo-md-ink-popover__sizes';

	const eraserDotDiameters = [6, 10, 15, 21];
	INK_ERASER_RADIUS_STEPS.forEach((step, idx) => {
		const sizeBtn = document.createElement('button');
		sizeBtn.type = 'button';
		sizeBtn.className = 'bimo-md-ink-popover__size bimo-md-ink-popover__eraser-size';
		sizeBtn.dataset.mdInkEraserRadius = String(step);
		sizeBtn.title = `${t('Eraser size')}: ${step}px`;
		const dot = document.createElement('span');
		dot.className = 'bimo-md-ink-popover__size-dot';
		const px = eraserDotDiameters[idx] ?? 10;
		dot.style.width = `${px}px`;
		dot.style.height = `${px}px`;
		sizeBtn.appendChild(dot);
		sizeBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onChange({ eraserRadius: step });
			sync();
		});
		eraserSizeRow.appendChild(sizeBtn);
	});
	eraserSizeSection.append(eraserSizeLabel, eraserSizeRow);
	popover.appendChild(eraserSizeSection);

	// 7. Touch input / Finger drawing quick toggle (for phones & tablets)
	const touchSection = document.createElement('div');
	touchSection.className = 'bimo-md-ink-popover__section bimo-md-ink-popover__section--inline';
	const fingerChip = document.createElement('button');
	fingerChip.type = 'button';
	fingerChip.className = 'bimo-md-ink-popover__chip bimo-md-ink-popover__finger-toggle';
	fingerChip.dataset.mdInkFingerDraws = 'toggle';
	fingerChip.textContent = t('Finger drawing');
	fingerChip.title = t('Toggle whether a finger draws or scrolls');
	fingerChip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const current = Boolean(getState().fingerDraws);
		onChange({ fingerDraws: !current });
		sync();
	});
	touchSection.appendChild(fingerChip);
	popover.appendChild(touchSection);

	let isOpen = false;

	function positionPopover(): void {
		const rect = pill.getBoundingClientRect();
		const viewportW = window.innerWidth || 800;
		const viewportH = window.innerHeight || 600;
		// Default is right: 0 (expands leftward from pill's right edge).
		// If pill's right edge is too close to the left side of the screen (< 250px),
		// align to left: 0 so it expands rightward instead.
		const alignLeft = rect.right < 250 && viewportW - rect.left >= rect.right;
		popover.classList.toggle('is-align-left', alignLeft);
		// Default is top: calc(100% + 6px). If pill is near the bottom of the screen,
		// open upward instead.
		const alignUp = viewportH - rect.bottom < 270 && rect.top > 270;
		popover.classList.toggle('is-align-up', alignUp);
	}

	function sync(): void {
		const state = getState();
		const nearestSize = nearestBrushSizeStep(state.size);

		for (const el of Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-md-ink-brush]'))) {
			el.classList.toggle('is-active', el.dataset.mdInkBrush === state.brush);
		}
		for (const el of Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-md-ink-colour]'))) {
			el.classList.toggle('is-active', el.dataset.mdInkColour === state.colour);
		}
		for (const el of Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-md-ink-size]'))) {
			el.classList.toggle('is-active', Number(el.dataset.mdInkSize) === nearestSize);
		}
		if (showPaper && state.paper) {
			for (const el of Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-md-ink-paper]'))) {
				el.classList.toggle('is-active', el.dataset.mdInkPaper === state.paper);
			}
		}
		if (state.eraserMode) {
			for (const el of Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-md-ink-eraser-mode]'))) {
				el.classList.toggle('is-active', el.dataset.mdInkEraserMode === state.eraserMode);
			}
		}
		if (state.eraserRadius !== undefined) {
			const nearestRadius = nearestEraserRadiusStep(state.eraserRadius);
			for (const el of Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-md-ink-eraser-radius]'))) {
				el.classList.toggle('is-active', Number(el.dataset.mdInkEraserRadius) === nearestRadius);
			}
		}
		if (state.fingerDraws !== undefined) {
			touchSection.style.display = '';
			fingerChip.classList.toggle('is-active', Boolean(state.fingerDraws));
		} else {
			touchSection.style.display = 'none';
		}
	}

	function setOpen(next: boolean): void {
		isOpen = next;
		popover.style.display = isOpen ? '' : 'none';
		button.classList.toggle('is-active', isOpen);
		if (isOpen) {
			positionPopover();
			sync();
		}
	}

	function open(): void {
		if (!isOpen) setOpen(true);
	}

	function close(): void {
		if (isOpen) setOpen(false);
	}

	button.addEventListener('pointerdown', (event) => {
		event.stopPropagation();
	});
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		setOpen(!isOpen);
	});

	const onWindowPointerDown = (event: PointerEvent) => {
		if (!isOpen) return;
		const target = event.target as Node | null;
		if (target && (pill.contains(target) || popover.contains(target))) return;
		close();
	};

	const onWindowKeyDown = (event: KeyboardEvent) => {
		if (isOpen && event.key === 'Escape') {
			close();
		}
	};

	window.addEventListener('pointerdown', onWindowPointerDown, true);
	window.addEventListener('keydown', onWindowKeyDown);

	pill.appendChild(popover);
	sync();

	return {
		button,
		popover,
		sync,
		open,
		close,
		destroy(): void {
			window.removeEventListener('pointerdown', onWindowPointerDown, true);
			window.removeEventListener('keydown', onWindowKeyDown);
			popover.remove();
		},
	};
}
