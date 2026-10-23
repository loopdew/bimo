import { resolveLocale, setLocale, t } from 'src/i18n';
import './settings-tab.scss';
import { App, ButtonComponent, PluginSettingTab, Setting, SliderComponent, TextComponent, ToggleComponent } from "obsidian";
import InkPlugin from "src/main";
import MyPlugin from "src/main";
import { ConfirmationModal } from "src/components/dom-components/modals/confirmation-modal/confirmation-modal";
import { DEFAULT_SETTINGS } from 'src/types/plugin-settings';
import { showWelcomeTips } from 'src/components/dom-components/welcome-notice';
import { showRecentChanges } from 'src/components/dom-components/version-notices';
import { ToggleAccordionSetting } from 'src/components/dom-components/toggle-accordion-setting';
import { TwoWayToggleSetting } from 'src/components/dom-components/two-way-toggle-setting/two-way-toggle-setting';
import { ThreeWayToggleSetting } from 'src/components/dom-components/three-way-toggle-setting/three-way-toggle-setting';
import { setDominantHand } from 'src/stores/dominant-hand-store';
import { vaultNeedsInkFormatMigration } from 'src/logic/utils/tldraw-svg-migration-logic';
import type { StrokeInputEditorKind, StrokeInputTreatAs } from 'src/logic/device-settings/device-settings-types';
import {
	getBooxConnectionEnabled,
	getFingerDrawingEnabled,
	getLastDetectedStrokeInput,
	getStrokeInputTreatAs,
	getStylusSideButtonTemporaryEraseEnabled,
	getHighContrastUserInterface,
	setBooxConnectionEnabled,
	setFingerDrawingEnabled,
	setStrokeInputTreatAs,
	setStylusSideButtonTemporaryEraseEnabled,
	setHighContrastUserInterface,
	subscribeDeviceSettingsChanged,
} from 'src/logic/device-settings/device-settings';
import { applyHighContrastUserInterfaceBodyClass } from 'src/logic/device-settings/high-contrast-user-interface-body-class';
import type { DominantHand } from 'src/types/plugin-settings_0_5_0';
import { insertCustomApiSection } from 'src/components/dom-components/tabs/settings-tab/custom-api-section';
import { isCustomTranscriptionProviderUsable } from 'src/logic/transcription-providers';
import { canReloadPlugin, reloadPlugin } from 'src/logic/utils/reload-plugin';
import { INK_BRUSH_PRESETS, INK_BRUSH_SWATCHES } from 'src/ink-canvas/brush-presets';
import { dropWaitingAutoTranscriptionJobsForFileType } from 'src/logic/handwriting-transcription-queue';
import {
	AUTO_TRANSCRIBE_CHANGE_THRESHOLD_MAX_PERCENT,
	clampAutoTranscribeChangeThresholdPercent,
} from 'src/logic/stroke-bbox-cells';
import type { HandwritingTranscriptionFileType } from 'src/logic/handwriting-transcription-queue-store';

/////////
/////////

export function registerSettingsTab(plugin: InkPlugin) {
	plugin.addSettingTab(new MySettingsTab(plugin.app, plugin));
}

/**
 * Reopens the 笔墨 settings tab after protocol return.
 * Obsidian closes Settings when the app is backgrounded for the browser login.
 */
export function openInkSettingsTab(plugin: InkPlugin): void {
	const setting = (
		plugin.app as App & {
			setting?: {
				open: () => void;
				openTabById: (id: string) => void;
			};
		}
	).setting;
	if (!setting?.open || !setting.openTabById) return;
	setting.open();
	setting.openTabById(plugin.manifest.id);
}

type SettingsPaneId = 'connect' | 'canvas' | 'noteink' | 'files' | 'about';

const SETTINGS_PANE_ITEMS: ReadonlyArray<{ id: SettingsPaneId; label: string }> = [
	{ id: 'connect', label: 'Connection & model' },
	{ id: 'canvas', label: 'Writing & drawing' },
	{ id: 'noteink', label: 'Writing on notes' },
	{ id: 'files', label: 'Files & export' },
	{ id: 'about', label: 'About & maintenance' },
];

