////////
////////

// Settings shape introduced in 0.5.0.
// Adds settingsVersion and four new fields that were not in 0.4.0.

import {
	DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers/types';
import { PluginSettings_0_4_0 } from './plugin-settings_0_4_0';

export type DominantHand = 'left' | 'right';

/** `auto` follows Obsidian / system locale; the others force a language. */
export type UiLanguage = 'auto' | 'en' | 'zh-cn';

export interface PluginSettings_0_5_0 extends PluginSettings_0_4_0 {
	settingsVersion: string,
	/** Interface language for 笔墨's own UI. */
	uiLanguage: UiLanguage,
	// General (new in 0.5.0)
	gettingStartedExpanded: boolean,
	debugLoggingEnabled: boolean,
	dominantHand: DominantHand,
	// Writing specific (new in 0.5.0)
	writingBufferLines: number,
	writingLineHeight: number,
	/** Auto-enqueue handwriting transcription when a writing embed locks or dedicated view closes. */
	writingAutoTranscribeOnClose: boolean,
	/** Minimum stroke change (0–95%) before writing auto-transcribe runs again; 0 = always. */
	writingAutoTranscribeChangeThresholdPercent: number,
	// Drawing specific (new in 0.5.0)
	drawingGridEnabledByDefault: boolean,
	/** Auto-enqueue handwriting transcription when a drawing embed locks or dedicated view closes. */
	drawingAutoTranscribeOnClose: boolean,
	/** Minimum stroke change (0–95%) before drawing auto-transcribe runs again; 0 = always. */
	drawingAutoTranscribeChangeThresholdPercent: number,
	// Transcription endpoint (new) — user-owned OpenAI-compatible API
	/** When enabled, replaces the Almost Useful portal for every transcription. */
	customTranscriptionProvider: CustomTranscriptionProviderSettings,
	/**
	 * After a transcription, mirror the text as a collapsible block directly below
	 * the embed in every note that references it. Off by default: silently growing
	 * a note is a strong side effect. The block is delimited by HTML comments so a
	 * later transcription can replace it without touching surrounding prose.
	 */
	insertTranscriptBelowEmbed: boolean,
	/**
	 * Ask the same endpoint for a one-line caption and use it as the embed's image
	 * alt instead of the collapsed transcript. Costs one extra request per page.
	 */
	aiCaptionOnTranscribe: boolean,
	/**
	 * Magic pen: how long the pen must be still before the page is sent for a
	 * margin reply. Short values interrupt mid-thought; long ones feel dead.
	 */
	magicInkIdleMs: number,
	/**
	 * How many new strokes count as "I wrote something worth answering".
	 * One dot is not a thought, and every request costs money.
	 */
	magicInkMinStrokes: number,

	// ── PDF annotation ────────────────────────────────────────────
	/**
	 * Where an annotation block goes when no note is open.
	 * `auto-create` names a new note from the template; `fixed` always appends to
	 * the one note configured below.
	 */
	pdfAnnotationNoteMode: 'auto-create' | 'fixed',
	/**
	 * Filename template for `auto-create`. Supports `{pdf}` and `{date}`.
	 * Kept as a setting because the right convention differs per vault: some
	 * people want one note per lecture, others one note per PDF.
	 */
	pdfAnnotationNoteTemplate: string,
	/** Vault path of the note used by `fixed` mode. */
	pdfAnnotationFixedNotePath: string,
	/** Whether the annotation note is brought to the front after inserting. */
	pdfAnnotationOpenMode: 'background' | 'foreground',

	// ── 笔墨 directly on notes ─────────────────────────────────────
	/**
	 * Mount a transparent ink layer over every Markdown editor.
	 *
	 * The layer starts in pan mode, so turning this on changes nothing about
	 * normal editing until a drawing tool is selected.
	 */
	mdInkEnabled: boolean,
	/** Brush used for new strokes on notes. */
	mdInkBrush: 'pen' | 'pencil' | 'technical' | 'marker' | 'highlighter' | 'crayon' | 'brush',
	/** Base stroke size; the brush preset multiplies it. */
	mdInkSize: number,
	/** Colour, or `currentColor` to follow the theme. */
	mdInkColour: string,
	/** When false, only a stylus draws — a mouse keeps selecting text. */
	mdInkMouseDrawing: boolean,
	/**
	 * When true a finger draws too, which takes the touch stream away from the
	 * editor. Off keeps a one-finger drag scrolling the note — what a tablet expects.
	 */
	mdInkFingerDraws: boolean,
	/** Set once the shipped-default correction has run; afterwards the value is the user's. */
	mdInkMouseDrawingMigrated?: boolean,
	/** Paper texture drawn under the ink: none, ruled, grid or dots. */
	mdInkPaper: 'none' | 'ruled' | 'grid' | 'dots',
	/** Eraser mode: stroke (整笔擦除) or pixel (局部/像素擦除). */
	mdInkEraserMode: 'stroke' | 'pixel',
	/** Eraser hit radius in CSS px. */
	mdInkEraserRadius: number,
	/** Straighten near-straight strokes into lines and near-closed loops into rectangles. */
	mdInkShapeSnap: boolean,
	/** Magic diary response style preset. */
	magicDiaryPreset: 'chat' | 'explain' | 'brainstorm' | 'solver' | 'custom',
	/** Optional user-defined system prompt for magic diary page turns. */
	magicDiaryCustomPrompt: string,
}

export const DEFAULT_PLUGIN_SETTINGS_0_5_0: PluginSettings_0_5_0 = {
	settingsVersion: '0.5.0',	// Settings version aligns with the plugin version it was introduced in
	// Interface
	uiLanguage: 'auto',
	// Helpers
	onboardingTips: {
		welcomeTipRead: false,
		strokeLimitTipRead: false,
		lastVersionTipRead: '',
	},
	// General
	gettingStartedExpanded: true,
	customAttachmentFolders: false,
	noteAttachmentFolderLocation: 'obsidian',
	notelessAttachmentFolderLocation: 'obsidian',
	writingSubfolder: 'Ink/Writing',
	drawingSubfolder: 'Ink/Drawing',
	debugLoggingEnabled: false,
	dominantHand: 'right',
	// Writing specific
	writingEnabled: true,
	writingStrokeLimit: 200,
	writingBufferLines: 3,
	writingLineHeight: 150,
	writingDynamicStrokeThickness: true,
	writingSmoothing: false,
	writingLinesWhenLocked: true,
	writingBackgroundWhenLocked: true,
	writingAutoTranscribeOnClose: true,
	writingAutoTranscribeChangeThresholdPercent: 20,
	// Drawing specific
	drawingEnabled: true,
	drawingGridEnabledByDefault: true,
	drawingAutoTranscribeOnClose: false,
	drawingAutoTranscribeChangeThresholdPercent: 20,
	drawingFrameWhenLocked: false,
	drawingBackgroundWhenLocked: false,
	// Transcription endpoint
	customTranscriptionProvider: { ...DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER },
	insertTranscriptBelowEmbed: false,
	aiCaptionOnTranscribe: false,
	// 2.2 s: long enough that a mid-sentence breath does not trigger a reply,
	// short enough that "I stopped writing" and "it answered" feel connected.
	magicInkIdleMs: 2200,
	magicInkMinStrokes: 2,
	// PDF annotation
	pdfAnnotationNoteMode: 'auto-create',
	pdfAnnotationNoteTemplate: '{pdf} - 批注',
	pdfAnnotationFixedNotePath: '',
	pdfAnnotationOpenMode: 'foreground',
	// 笔墨 directly on notes. Enabled by default because it is inert until a
	// drawing tool is chosen; leaving it off would make the feature look
	// broken to anyone who never finds the toggle.
	mdInkEnabled: true,
	mdInkBrush: 'pen',
	mdInkSize: 4,
	mdInkColour: 'currentColor',
	// A desktop user's first attempt is a mouse. Pen-only as the default made
	// the whole feature look dead on arrival.
	mdInkMouseDrawing: true,
	// Deliberately the opposite of the mouse default: on a tablet the finger is
	// the scroll gesture and the stylus is the pen.
	mdInkFingerDraws: false,
	mdInkPaper: 'none',
	mdInkEraserMode: 'stroke',
	mdInkEraserRadius: 14,
	mdInkShapeSnap: true,
	magicDiaryPreset: 'chat',
	magicDiaryCustomPrompt: '',
}
