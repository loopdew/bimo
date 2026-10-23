import { migrateOutdatedSettings } from 'src/types/plugin-settings-migrations';
import { DEFAULT_SETTINGS } from 'src/types/plugin-settings';

//////////
//////////

/**
 * A vault that predates the note-ink settings still ships a `data.json` with
 * `settingsVersion: '0.5.0'`. Fields added afterwards are never touched by the
 * version migration, so each new one needs an explicit default — otherwise the
 * feature is quietly off for everyone who already used the plugin.
 */
describe('note ink settings migration', () => {
	it('fills every note-ink default into an old settings object', () => {
		const old = { settingsVersion: '0.5.0', writingEnabled: true } as Record<string, unknown>;
		const settings = migrateOutdatedSettings(old);

		expect(settings.mdInkEnabled).toBe(DEFAULT_SETTINGS.mdInkEnabled);
		expect(settings.mdInkBrush).toBe(DEFAULT_SETTINGS.mdInkBrush);
		expect(settings.mdInkSize).toBe(DEFAULT_SETTINGS.mdInkSize);
		expect(settings.mdInkColour).toBe(DEFAULT_SETTINGS.mdInkColour);
		expect(settings.mdInkMouseDrawing).toBe(DEFAULT_SETTINGS.mdInkMouseDrawing);
		expect(settings.mdInkPaper).toBe(DEFAULT_SETTINGS.mdInkPaper);
		expect(settings.mdInkEraserRadius).toBe(DEFAULT_SETTINGS.mdInkEraserRadius);
	});

	it('keeps a value the user already set', () => {
		const old = {
			settingsVersion: '0.5.0',
			mdInkEnabled: false,
			mdInkBrush: 'highlighter',
			mdInkSize: 9,
		} as Record<string, unknown>;
		const settings = migrateOutdatedSettings(old);

		expect(settings.mdInkEnabled).toBe(false);
		expect(settings.mdInkBrush).toBe('highlighter');
		expect(settings.mdInkSize).toBe(9);
	});

	it('repairs a corrupt numeric size instead of trusting it', () => {
		const old = { settingsVersion: '0.5.0', mdInkSize: Number.NaN } as Record<string, unknown>;
		expect(migrateOutdatedSettings(old).mdInkSize).toBe(DEFAULT_SETTINGS.mdInkSize);
	});

	/**
	 * The first release shipped `mdInkMouseDrawing: false`. Every data.json
	 * written before this fix therefore contains a `false` the user never chose,
	 * and honouring it means a mouse draws nothing at all.
	 */
	it('flips the shipped-false mouse default exactly once', () => {
		const old = {
			settingsVersion: '0.5.0',
			mdInkMouseDrawing: false,
		} as Record<string, unknown>;

		const fixed = migrateOutdatedSettings(old);
		expect(fixed.mdInkMouseDrawing).toBe(true);
		expect(fixed.mdInkMouseDrawingMigrated).toBe(true);

		// The user turns it off again afterwards: that choice must survive.
		const chosen = migrateOutdatedSettings({ ...fixed, mdInkMouseDrawing: false });
		expect(chosen.mdInkMouseDrawing).toBe(false);
	});
});