export class MySettingsTab extends PluginSettingTab {
	plugin: MyPlugin;
	/** Survives the re-render that every settings change triggers. */
	private activePane: SettingsPaneId = 'connect';
	private unsubscribeDeviceSettings?: () => void;
	private legacyMigrateScanGeneration = 0;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.renderSettingsTab();
	}

	/** Imperative settings UI; called from display() and after reset without re-invoking deprecated display(). */
	private renderSettingsTab(): void {
		const {containerEl} = this;

		this.unsubscribeDeviceSettings?.();
		this.unsubscribeDeviceSettings = undefined;

		containerEl.empty();
		containerEl.addClass('bimo_settings');

		// ── 顶部品牌头 + 分区导航 ─────────────────────────────
		//
		// The plugin outgrew one long scroll: transcription, brushes, PDF
		// annotation, AI and file layout used to be a single column where the
		// settings you actually change live between two blocks you never touch.
		// Panes are pure show/hide — every section keeps its own DOM and state,
		// so nothing re-renders when you switch.
		this.renderBrandHeader(containerEl);

		const navEl = containerEl.createDiv('bimo_settings-nav');
		const panesEl = containerEl.createDiv('bimo_settings-panes');
		const pane = (intro: string): HTMLElement => {
			const el = panesEl.createDiv('bimo_settings-pane');
			el.createEl('p', { cls: 'bimo_settings-pane__intro', text: t(intro) });
			return el;
		};
		const panes: Record<SettingsPaneId, HTMLElement> = {
			connect: pane('Where the model lives. Without it, handwriting still works — it just cannot be read or answered.'),
			canvas: pane('Defaults for the page itself: how ink is captured, how a block opens, and the magic margin.'),
			noteink: pane('Draw straight onto a note, over the text, without changing a byte of the Markdown file.'),
			files: pane('Where attachments are stored, and how files written by older versions are brought forward.'),
			about: pane('Usage tips, resets, and development information.'),
		};

		const navButtons: Record<string, HTMLButtonElement> = {};
		const activate = (id: SettingsPaneId): void => {
			this.activePane = id;
			for (const [paneId, el] of Object.entries(panes)) {
				el.toggleClass('bimo_settings-pane--active', paneId === id);
			}
			for (const [paneId, button] of Object.entries(navButtons)) {
				button.toggleClass('bimo_settings-nav__item--active', paneId === id);
			}
			// Switching panes while scrolled to the middle leaves the new pane
			// blank above the fold; the tab content owns the scroll, not this root.
			containerEl.closest('.vertical-tab-content')?.scrollTo({ top: 0 });
		};

		for (const item of SETTINGS_PANE_ITEMS) {
			const button = navEl.createEl('button', {
				cls: 'bimo_settings-nav__item',
				text: t(item.label),
			});
			button.addEventListener('click', () => activate(item.id));
			navButtons[item.id] = button;
		}

		// ── 连接与模型 ────────────────────────────────────────
		new Setting(panes.connect)
			.setName(t('Interface language'))
			.setDesc(t('Auto follows Obsidian. The change applies immediately.'))
			.addDropdown((dropdown) => dropdown
				.addOption('auto', t('Auto (follow Obsidian)'))
				.addOption('zh-cn', '简体中文')
				.addOption('en', 'English')
				.setValue(this.plugin.settings.uiLanguage)
				.onChange(async (value) => {
					this.plugin.settings.uiLanguage =
						value === 'zh-cn' ? 'zh-cn' : value === 'en' ? 'en' : 'auto';
					setLocale(resolveLocale(value));
					await this.plugin.saveSettings();
					this.renderSettingsTab();
				}));

		insertCustomApiSection(panes.connect, this.plugin, () => {
			this.renderSettingsTab();
		});

		// ── 笔记上的书写 ──────────────────────────────────────
		this.renderNoteInkSettings(panes.noteink);

		// ── 关于与维护 ────────────────────────────────────────
		insertGettingStartedSection(panes.about, this.plugin);
		// Refresh on permanent-migrate Done (not modal close) so the card animates shut behind the completion UI.
		const migrateWrapper = insertMigrateSection(panes.files, this.plugin, () => {
			void this.refreshLegacyMigrateSectionVisibility(migrateWrapper);
		});
		void this.refreshLegacyMigrateSectionVisibility(migrateWrapper);

		// Declare refs before insertHighLevelSettings so its callbacks can close over them.
		// The callbacks only fire on user interaction, after display() has completed
		// and both refs are assigned below.
		let writingSectionEl!: HTMLElement;
		let drawingSectionEl!: HTMLElement;
		let booxCompanionToggle: ToggleComponent | undefined;
		let highContrastUserInterfaceToggle: ToggleComponent | undefined;
		let fingerDrawingToggle: ToggleComponent | undefined;
		let stylusSideButtonTemporaryEraseToggle: ToggleComponent | undefined;

		insertHighLevelSettings(panes.canvas, this.plugin,
			(show) => {
				if (show) writingSectionEl.classList.add('ddc_ink_expanded');
				else writingSectionEl.classList.remove('ddc_ink_expanded');
			},
			(show) => {
				if (show) drawingSectionEl.classList.add('ddc_ink_expanded');
				else drawingSectionEl.classList.remove('ddc_ink_expanded');
			},
			(toggle) => {
				fingerDrawingToggle = toggle;
			},
			(toggle) => {
				highContrastUserInterfaceToggle = toggle;
			},
		);

		insertTldrawSvgMigrateSection(panes.files, this.plugin);

		const strokeInputToggles: ThreeWayToggleSetting<StrokeInputTreatAs>[] = [];
		writingSectionEl = insertWritingSettings(panes.canvas, this.plugin, strokeInputToggles);
		if (this.plugin.settings.writingEnabled) writingSectionEl.classList.add('ddc_ink_expanded');
		drawingSectionEl = insertDrawingSettings(panes.canvas, this.plugin, strokeInputToggles);
		if (this.plugin.settings.drawingEnabled) drawingSectionEl.classList.add('ddc_ink_expanded');
		insertMagicInkSettings(panes.canvas, this.plugin);
		this.unsubscribeDeviceSettings = subscribeDeviceSettingsChanged(() => {
			if (strokeInputToggles[0]) {
				strokeInputToggles[0].setDesc(strokeInputTreatAsSettingDesc('inkWriting'));
			}
			if (strokeInputToggles[1]) {
				strokeInputToggles[1].setDesc(strokeInputTreatAsSettingDesc('inkDrawing'));
			}
			booxCompanionToggle?.setValue(getBooxConnectionEnabled());
			highContrastUserInterfaceToggle?.setValue(getHighContrastUserInterface());
			fingerDrawingToggle?.setValue(getFingerDrawingEnabled());
			stylusSideButtonTemporaryEraseToggle?.setValue(getStylusSideButtonTemporaryEraseEnabled());
		});
		insertFileOrganisationSection(panes.files, this.plugin);
		insertPdfAnnotationSection(panes.files, this.plugin);

		new Setting(panes.about)
			.setClass('ddc_ink_bare-setting')
			.addButton( (button) => {
				button.setButtonText(t('Reset settings…'));
				button.onClick(() => {
					new ConfirmationModal({
						plugin: this.plugin,
						title: t('Please confirm'),
						message: t('Revert to default settings for this plugin?'),
						confirmLabel: t('Reset settings'),
						confirmAction: () => {
							void this.plugin.resetSettings().then(() => {
								this.renderSettingsTab();
							});
						}
					}).open();
				})
			})

		insertExperimentalChangesSection(panes.canvas, this.plugin, (toggle) => {
			booxCompanionToggle = toggle;
		}, (toggle) => {
			stylusSideButtonTemporaryEraseToggle = toggle;
		});
		insertPrereleaseWarning(panes.about, this.plugin);


		activate(this.activePane);

	}

	/**
	 * Settings for ink painted over a note.
	 *
	 * Everything here applies live: the overlays read these fields on every new
	 * stroke, so a change lands without reloading the note.
	 */
	private renderNoteInkSettings(container: HTMLElement): void {
		const plugin = this.plugin;

		new Setting(container)
			.setName(t('Draw on notes'))
			.setDesc(t('Puts a transparent ink layer over every Markdown editor. It ignores the pointer until you pick a drawing tool, so normal editing is unaffected.'))
			.addToggle((toggle) => toggle
				.setValue(plugin.settings.mdInkEnabled)
				.onChange(async (value) => {
					plugin.settings.mdInkEnabled = value;
					plugin.mdInk.setEnabled(value);
					await plugin.saveSettings();
				}));

		new Setting(container)
			.setName(t('Brush'))
			.setDesc(t('Applies to new strokes on notes. Existing strokes keep the brush they were drawn with.'))
			.addDropdown((dropdown) => {
				for (const preset of INK_BRUSH_PRESETS) {
					dropdown.addOption(preset.kind, t(preset.label));
				}
				dropdown
					.setValue(plugin.settings.mdInkBrush)
					.onChange(async (value) => {
						plugin.settings.mdInkBrush = value as typeof plugin.settings.mdInkBrush;
						plugin.mdInk.refreshOptions({ brush: plugin.settings.mdInkBrush });
						await plugin.saveSettings();
					});
			});

		new Setting(container)
			.setName(t('Stroke size'))
			.setDesc(t('The brush multiplies this, so a highlighter stays wide even at the same number.'))
			.addSlider((slider: SliderComponent) => slider
				.setLimits(1, 12, 1)
				.setValue(plugin.settings.mdInkSize)
				.setDynamicTooltip()
				.onChange(async (value) => {
					plugin.settings.mdInkSize = value;
					plugin.mdInk.refreshOptions({ size: value });
					await plugin.saveSettings();
				}));

		const colourSetting = new Setting(container)
			.setName(t('Colour'))
			.setDesc(t('“Theme ink” follows light and dark mode. The highlighter falls back to yellow when this is left on theme ink.'));
		const swatches = colourSetting.controlEl.createDiv('bimo_settings-swatches');
		for (const colour of INK_BRUSH_SWATCHES) {
			const swatch = swatches.createEl('button', {
				cls: 'bimo_settings-swatch',
				attr: {
					'aria-label': colour === 'currentColor' ? t('Theme ink') : colour,
					type: 'button',
				},
			});
			swatch.style.background = colour === 'currentColor' ? 'var(--text-normal)' : colour;
			if (plugin.settings.mdInkColour === colour) swatch.addClass('is-active');
			swatch.addEventListener('click', () => {
				plugin.settings.mdInkColour = colour;
				plugin.mdInk.refreshOptions({ colour });
				void plugin.saveSettings();
				swatches.querySelectorAll('.bimo_settings-swatch').forEach((el) => el.removeClass('is-active'));
				swatch.addClass('is-active');
			});
		}

		new Setting(container)
			.setName(t('Draw with a mouse'))
			.setDesc(t('Off by default: a pen draws, a mouse keeps selecting text. Turn this on if you have no stylus.'))
			.addToggle((toggle) => toggle
				.setValue(plugin.settings.mdInkMouseDrawing)
				.onChange(async (value) => {
					plugin.settings.mdInkMouseDrawing = value;
					plugin.mdInk.refreshOptions({ mouseDrawing: value });
					await plugin.saveSettings();
				}));

		new Setting(container)
			.setName(t('Draw with a finger'))
			.setDesc(t('Off by default on tablets: a finger scrolls the note and the stylus draws. Turn this on if you have no stylus at all.'))
			.addToggle((toggle) => toggle
				.setValue(plugin.settings.mdInkFingerDraws)
				.onChange(async (value) => {
					plugin.settings.mdInkFingerDraws = value;
					plugin.mdInk.refreshOptions({ fingerDraws: value });
					await plugin.saveSettings();
				}));

		new Setting(container)
			.setName(t('Paper'))
			.setDesc(t('A guide drawn under the ink for this note. It is decoration only — it never enters the Markdown file.'))
			.addDropdown((dropdown) => dropdown
				.addOption('none', t('None'))
				.addOption('ruled', t('Ruled'))
				.addOption('grid', t('Grid'))
				.addOption('dots', t('Dots'))
				.setValue(plugin.settings.mdInkPaper)
				.onChange(async (value) => {
					plugin.settings.mdInkPaper = value as typeof plugin.settings.mdInkPaper;
					plugin.mdInk.refreshOptions({ paper: plugin.settings.mdInkPaper });
					await plugin.saveSettings();
				}));

		new Setting(container)
			.setName(t('Eraser radius'))
			.setDesc(t('How close the eraser has to come to a stroke, in pixels. Larger is forgiving on a tablet, clumsy with a mouse.'))
			.addSlider((slider: SliderComponent) => slider
				.setLimits(6, 40, 2)
				.setValue(plugin.settings.mdInkEraserRadius)
				.setDynamicTooltip()
				.onChange(async (value) => {
					plugin.settings.mdInkEraserRadius = value;
					plugin.mdInk.refreshOptions({ eraserRadius: value });
					await plugin.saveSettings();
				}));

		new Setting(container)
			.setName(t('Straighten shapes'))
			.setDesc(t('A stroke that was nearly a line becomes a line; one that was nearly a closed box becomes a rectangle. Hand-drawn underlines and frames stop looking wobbly.'))
			.addToggle((toggle) => toggle
				.setValue(plugin.settings.mdInkShapeSnap)
				.onChange(async (value) => {
					plugin.settings.mdInkShapeSnap = value;
					plugin.mdInk.refreshOptions({ shapeSnap: value });
					await plugin.saveSettings();
				}));

		container.createEl('p', {
			cls: 'bimo_settings-pane__note',
			text: t('Shortcuts: Mod+Shift+D switches the pen on and off for a note. While the pen is on, Mod+Alt+Z undoes a stroke. Long-press the space bar to pan.'),
		});
	}

	/** Brand row: what this is, which version, and whether it can talk to a model. */
	private renderBrandHeader(containerEl: HTMLElement): void {
		const header = containerEl.createDiv('bimo_settings-header');
		const identity = header.createDiv('bimo_settings-header__identity');
		identity.createEl('h2', { cls: 'bimo_settings-header__name', text: '笔墨' });
		identity.createEl('span', {
			cls: 'bimo_settings-header__tagline',
			text: t('Hand write or draw directly between paragraphs in your notes.'),
		});

		const badges = header.createDiv('bimo_settings-header__badges');
		badges.createSpan({
			cls: 'bimo_settings-badge',
			text: `v${this.plugin.manifest.version}`,
		});
		const provider = this.plugin.settings.customTranscriptionProvider;
		const connected = Boolean(provider?.enabled && provider.apiKey && provider.model);
		badges.createSpan({
			cls: `bimo_settings-badge ${connected ? 'bimo_settings-badge--ok' : 'bimo_settings-badge--idle'}`,
			text: connected ? t('Model connected') : t('No model configured'),
		});

		// Development convenience: cycling the plugin in place is the difference
		// between "rebuild and keep working" and "restart Obsidian after every
		// change". Sits in the header so it is one click from anywhere in settings.
		if (canReloadPlugin(this.plugin)) {
			const reloadButton = badges.createEl('button', {
				cls: 'bimo_settings-badge bimo_settings-badge--action',
				text: t('Reload plugin'),
			});
			reloadButton.addEventListener('click', (event) => {
				event.preventDefault();
				void reloadPlugin(this.plugin);
			});
		}
	}

	hide(): void {
		this.legacyMigrateScanGeneration++;
		this.unsubscribeDeviceSettings?.();
		this.unsubscribeDeviceSettings = undefined;
	}

	private async refreshLegacyMigrateSectionVisibility(wrapperEl: HTMLElement) {
		const generation = ++this.legacyMigrateScanGeneration;
		await Promise.resolve();

		if (generation !== this.legacyMigrateScanGeneration) return;

		const needsMigration = await vaultNeedsInkFormatMigration(
			this.plugin.app.vault,
			(linkpath, sourceNotePath) =>
				this.plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourceNotePath)?.path ?? null,
		);
		if (generation !== this.legacyMigrateScanGeneration) return;

		// Always set expanded from the latest scan — never leave a stale visible card.
		wrapperEl.classList.toggle('ddc_ink_expanded', needsMigration);
	}
}

