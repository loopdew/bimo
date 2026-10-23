////////
////////

import { normalizeCustomTranscriptionProvider } from 'src/logic/transcription-providers/types';
import { PluginSettings_0_4_0 } from './plugin-settings_0_4_0';
import { PluginSettings_0_5_0, DEFAULT_PLUGIN_SETTINGS_0_5_0 } from './plugin-settings_0_5_0';
import { PluginSettings } from './types-map';

///////////
///////////

export function migrateOutdatedSettings(raw: Record<string, unknown>): PluginSettings {
	let updatedSettings: unknown = raw;

	if (!raw.settingsVersion) {
		updatedSettings = migrate_0_4_0_to_0_5_0(raw as unknown as PluginSettings_0_4_0);
	}

	const settings = updatedSettings as PluginSettings;

	// Additive field on 0.5.0 — default for vaults saved before dominantHand existed
	if (settings.dominantHand === undefined) {
		settings.dominantHand = DEFAULT_PLUGIN_SETTINGS_0_5_0.dominantHand;
	}

	// Additive field on 0.5.0 — default for vaults saved before drawingGridEnabledByDefault existed
	if (settings.drawingGridEnabledByDefault === undefined) {
		settings.drawingGridEnabledByDefault = DEFAULT_PLUGIN_SETTINGS_0_5_0.drawingGridEnabledByDefault;
	}

	if (settings.writingAutoTranscribeOnClose === undefined) {
		settings.writingAutoTranscribeOnClose = DEFAULT_PLUGIN_SETTINGS_0_5_0.writingAutoTranscribeOnClose;
	}
	if (settings.drawingAutoTranscribeOnClose === undefined) {
		settings.drawingAutoTranscribeOnClose = DEFAULT_PLUGIN_SETTINGS_0_5_0.drawingAutoTranscribeOnClose;
	}
	if (settings.writingAutoTranscribeChangeThresholdPercent === undefined) {
		settings.writingAutoTranscribeChangeThresholdPercent =
			DEFAULT_PLUGIN_SETTINGS_0_5_0.writingAutoTranscribeChangeThresholdPercent;
	}
	if (settings.drawingAutoTranscribeChangeThresholdPercent === undefined) {
		settings.drawingAutoTranscribeChangeThresholdPercent =
			DEFAULT_PLUGIN_SETTINGS_0_5_0.drawingAutoTranscribeChangeThresholdPercent;
	}

	// Undo mistaken 0.6.0 settingsVersion bump from an earlier build
	if (settings.settingsVersion === '0.6.0') {
		settings.settingsVersion = DEFAULT_PLUGIN_SETTINGS_0_5_0.settingsVersion;
	}

	// Additive field — custom OpenAI-compatible transcription endpoint.
	// Normalises partial data too, so a hand-edited data.json cannot break loading.
	settings.customTranscriptionProvider = normalizeCustomTranscriptionProvider(
		settings.customTranscriptionProvider,
	);

	// Additive field — mirror the transcript as a block below the embed.
	if (typeof settings.insertTranscriptBelowEmbed !== 'boolean') {
		settings.insertTranscriptBelowEmbed = DEFAULT_PLUGIN_SETTINGS_0_5_0.insertTranscriptBelowEmbed;
	}

	// Additive field — AI caption in the embed alt.
	if (typeof settings.aiCaptionOnTranscribe !== 'boolean') {
		settings.aiCaptionOnTranscribe = DEFAULT_PLUGIN_SETTINGS_0_5_0.aiCaptionOnTranscribe;
	}

	// Additive fields — magic pen timing. Clamped rather than merely defaulted:
	// a zero or negative idle delay would fire on every stroke.
	if (
		typeof settings.magicInkIdleMs !== 'number'
		|| !Number.isFinite(settings.magicInkIdleMs)
		|| settings.magicInkIdleMs < 600
	) {
		settings.magicInkIdleMs = DEFAULT_PLUGIN_SETTINGS_0_5_0.magicInkIdleMs;
	}
	if (
		typeof settings.magicInkMinStrokes !== 'number'
		|| !Number.isFinite(settings.magicInkMinStrokes)
		|| settings.magicInkMinStrokes < 1
	) {
		settings.magicInkMinStrokes = DEFAULT_PLUGIN_SETTINGS_0_5_0.magicInkMinStrokes;
	}

	// Additive field — interface language. Anything unrecognised falls back to auto.
	if (settings.uiLanguage !== 'en' && settings.uiLanguage !== 'zh-cn') {
		settings.uiLanguage = DEFAULT_PLUGIN_SETTINGS_0_5_0.uiLanguage;
	}

	const settingsWereMigrated = JSON.stringify(updatedSettings) !== JSON.stringify(raw);
	if (settingsWereMigrated) {
		console.debug('笔墨: Migrated outdated plugin settings');
		console.debug('Old settings:', JSON.parse(JSON.stringify(raw)));
		console.debug('New settings:', JSON.parse(JSON.stringify(updatedSettings)));
	}

	// Additive fields — ink painted directly on notes.
	//
	// Without these the feature is silently off for every vault that already has
	// a data.json: `mdInkEnabled` would stay `undefined`, which reads as false.
	if (typeof settings.mdInkEnabled !== 'boolean') {
		settings.mdInkEnabled = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkEnabled;
	}
	if (!settings.mdInkBrush) {
		settings.mdInkBrush = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkBrush;
	}
	if (typeof settings.mdInkSize !== 'number' || !Number.isFinite(settings.mdInkSize)) {
		settings.mdInkSize = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkSize;
	}
	if (!settings.mdInkColour) {
		settings.mdInkColour = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkColour;
	}
	if (typeof settings.mdInkMouseDrawing !== 'boolean') {
		settings.mdInkMouseDrawing = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkMouseDrawing;
	}
	// One-time correction. The first release shipped `false` as the default, so
	// every existing data.json carries a `false` nobody chose. Flip it once and
	// record that the value belongs to the user from then on.
	if (settings.mdInkMouseDrawingMigrated !== true) {
		settings.mdInkMouseDrawing = true;
		settings.mdInkMouseDrawingMigrated = true;
	}
	if (!settings.mdInkPaper) {
		settings.mdInkPaper = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkPaper;
	}
	if (typeof settings.mdInkEraserRadius !== 'number' || !Number.isFinite(settings.mdInkEraserRadius)) {
		settings.mdInkEraserRadius = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkEraserRadius;
	}
	if (typeof settings.mdInkShapeSnap !== 'boolean') {
		settings.mdInkShapeSnap = DEFAULT_PLUGIN_SETTINGS_0_5_0.mdInkShapeSnap;
	}

	return settings;
}

///////////

export function migrate_0_4_0_to_0_5_0(oldSettings: PluginSettings_0_4_0): PluginSettings_0_5_0 {

	const newSettings: PluginSettings_0_5_0 = {

		// Apply defaults as a safety net for any gap
		...DEFAULT_PLUGIN_SETTINGS_0_5_0,

		// Transfer all existing user settings
		...oldSettings,

		// Migrate & overwrite exceptions
		/////////////////////////////////////

		// New fields — use defaults since they didn't exist in 0.4.0
		gettingStartedExpanded: DEFAULT_PLUGIN_SETTINGS_0_5_0.gettingStartedExpanded,
		writingBufferLines: DEFAULT_PLUGIN_SETTINGS_0_5_0.writingBufferLines,
		debugLoggingEnabled: DEFAULT_PLUGIN_SETTINGS_0_5_0.debugLoggingEnabled,
		dominantHand: DEFAULT_PLUGIN_SETTINGS_0_5_0.dominantHand,

		// Always overwrite settingsVersion last
		settingsVersion: DEFAULT_PLUGIN_SETTINGS_0_5_0.settingsVersion,
	};

	return JSON.parse(JSON.stringify(newSettings)) as PluginSettings_0_5_0;
}
