import './brush-menu.scss';
import * as React from 'react';
import classNames from 'classnames';
import { t } from 'src/i18n';
import { TooltipButton } from 'src/components/jsx-components/tooltip-button/tooltip-button';
import {
	INK_BRUSH_PRESETS,
	INK_BRUSH_SWATCHES,
	INK_BRUSH_SIZE_STEPS,
	getBrushPreset,
	isInkBrushKind,
	nearestBrushSizeStep,
	type InkBrushKind,
} from 'src/ink-canvas/brush-presets';
import { fetchLocally, saveLocally } from 'src/logic/utils/storage';
import type { InkCanvasEditor } from 'src/ink-canvas/types';

//////////
//////////

const BRUSH_PREFS_STORAGE_SUFFIX = 'brushPreferencesV1';

interface BrushPreferences {
	brush: InkBrushKind;
	colour: string;
	size: number;
}

const DEFAULT_PREFERENCES: BrushPreferences = {
	brush: 'pen',
	colour: 'currentColor',
	size: 4,
};

/**
 * A brush that ships its own ink (the highlighter) must never keep the theme
 * colour: `currentColor` is resolved against the theme text colour in the
 * editor, and against print-safe black in the exported SVG, so the wash came
 * out as grey as soon as the block was locked.
 */
function normalizePreferences(preferences: BrushPreferences): BrushPreferences {
	const preset = getBrushPreset(preferences.brush);
	if (preset.defaultColour !== 'currentColor' && preferences.colour === 'currentColor') {
		return { ...preferences, colour: preset.defaultColour };
	}
	return preferences;
}