function insertGettingStartedSection(containerEl: HTMLElement, plugin: InkPlugin) {
	const isExpanded = plugin.settings.gettingStartedExpanded ?? true;
	const wrapperEl = containerEl.createDiv('ddc_ink_section-wrapper');
	if (isExpanded) wrapperEl.classList.add('ddc_ink_expanded');

	const sectionEl = wrapperEl.createDiv('ddc_ink_controls-section');

	const headerSetting = new Setting(sectionEl)
		.setClass('ddc_ink_controls-header')
		.setClass('ddc_ink_controls-header--clickable')
		.setName(t('Getting started'))
		// Keep "笔墨" as the product name.
		.setDesc(t('Tips for using 笔墨, compatibility with other processes, and migrating from older versions.'));

	const arrowEl = headerSetting.settingEl.createSpan('ddc_ink_collapse-arrow');
	arrowEl.setText('›');
	if (isExpanded) arrowEl.classList.add('ddc_ink_expanded');

	headerSetting.settingEl.addEventListener('click', () => {
		const expanded = wrapperEl.classList.toggle('ddc_ink_expanded');
		arrowEl.classList.toggle('ddc_ink_expanded', expanded);
		plugin.settings.gettingStartedExpanded = expanded;
		void plugin.saveSettings();
	});

	const contentEl = sectionEl.createDiv('ddc_ink_controls-content');

	// Information (tips) first
	const tipsSectionEl = contentEl.createDiv('ddc_ink_tips-section');
	const tipsGridEl = tipsSectionEl.createDiv('ddc_ink_tips-grid');
	// Keep product names and intentional tip-label casing below.
	tipsGridEl.createDiv('ddc_ink_tips-label').setText(t('Drawing embed framing'));
	tipsGridEl.createDiv('ddc_ink_tips-desc').setText(t(`Two fingers or right mouse button to reframe. Cmd + right mouse button to zoom, or Cmd + scroll wheel.`));
	tipsGridEl.createDiv('ddc_ink_tips-label').setText(t('Locked embeds'));
	tipsGridEl.createDiv('ddc_ink_tips-desc').setText(t(`Right click or tap and hold on a locked embed to copy or delete it.`));
	// Same tip as the version notice — keep discoverable after onboarding tips are dismissed.
	tipsGridEl.createDiv('ddc_ink_tips-label').setText(t('Temporary eraser'));
	tipsGridEl.createDiv('ddc_ink_tips-desc').setText(t(`Hold cmd/ctrl to switch to eraser temporarily.`));
	tipsGridEl.createDiv('ddc_ink_tips-label').setText(t('Obsidian Sync'));
	tipsGridEl.createDiv('ddc_ink_tips-desc').setText(t(`If using "Obsidian Sync", turn on "sync all other types" in the Obsidian Sync settings.`));

	// Rewatch button
	new Setting(contentEl)
		.setClass('ddc_ink_bare-setting')
		.setClass('ddc_ink_bare-setting--no-bottom-margin')
		.addButton((btn) => {
			btn.setButtonText(t('View recent changes'));
			btn.onClick(() => showRecentChanges(plugin));
		})
		.addButton((btn) => {
			btn.setButtonText(t('Rewatch welcome tips'));
			btn.setCta();
			btn.onClick(() => showWelcomeTips(plugin));
		});
}

function insertMigrateSection(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	onPermanentMigrationFinished?: () => void,
): HTMLElement {
	const wrapperEl = containerEl.createDiv('ddc_ink_legacy-migrate-card-wrapper');
	const innerEl = wrapperEl.createDiv('ddc_ink_legacy-migrate-card-inner');
	const cardEl = innerEl.createDiv('ddc_ink_legacy-migrate-card');

	cardEl.createDiv({
		cls: 'ddc_ink_legacy-migrate-card-title',
		text: t('Migrate Legacy 笔墨 Files'),
	});

	cardEl.createDiv({
		cls: 'ddc_ink_legacy-migrate-card-desc',
		text: t('This version of 笔墨 uses a new SVG format. Migrate legacy .writing/.drawing files and older 笔墨 SVG files still on the previous format to unlock newer features.'),
	});

	new Setting(cardEl)
		.setClass('ddc_ink_bare-setting')
		.setClass('ddc_ink_bare-setting--left')
		.setClass('ddc_ink_legacy-migrate-card-action')
		.addButton((button) => {
			button.setCta();
			button.setButtonText(t('Show migration options…'));
			button.onClick(() => plugin.openMigrationModal(onPermanentMigrationFinished));
		});

	return wrapperEl;
}

function insertTldrawSvgMigrateSection(containerEl: HTMLElement, plugin: InkPlugin) {
	new Setting(containerEl)
		.setClass('ddc_ink_setting')
		.setName(t('Developer: Migrate tldraw SVG to ink-canvas'))
		.setDesc(
			t('Bulk-convert v2 SVG files still on <tldraw> metadata (referenced by embeds) to ink-canvas in place. Drawing embed viewBox is refit to stroke bounds.'),
		)
		.addButton((button) => {
			// Keep "SVG" acronym casing.
			button.setButtonText(t('Migrate tldraw SVGs…'));
			button.onClick(() => plugin.openTldrawSvgMigrationModal());
		});
}


function insertHighLevelSettings(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	onToggleWriting: (show: boolean) => void,
	onToggleDrawing: (show: boolean) => void,
	onFingerDrawingToggleReady?: (toggle: ToggleComponent) => void,
	onHighContrastUserInterfaceReady?: (toggle: ToggleComponent) => void,
) {

	new Setting(containerEl)
		.setClass('ddc_ink_setting')
		.setName(t('Enable writing'))
		// .setDesc('If disabled, you will still be able to view previously created writing embeds.')
		.setDesc(t('If disabled, you will not be able to add new writing embeds and those already embedded will appear as raw code. Existing writing files will be hidden in Obsidian but still exist on disk. Changing this setting will require a restart of Obsidian to take effect.'))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.writingEnabled);
			toggle.onChange(async (value) => {
				plugin.settings.writingEnabled = value;
				await plugin.saveSettings();
				onToggleWriting(value);
			});
		});

	new Setting(containerEl)
		.setClass('ddc_ink_setting')
		.setName(t('Enable drawing'))
		// .setDesc('If disabled, you will still be able to view previously created drawing embeds.')
		.setDesc(t('If disabled, you will not be able to add new drawing embeds and those already embedded will appear as raw code. Existing drawing files will be hidden in Obsidian but still exist on disk. Changing this setting will require a restart of Obsidian to take effect.'))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.drawingEnabled);
			toggle.onChange(async (value) => {
				plugin.settings.drawingEnabled = value;
				await plugin.saveSettings();
				onToggleDrawing(value);
			});
		});

	new Setting(containerEl)
		.setClass('ddc_ink_setting')
		.setName(t('Enable finger drawing'))
		.setDesc(t('Shows a toolbar toggle while editing so you can draw with your finger on touch devices. When off, fingers scroll the note as usual.'))
		.addToggle((toggle) => {
			toggle.setValue(getFingerDrawingEnabled());
			onFingerDrawingToggleReady?.(toggle);
			toggle.onChange((value: boolean) => {
				setFingerDrawingEnabled(value);
			});
		});

	new TwoWayToggleSetting<DominantHand>(containerEl)
		.setName(t('Dominant hand'))
		.setDesc(t('Which side undo/redo and extend controls appear on while editing.'))
		.setOptionPair('left', t('Left'), 'right', t('Right'))
		.setValue(plugin.settings.dominantHand)
		.onChange(async (value) => {
			plugin.settings.dominantHand = value;
			setDominantHand(value);
			await plugin.saveSettings();
		});

	new Setting(containerEl)
		.setClass('ddc_ink_setting')
		.setName(t('High contrast user interface'))
		.setDesc(t('Uses high-contrast borders and controls across 笔墨 embeds and editors — suited to e-ink and grayscale displays.'))
		.addToggle((toggle) => {
			toggle.setValue(getHighContrastUserInterface());
			onHighContrastUserInterfaceReady?.(toggle);
			toggle.onChange((value: boolean) => {
				setHighContrastUserInterface(value);
				applyHighContrastUserInterfaceBodyClass();
			});
		});

}