function readPreferences(): BrushPreferences {
	try {
		const raw = fetchLocally(BRUSH_PREFS_STORAGE_SUFFIX);
		if (typeof raw !== 'string') return { ...DEFAULT_PREFERENCES };
		const parsed = JSON.parse(raw) as Partial<BrushPreferences>;
		return normalizePreferences({
			brush: isInkBrushKind(parsed.brush) ? parsed.brush : DEFAULT_PREFERENCES.brush,
			colour: typeof parsed.colour === 'string' && parsed.colour.length > 0
				? parsed.colour
				: DEFAULT_PREFERENCES.colour,
			size: typeof parsed.size === 'number' && Number.isFinite(parsed.size) && parsed.size > 0
				? parsed.size
				: DEFAULT_PREFERENCES.size,
		});
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

function writePreferences(preferences: BrushPreferences): void {
	try {
		saveLocally(BRUSH_PREFS_STORAGE_SUFFIX, JSON.stringify(preferences));
	} catch {
		// A read-only or popout localStorage must never break drawing.
	}
}

/**
 * Swatch rendering: `currentColor` has no CSS value of its own, so the dot falls
 * back to the theme's text colour via a dedicated class.
 */
function swatchStyle(colour: string): React.CSSProperties {
	return colour === 'currentColor'
		? {}
		: { background: colour };
}

//////////
//////////

interface InkCanvasBrushMenuProps {
	getEditor: () => InkCanvasEditor | undefined;
	onStoreChange: () => void;
}

/**
 * Brush picker for the ink toolbar: five brush presets, a colour row and three
 * size steps. Every change is pushed into the live editor immediately and
 * remembered per device, so the next handwriting block opens with the same pen.
 */
export const InkCanvasBrushMenu: React.FC<InkCanvasBrushMenuProps> = (props) => {
	const [isOpen, setIsOpen] = React.useState(false);
	const [preferences, setPreferences] = React.useState<BrushPreferences>(() => readPreferences());
	const appliedOnceRef = React.useRef(false);

	// The editor becomes available a tick after the menu mounts. Apply the stored
	// preference on the first tick it exists, exactly once per menu instance.
	React.useEffect(() => {
		let timerId: number | undefined;
		const tryApply = (): boolean => {
			const editor = props.getEditor();
			if (!editor) return false;
			if (!appliedOnceRef.current) {
				appliedOnceRef.current = true;
				const initial = readPreferences();
				editor.setStrokeStyle({
					brush: initial.brush,
					color: initial.colour,
					size: initial.size,
					opacity: getBrushPreset(initial.brush).opacity,
				});
			}
			return true;
		};

		if (!tryApply()) {
			timerId = window.setInterval(() => {
				if (tryApply() && timerId !== undefined) {
					window.clearInterval(timerId);
					timerId = undefined;
				}
			}, 100);
		}

		return () => {
			if (timerId !== undefined) window.clearInterval(timerId);
		};
	}, [props.getEditor]);

	function applyPreferences(raw: BrushPreferences): void {
		const next = normalizePreferences(raw);
		setPreferences(next);
		writePreferences(next);
		const editor = props.getEditor();
		if (!editor) return;
		editor.setStrokeStyle({
			brush: next.brush,
			color: next.colour,
			size: next.size,
			opacity: getBrushPreset(next.brush).opacity,
		});
		props.onStoreChange();
	}

	function selectBrush(brush: InkBrushKind): void {
		const preset = getBrushPreset(brush);
		// Picking a brush that ships with its own ink (the highlighter) should not
		// silently keep a red pen colour.
		const colour = preset.defaultColour !== 'currentColor' && preferences.colour === 'currentColor'
			? preset.defaultColour
			: preferences.colour;
		applyPreferences({ ...preferences, brush, colour });
	}

	//////////
	//////////

	const activePreset = getBrushPreset(preferences.brush);

	return (
		<div className="ddc_ink_brush-menu">
			{/*
			 * The trigger shows the ink itself: a swatch of the current stroke
			 * (weight, colour, translucency) above a small chevron. A pen glyph
			 * answered "which tool is active" — the same question the Draw
			 * button beside it already answers — and said nothing about the pen
			 * you are about to draw with.
			 */}
			<TooltipButton
				tooltip={t('Brush style')}
				className={isOpen ? 'ink_menu-toggle--active' : undefined}
				onClick={() => setIsOpen((open) => !open)}
			>
				<span className="ddc_ink_brush-trigger" aria-hidden="true">
					<span
						className="ddc_ink_brush-trigger__stroke"
						style={{
							height: `${Math.max(2, Math.round(preferences.size * 1.1))}px`,
							backgroundColor: preferences.colour === 'currentColor' ? 'currentColor' : preferences.colour,
							opacity: activePreset.opacity,
						}}
					/>
					<span className="ddc_ink_brush-trigger__chevron" />
				</span>
			</TooltipButton>

			{isOpen && (
				<div className="ddc_ink_brush-panel">
					<div className="ddc_ink_brush-panel__section">
						{INK_BRUSH_PRESETS.map((preset) => (
							<button
								key={preset.kind}
								className={classNames(
									'ddc_ink_brush-panel__brush',
									preferences.brush === preset.kind && 'is-active',
								)}
								onClick={() => selectBrush(preset.kind)}
							>
								<span
									className="ddc_ink_brush-panel__stroke"
									data-brush={preset.kind}
									style={{
										opacity: preset.opacity,
										backgroundColor: preset.defaultColour === 'currentColor'
											? 'var(--text-normal)'
											: preset.defaultColour,
									}}
								/>
								<span className="ddc_ink_brush-panel__label">{t(preset.label)}</span>
							</button>
						))}
					</div>

					<div className="ddc_ink_brush-panel__section ddc_ink_brush-panel__section--swatches">
						{INK_BRUSH_SWATCHES.map((colour) => (
							<button
								key={colour}
								className={classNames(
									'ddc_ink_brush-panel__swatch',
									colour === preferences.colour && 'is-active',
									colour === 'currentColor' && 'ddc_ink_brush-panel__swatch--theme',
								)}
								style={swatchStyle(colour)}
								aria-label={colour}
								onClick={() => applyPreferences({ ...preferences, colour })}
							/>
						))}
					</div>

					<div className="ddc_ink_brush-panel__section ddc_ink_brush-panel__section--sizes">
						{INK_BRUSH_SIZE_STEPS.map((size) => (
							<button
								key={size}
								className={classNames(
									'ddc_ink_brush-panel__size',
									nearestBrushSizeStep(preferences.size) === size && 'is-active',
								)}
								onClick={() => applyPreferences({ ...preferences, size })}
								aria-label={String(size)}
							>
								<span
									className="ddc_ink_brush-panel__dot"
									style={{
										width: `${Math.round(7 + size * 2)}px`,
										height: `${Math.round(7 + size * 2)}px`,
									}}
								/>
							</button>
						))}
					</div>

					{/*
					 * No explanatory line here. The swatch above already draws
					 * the brush at its real weight, colour and translucency, so
					 * a sentence saying "this one is translucent" repeated what
					 * the eye can see — and read like a missing control.
					 */}
				</div>
			)}
		</div>
	);
};

export default InkCanvasBrushMenu;