function insertExperimentalChangesSection(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	onBooxToggleReady?: (toggle: ToggleComponent) => void,
	onStylusSideButtonTemporaryEraseReady?: (toggle: ToggleComponent) => void,
) {
	// Expand/collapse header only — same pattern as "This plugin is in beta". Inner toggles
	// persist independently; do not use ToggleAccordionSetting (header toggle looked like a master switch).
	const wrapperEl = containerEl.createDiv('ddc_ink_section-wrapper');
	const controlsEl = wrapperEl.createDiv('ddc_ink_controls-section');

	const headerSetting = new Setting(controlsEl)
		.setClass('ddc_ink_controls-header')
		.setClass('ddc_ink_controls-header--clickable')
		.setName(t('Experimental changes'))
		.setDesc(t('Features under active testing. They may not work on all devices and might be removed or changed in the next release. Expand for details.'));

	const arrowEl = headerSetting.settingEl.createSpan('ddc_ink_collapse-arrow');
	arrowEl.setText('›');

	headerSetting.settingEl.addEventListener('click', () => {
		const expanded = wrapperEl.classList.toggle('ddc_ink_expanded');
		arrowEl.classList.toggle('ddc_ink_expanded', expanded);
	});

	const contentEl = controlsEl.createDiv('ddc_ink_controls-content');

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		// Keep "Boox" as the product name.
		.setName(t('Enable Boox companion app'))
		.setDesc(t('Connects to the Boox companion app for passing through smoother pen strokes on supported tablets.'))
		.addToggle((toggle) => {
			toggle.setValue(getBooxConnectionEnabled());
			onBooxToggleReady?.(toggle);
			toggle.onChange((value: boolean) => {
				// Do not enable highContrastUserInterface here — Boox and high-contrast chrome are independent.
				setBooxConnectionEnabled(value);
				plugin.booxConnection.onSettingsChanged();
			});
		});

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Side button temporary eraser'))
		.setDesc(t('While held, the pen barrel button (button 2) erases instead of panning. May conflict with right-click pan on some setups.'))
		.addToggle((toggle) => {
			toggle.setValue(getStylusSideButtonTemporaryEraseEnabled());
			onStylusSideButtonTemporaryEraseReady?.(toggle);
			toggle.onChange((value: boolean) => {
				setStylusSideButtonTemporaryEraseEnabled(value);
			});
		});
}

function insertFileOrganisationSection(containerEl: HTMLElement, plugin: InkPlugin) {

	const saveWritingFolder = async (enteredValue: string) => {
		const value = enteredValue || DEFAULT_SETTINGS.writingSubfolder;
		plugin.settings.writingSubfolder = value.trim();
		await plugin.saveSettings();
	}

	const saveDrawingFolder = async (enteredValue: string) => {
		const value = enteredValue || DEFAULT_SETTINGS.drawingSubfolder;
		plugin.settings.drawingSubfolder = value.trim();
		await plugin.saveSettings();
	}

	new ToggleAccordionSetting(containerEl)
		.setName(t('Customise file organisation'))
		.setExpanded(plugin.settings.customAttachmentFolders)
		.onToggle( async (value: boolean) => {
			plugin.settings.customAttachmentFolders = value;
			await plugin.saveSettings();
		})
		.setContent((container) => {
			// TODO: This should be abstracted as a dom component
			let obsidianBtn: ButtonComponent, rootBtn: ButtonComponent, noteBtn: ButtonComponent;

			const setActiveLocationButton = (active: 'obsidian' | 'root' | 'note') => {
				obsidianBtn.removeCta(); obsidianBtn.setDisabled(false);
				rootBtn.removeCta();    rootBtn.setDisabled(false);
				noteBtn.removeCta();    noteBtn.setDisabled(false);
				const activeBtn = active === 'obsidian' ? obsidianBtn : active === 'root' ? rootBtn : noteBtn;
				activeBtn.setCta(); activeBtn.setDisabled(true);
			};

			new Setting(container)
				.setClass('ddc_ink_button-set')
				// Keep "笔墨" as the product name.
				.setName(t(`Where should 笔墨 files be saved when created in a note?`))
				// .setDesc(`The writing and drawing files will be saved into same location as other Obsidian attachments rather than the vault's root folder. The files will still be organised into the subfolders you specify below. You can change the default Obsidian attachment path in in the Files and links tab.`)
				.addButton( (button) => {
					obsidianBtn = button;
					button.setButtonText(t('Obsidian attachment folder'))
					button.setClass('ddc_ink_left-most')
					if(plugin.settings.noteAttachmentFolderLocation === 'obsidian') {
						button.setCta()
						button.setDisabled(true)
					}
					button.onClick( async (e) => {
						plugin.settings.noteAttachmentFolderLocation = 'obsidian';
						await plugin.saveSettings();
						setActiveLocationButton('obsidian');
					})
				})
				.addButton( (button) => {
					rootBtn = button;
					button.setButtonText(t('Vault root'))
					button.setClass('ddc_ink_middle')
					if(plugin.settings.noteAttachmentFolderLocation === 'root') {
						button.setCta()
						button.setDisabled(true)
					}
					button.onClick( async (e) => {
						plugin.settings.noteAttachmentFolderLocation = 'root';
						await plugin.saveSettings();
						setActiveLocationButton('root');
					})
				})
				.addButton( (button) => {
					noteBtn = button;
					button.setButtonText(t('Next to the note'))
					button.setClass('ddc_ink_right-most')
					if(plugin.settings.noteAttachmentFolderLocation === 'note') {
						button.setCta()
						button.setDisabled(true)
					}
					button.onClick( async (e) => {
						plugin.settings.noteAttachmentFolderLocation = 'note';
						await plugin.saveSettings();
						setActiveLocationButton('note');
					})
				})
			// TODO: This should be abstracted as a dom component
			// new Setting(container)
			// 	.setClass('ddc_ink_button-set')
			// 	.setName(`Where should 笔墨 files be saved when created independantly?`)
			// 	// .setDesc(`The writing and drawing files will be saved into same location as other Obsidian attachments rather than the vault's root folder. The files will still be organised into the subfolders you specify below. You can change the default Obsidian attachment path in in the Files and links tab.`)
			// 	.addButton( (button) => {
			// 		button.setButtonText('Obsidian attachment folder')
			// 		button.setClass('ddc_ink_left-most')
			// 		if(plugin.settings.notelessAttachmentFolderLocation === 'obsidian') {
			// 			button.setCta()
			// 			button.setDisabled(true)
			// 		}
			// 		button.onClick( async (e) => {
			// 			plugin.settings.notelessAttachmentFolderLocation = 'obsidian';
			// 			await plugin.saveSettings();
			// 			refresh();
			// 		})
			// 	})
			// 	.addButton( (button) => {
			// 		button.setButtonText('Vault root')
			// 		button.setClass('ddc_ink_middle')
			// 		if(plugin.settings.notelessAttachmentFolderLocation === 'root') {
			// 			button.setCta()
			// 			button.setDisabled(true)
			// 		}
			// 		button.onClick( async (e) => {
			// 			plugin.settings.notelessAttachmentFolderLocation = 'root';
			// 			await plugin.saveSettings();
			// 			refresh();
			// 		})
			// 	})

			let inputSettingEl = new Setting(container)
				.setClass('ddc_ink_setting')
				.setName(t('Writing files subfolder'))
				.addText((textItem) => {
					textItem.setValue(plugin.settings.writingSubfolder.toString());
					textItem.setPlaceholder(DEFAULT_SETTINGS.writingSubfolder.toString());
					textItem.inputEl.addEventListener('blur', (_ev: FocusEvent) => {
						void saveWritingFolder(textItem.getValue());
					})
					textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
						if(ev.key === 'Enter') void saveWritingFolder(textItem.getValue());
					})
				});
			inputSettingEl.settingEl.classList.add('ddc_ink_input-medium');

			inputSettingEl = new Setting(container)
				.setClass('ddc_ink_setting')
				.setName(t('Drawing files subfolder'))
				.addText((textItem) => {
					textItem.setValue(plugin.settings.drawingSubfolder.toString());
					textItem.setPlaceholder(DEFAULT_SETTINGS.drawingSubfolder.toString());
					textItem.inputEl.addEventListener('blur', (_ev: FocusEvent) => {
						void saveDrawingFolder(textItem.getValue());
					})
					textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
						if(ev.key === 'Enter') void saveDrawingFolder(textItem.getValue());
					})
				});
			inputSettingEl.settingEl.classList.add('ddc_ink_input-medium');
		})


}

function strokeInputTreatAsSettingDesc(editorKind: StrokeInputEditorKind): DocumentFragment {
	const last = getLastDetectedStrokeInput();
	const detectedLabel = last === 'pen' ? t('Pen') : last === 'mouse' ? t('Mouse') : t('None');

	const frag = createFragment();

	const intro = createEl('p');
	intro.textContent = t(
		'Automatically detect pen or mouse from pressure (auto), use pen pressure and faithful smoothing (pen), or simulated pressure with higher smoothing (mouse).',
	);
	frag.appendChild(intro);

	const detectedParagraph = createEl('p');
	detectedParagraph.classList.add('ddc_ink_stroke-input-detected-paragraph');

	const detectedLine = createEl('strong');
	detectedLine.append(t('Last detected input: '));
	const detectedValue = createSpan();
	detectedValue.className = 'ddc_ink_stroke-input-detected-value';
	detectedValue.textContent = detectedLabel;
	detectedLine.appendChild(detectedValue);
	detectedParagraph.appendChild(detectedLine);

	detectedParagraph.appendChild(createEl('br'));
	detectedParagraph.append(t('If detection is incorrect, choose Pen or Mouse manually.'));

	frag.appendChild(detectedParagraph);
	return frag;
}

/** Auto-transcribe toggle copy; the endpoint hint is shown only when nothing is configured. */
function autoTranscribeOnCloseSettingDesc(
	fileType: HandwritingTranscriptionFileType,
	providerConfigured: boolean,
): DocumentFragment {
	const embedKind = fileType === 'inkWriting' ? t('writing') : t('drawing');

	const frag = createFragment();

	const intro = createEl('p');
	intro.textContent = t(
		"When you lock a {kind} embed or close a dedicated {kind} view, queue the {kind} file to be transcribed automatically. Manual Transcribing in the ink file's menu always stays available.",
		{ kind: embedKind },
	);
	frag.appendChild(intro);

	if (!providerConfigured) {
		const endpointParagraph = createEl('p');
		const endpointLine = createEl('strong');
		endpointLine.textContent = t(
			'Transcription needs an endpoint: fill in the transcription API above and turn it on.',
		);
		endpointParagraph.appendChild(endpointLine);
		frag.appendChild(endpointParagraph);
	}

	return frag;
}

function insertStrokeInputTreatAsSetting(
	contentEl: HTMLElement,
	editorKind: StrokeInputEditorKind,
): ThreeWayToggleSetting<StrokeInputTreatAs> {
	return new ThreeWayToggleSetting<StrokeInputTreatAs>(contentEl)
		.setName(t('Smoothing and pressure'))
		.setDesc(strokeInputTreatAsSettingDesc(editorKind))
		.setOptions([
			{ value: 'auto', label: 'Auto' },
			{ value: 'pen', label: 'Pen' },
			{ value: 'mouse', label: 'Mouse' },
		])
		.setValue(getStrokeInputTreatAs(editorKind))
		.onChange((value) => {
			setStrokeInputTreatAs(editorKind, value);
		});
}

function insertDrawingSettings(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	strokeInputToggles: ThreeWayToggleSetting<StrokeInputTreatAs>[],
): HTMLElement {
	const wrapperEl = containerEl.createDiv('ddc_ink_section-wrapper');
	const sectionEl = wrapperEl.createDiv('ddc_ink_controls-section');

	new Setting(sectionEl)
		.setClass('ddc_ink_controls-header')
		.setName(t('Drawing'))
		.setDesc(t(`While editing a Markdown file, run the action 'insert new hand drawn section' to embed a drawing canvas.`));

	const contentEl = sectionEl.createDiv('ddc_ink_controls-content');

	strokeInputToggles.push(insertStrokeInputTreatAsSetting(contentEl, 'inkDrawing'));

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Show grid in new drawings'))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.drawingGridEnabledByDefault);
			toggle.onChange(async (value: boolean) => {
				plugin.settings.drawingGridEnabledByDefault = value;
				await plugin.saveSettings();
			});
		});

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Show frame around drawing when not editing'))

		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.drawingFrameWhenLocked);
			toggle.onChange( async (value: boolean) => {
				plugin.settings.drawingFrameWhenLocked = value;
				await plugin.saveSettings();
			})
		});

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Show background when not editing'))

		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.drawingBackgroundWhenLocked);
			toggle.onChange( async (value: boolean) => {
				plugin.settings.drawingBackgroundWhenLocked = value;
				await plugin.saveSettings();
			})
		});

	let setDrawingThresholdVisible = (_visible: boolean) => {};

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Automatically transcribe drawings'))
		.setDesc(autoTranscribeOnCloseSettingDesc('inkDrawing', isCustomTranscriptionProviderUsable(plugin.settings.customTranscriptionProvider)))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.drawingAutoTranscribeOnClose);
			toggle.onChange(async (value: boolean) => {
				plugin.settings.drawingAutoTranscribeOnClose = value;
				await plugin.saveSettings();
				if (!value) {
					dropWaitingAutoTranscriptionJobsForFileType('inkDrawing');
				}
				setDrawingThresholdVisible(value);
			});
		});

	setDrawingThresholdVisible = insertAutoTranscribeChangeThresholdSetting(
		contentEl,
		plugin,
		'inkDrawing',
		plugin.settings.drawingAutoTranscribeOnClose,
	);

	return wrapperEl;
}

function insertWritingSettings(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	strokeInputToggles: ThreeWayToggleSetting<StrokeInputTreatAs>[],
): HTMLElement {

	const saveWritingBufferLines = async (enteredValue: string) => {
		const parsed = parseInt(enteredValue);
		const value = (!isNaN(parsed) && parsed >= 0) ? parsed : DEFAULT_SETTINGS.writingBufferLines;
		plugin.settings.writingBufferLines = value;
		await plugin.saveSettings();
	}

	let lineHeightSliderComponent: SliderComponent;
	let lineHeightTextComponent: TextComponent;

	const applyWritingLineHeight = async (value: number) => {
		const clampedValue = Math.max(50, Math.min(400, value));
		plugin.settings.writingLineHeight = clampedValue;
		await plugin.saveSettings();
		lineHeightSliderComponent.setValue(clampedValue);
		lineHeightTextComponent.setValue(clampedValue.toString());
	}

	const wrapperEl = containerEl.createDiv('ddc_ink_section-wrapper');
	const sectionEl = wrapperEl.createDiv('ddc_ink_controls-section');

	new Setting(sectionEl)
		.setClass('ddc_ink_controls-header')
		.setName(t('Writing'))
		// Keep command-name casing as shown in the command palette.
		.setDesc(t(`While editing a Markdown file, run the action 'new handwriting section' to embed a section for writing with a pen.`));

	const contentEl = sectionEl.createDiv('ddc_ink_controls-content');

	strokeInputToggles.push(insertStrokeInputTreatAsSetting(contentEl, 'inkWriting'));

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Show ruled lines when not editing'))

		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.writingLinesWhenLocked);
			toggle.onChange( async (value: boolean) => {
				plugin.settings.writingLinesWhenLocked = value;
				await plugin.saveSettings();
			})
		});

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Show background when not editing'))

		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.writingBackgroundWhenLocked);
			toggle.onChange( async (value: boolean) => {
				plugin.settings.writingBackgroundWhenLocked = value;
				await plugin.saveSettings();
			})
		});
	
	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Line height'))
		.setDesc(t(`Height in pixels of each ruled line. Only affects new writing embeds.`))

		.addSlider((slider) => {
			lineHeightSliderComponent = slider;
			const currentValue = plugin.settings.writingLineHeight ?? DEFAULT_SETTINGS.writingLineHeight;
			slider
				.setLimits(50, 400, 10)
				.setValue(currentValue);
			// 'input' fires continuously while dragging — update the text field in real time
			slider.sliderEl.addEventListener('input', () => {
				lineHeightTextComponent.setValue(slider.getValue().toString());
			});
			// 'onChange' uses the native 'change' event — fires on release, persists the value
			slider.onChange(async (value: number) => {
				await applyWritingLineHeight(value);
			});
		})
		.addText((textItem) => {
			lineHeightTextComponent = textItem;
			const currentValue = plugin.settings.writingLineHeight ?? DEFAULT_SETTINGS.writingLineHeight;
			textItem.setValue(currentValue.toString());
			textItem.inputEl.classList.add('ddc_ink_line-height-input');
			textItem.inputEl.addEventListener('blur', () => {
				const parsed = parseInt(textItem.getValue());
				const valueToApply = !isNaN(parsed) ? parsed : DEFAULT_SETTINGS.writingLineHeight;
				void applyWritingLineHeight(valueToApply);
			});
			textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
				if (ev.key === 'Enter') {
					const parsed = parseInt(textItem.getValue());
					const valueToApply = !isNaN(parsed) ? parsed : DEFAULT_SETTINGS.writingLineHeight;
					void applyWritingLineHeight(valueToApply);
				}
			});
		});

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Buffer lines when editing'))
		.setDesc(t(`Number of empty lines shown below your writing while editing. Writing reaches the last line before the embed extends in height.`))

		.addText((textItem) => {
			textItem.setValue(plugin.settings.writingBufferLines.toString());
			textItem.setPlaceholder(DEFAULT_SETTINGS.writingBufferLines.toString());
			textItem.inputEl.addEventListener('blur', () => {
				void saveWritingBufferLines(textItem.getValue());
			});
			textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
				if (ev.key === 'Enter') void saveWritingBufferLines(textItem.getValue());
			});
		});

	let setWritingThresholdVisible = (_visible: boolean) => {};

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Automatically transcribe writing'))
		.setDesc(autoTranscribeOnCloseSettingDesc('inkWriting', isCustomTranscriptionProviderUsable(plugin.settings.customTranscriptionProvider)))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.writingAutoTranscribeOnClose);
			toggle.onChange(async (value: boolean) => {
				plugin.settings.writingAutoTranscribeOnClose = value;
				await plugin.saveSettings();
				if (!value) {
					dropWaitingAutoTranscriptionJobsForFileType('inkWriting');
				}
				setWritingThresholdVisible(value);
			});
		});

	setWritingThresholdVisible = insertAutoTranscribeChangeThresholdSetting(
		contentEl,
		plugin,
		'inkWriting',
		plugin.settings.writingAutoTranscribeOnClose,
	);

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Mirror transcript below the embed'))
		.setDesc(t('After transcribing, write the text into a collapsed callout directly under the handwriting block. Applies to writing and drawing. Surrounding prose is never touched, and deleting the block stops the mirror.'))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.insertTranscriptBelowEmbed);
			toggle.onChange(async (value: boolean) => {
				plugin.settings.insertTranscriptBelowEmbed = value;
				await plugin.saveSettings();
			});
		});

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('AI caption in the embed alt'))
		.setDesc(t('After transcribing, ask the same endpoint for a one-line caption and use it as the image alt text. Costs one extra request per page. Falls back to the transcript automatically when the model is unavailable.'))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.aiCaptionOnTranscribe);
			toggle.onChange(async (value: boolean) => {
				plugin.settings.aiCaptionOnTranscribe = value;
				await plugin.saveSettings();
			});
		});

	insertWritingLimitations(contentEl);
	return wrapperEl;
}

function insertWritingLimitations(containerEl: HTMLElement) {
	// const sectionEl = containerEl.createDiv('ddc_ink_section ddc_ink_current-limitations-section');
	// const accordion = sectionEl.createEl('details');
	// accordion.createEl('summary', { text: `Notable writing limitations (Expand for details)` });
	// accordion.createEl('p', { text: `Only the last 300 strokes will be visible while writing (Others will dissapear). This is because the plugin currently experiences lag while displaying long amounts of writing that degrades pen fluidity.` });
	// accordion.createEl('p', { text: `All your writing is still saved, however, and will appear in full whenever the embed is locked.` });
}

function insertPrereleaseWarning(containerEl: HTMLElement, plugin: InkPlugin) {
	const wrapperEl = containerEl.createDiv('ddc_ink_section-wrapper');
	const controlsEl = wrapperEl.createDiv('ddc_ink_controls-section');

	const headerSetting = new Setting(controlsEl)
		.setClass('ddc_ink_controls-header')
		.setClass('ddc_ink_controls-header--clickable')
		.setName(t('This plugin is in beta'))
		.setDesc(t('Always back up your files. Expand for details.'));

	const arrowEl = headerSetting.settingEl.createSpan('ddc_ink_collapse-arrow');
	arrowEl.setText('›');

	headerSetting.settingEl.addEventListener('click', () => {
		const expanded = wrapperEl.classList.toggle('ddc_ink_expanded');
		arrowEl.classList.toggle('ddc_ink_expanded', expanded);
	});

	const contentEl = controlsEl.createDiv('ddc_ink_controls-content');
	contentEl.createEl('p', { text: t(`Beta means the plugin is still evolving. Changes to embed formats and file-handling features, even when thoroughly tested, may occasionally introduce issues that affect your vault. Always keep backups of your data.`) });

	new Setting(contentEl)
		.setClass('ddc_ink_setting')
		.setName(t('Enable debug logging'))
		.setDesc(t('When enabled, debug information is written to an ink-debug.md file in your vault root. This includes writing and drawing activity, so do not enable this unless you are actively troubleshooting a bug to provide logs for a bug report. Disable it again once you\'re done.'))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.debugLoggingEnabled);
			toggle.onChange(async (value: boolean) => {
				plugin.settings.debugLoggingEnabled = value;
				await plugin.saveSettings();
			});
		});
}

/**
 * Per-type occupancy-change threshold slider (0–95%). Hidden when auto-transcribe on close is off.
 */
function insertAutoTranscribeChangeThresholdSetting(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	fileType: HandwritingTranscriptionFileType,
	isAutoEnabled: boolean,
): (visible: boolean) => void {
	const settingsKey = fileType === 'inkWriting'
		? 'writingAutoTranscribeChangeThresholdPercent'
		: 'drawingAutoTranscribeChangeThresholdPercent';

	let percentTextComponent: TextComponent;
	const thresholdSetting = new Setting(containerEl)
		.setClass('ddc_ink_setting')
		.setName(t('Re-transcribe when ink file changes significantly'))
		.setDesc(t('0% always transcribes on close or sync; 95% only when ink is almost entirely different. Manual triggered  transcriptions ignore this.'))
		.addSlider((slider) => {
			const currentValue = clampAutoTranscribeChangeThresholdPercent(plugin.settings[settingsKey]);
			slider
				.setLimits(0, AUTO_TRANSCRIBE_CHANGE_THRESHOLD_MAX_PERCENT, 1)
				.setValue(currentValue);
			slider.sliderEl.addEventListener('input', () => {
				percentTextComponent.setValue(`${slider.getValue()}%`);
			});
			slider.onChange(async (value: number) => {
				const clampedValue = clampAutoTranscribeChangeThresholdPercent(value);
				plugin.settings[settingsKey] = clampedValue;
				percentTextComponent.setValue(`${clampedValue}%`);
				await plugin.saveSettings();
			});
		})
		.addText((textItem) => {
			percentTextComponent = textItem;
			const currentValue = clampAutoTranscribeChangeThresholdPercent(plugin.settings[settingsKey]);
			textItem.setValue(`${currentValue}%`);
			textItem.inputEl.classList.add('ddc_ink_line-height-input');
			textItem.setDisabled(true);
		});

	const setVisible = (visible: boolean) => {
		thresholdSetting.settingEl.style.display = visible ? '' : 'none';
	};
	setVisible(isAutoEnabled);
	return setVisible;
}

/**
 * Magic pen timing.
 *
 * Both values are the difference between "the page answered me" and "the page
 * interrupted me", so they are exposed rather than tuned once and frozen: how
 * fast you write and how long you think differ per person and per subject.
 */
function insertMagicInkSettings(containerEl: HTMLElement, plugin: InkPlugin): void {
	const sectionEl = containerEl.createDiv('ddc_ink_controls-section');
	containerEl.createEl('hr');

	new Setting(sectionEl)
		.setClass('ddc_ink_controls-header')
		.setName(t('Magic margin (auto reply)'))
		.setDesc(t('Turn it on with the ✦ button in the writing toolbar. Pause, and the reply writes itself into the corner.'));

	new Setting(sectionEl)
		.setName(t('Pause before replying'))
		.setDesc(t('How long the pen must be still. A short pause interrupts a thought; a long one feels like nothing happened.'))
		.addSlider((slider) => slider
			.setLimits(1000, 6000, 200)
			.setValue(plugin.settings.magicInkIdleMs)
			.setDynamicTooltip()
			.onChange(async (value) => {
				plugin.settings.magicInkIdleMs = value;
				await plugin.saveSettings();
			}));

	new Setting(sectionEl)
		.setName(t('Minimum new strokes'))
		.setDesc(t('A dot or a comma is not worth a request. Counts strokes written since the last reply.'))
		.addSlider((slider) => slider
			.setLimits(1, 8, 1)
			.setValue(plugin.settings.magicInkMinStrokes)
			.setDynamicTooltip()
			.onChange(async (value) => {
				plugin.settings.magicInkMinStrokes = value;
				await plugin.saveSettings();
			}));
}

/**
 * PDF annotation: which note receives the blocks, how a new one is named, and
 * whether the handwriting is mirrored back into the PDF.
 *
 * These live in settings rather than in the annotation prompt because they are
 * decisions about a workflow, not about one page: being asked "which note?" on
 * every Ctrl+Shift+P is exactly the friction that made the command feel
 * unfinished.
 */
function insertPdfAnnotationSection(containerEl: HTMLElement, plugin: InkPlugin): void {
	const sectionEl = containerEl.createDiv('ddc_ink_controls-section');
	containerEl.createEl('hr');

	new Setting(sectionEl)
		.setClass('ddc_ink_controls-header')
		.setName(t('PDF annotation'))
		.setDesc(t('Annotating a PDF turns its pages into handwriting blocks. These settings decide where those blocks land.'));

	new Setting(sectionEl)
		.setName(t('Where annotations go'))
		.addDropdown((dropdown) => dropdown
			.addOption('auto-create', t('Create a note beside the PDF'))
			.addOption('fixed', t('Always use one note'))
			.setValue(plugin.settings.pdfAnnotationNoteMode)
			.onChange(async (value) => {
				plugin.settings.pdfAnnotationNoteMode = value === 'fixed' ? 'fixed' : 'auto-create';
				await plugin.saveSettings();
			}));

	new Setting(sectionEl)
		.setName(t('New note name'))
		.setDesc(t('{pdf} becomes the PDF name, {date} becomes today. A note that already exists is reused, not duplicated.'))
		.addText((text) => text
			.setPlaceholder('{pdf} - 批注')
			.setValue(plugin.settings.pdfAnnotationNoteTemplate)
			.onChange(async (value) => {
				plugin.settings.pdfAnnotationNoteTemplate =
					value.trim() || DEFAULT_SETTINGS.pdfAnnotationNoteTemplate;
				await plugin.saveSettings();
			}));

	new Setting(sectionEl)
		.setName(t('Note to use'))
		.setDesc(t('Vault path of the shared note, e.g. “03-Maps/物理批注”. Created on first use if missing.'))
		.addText((text) => text
			.setPlaceholder(t('Path to a note'))
			.setValue(plugin.settings.pdfAnnotationFixedNotePath)
			.onChange(async (value) => {
				plugin.settings.pdfAnnotationFixedNotePath = value.trim();
				await plugin.saveSettings();
			}));

	new Setting(sectionEl)
		.setName(t('After inserting'))
		.addDropdown((dropdown) => dropdown
			.addOption('foreground', t('Open the note'))
			.addOption('background', t('Stay on the PDF'))
			.setValue(plugin.settings.pdfAnnotationOpenMode)
			.onChange(async (value) => {
				plugin.settings.pdfAnnotationOpenMode = value === 'background' ? 'background' : 'foreground';
				await plugin.saveSettings();
			}));

}
