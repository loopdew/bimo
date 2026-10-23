import { resolveLocale, setLocale, t } from 'src/i18n';
import './settings-tab.scss';
import { App, ButtonComponent, PluginSettingTab, Setting, SliderComponent, TextComponent, ToggleComponent } from "obsidian";
import InkPlugin from "src/main";
import MyPlugin from "src/main";
import { ConfirmationModal } from "src/components/dom-components/modals/confirmation-modal/confirmation-modal";
import { DEFAULT_SETTINGS } from 'src/types/plugin-settings';
import { ToggleAccordionSetting } from 'src/components/dom-components/toggle-accordion-setting';
import { TwoWayToggleSetting } from 'src/components/dom-components/two-way-toggle-setting/two-way-toggle-setting';
import { ThreeWayToggleSetting } from 'src/components/dom-components/three-way-toggle-setting/three-way-toggle-setting';
import { setDominantHand } from 'src/stores/dominant-hand-store';
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

type SettingsPaneId = 'noteink' | 'embeds' | 'ai' | 'device';

const SETTINGS_PANE_ITEMS: ReadonlyArray<{ id: SettingsPaneId; label: string }> = [
	{ id: 'noteink', label: 'Writing on notes' },
	{ id: 'embeds', label: 'Writing & drawing embeds' },
	{ id: 'ai', label: 'AI & model' },
	{ id: 'device', label: 'Device & general' },
];

export class MySettingsTab extends PluginSettingTab {
	plugin: MyPlugin;
	/** Survives the re-render that every settings change triggers. */
	private activePane: SettingsPaneId = 'noteink';
	private unsubscribeDeviceSettings?: () => void;
	private booxCompanionToggle?: ToggleComponent;
	private highContrastUserInterfaceToggle?: ToggleComponent;
	private fingerDrawingToggle?: ToggleComponent;
	private stylusSideButtonTemporaryEraseToggle?: ToggleComponent;
	private strokeInputToggles: ThreeWayToggleSetting<StrokeInputTreatAs>[] = [];

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
		this.strokeInputToggles = [];

		containerEl.empty();
		containerEl.addClass('bimo_settings');

		// ── 顶部标题（纯原生 Obsidian Heading） ──
		const provider = this.plugin.settings.customTranscriptionProvider;
		const connected = Boolean(provider?.enabled && provider.apiKey && provider.model);
		new Setting(containerEl)
			.setName('笔墨')
			.setDesc(
				t('Hand write or draw directly between paragraphs in your notes.')
				+ ` (v${this.plugin.manifest.version} · ${connected ? t('Model connected') : t('No model configured')})`
			)
			.setHeading();

		// ── 原生风格分段标签栏 ──
		const navEl = containerEl.createDiv('bimo_settings-tabs');
		const panesEl = containerEl.createDiv('bimo_settings-panes');
		const panes: Record<SettingsPaneId, HTMLElement> = {
			noteink: panesEl.createDiv('bimo_settings-pane'),
			embeds: panesEl.createDiv('bimo_settings-pane'),
			ai: panesEl.createDiv('bimo_settings-pane'),
			device: panesEl.createDiv('bimo_settings-pane'),
		};

		const navButtons: Record<string, HTMLButtonElement> = {};
		const activate = (id: SettingsPaneId): void => {
			this.activePane = id;
			for (const [paneId, el] of Object.entries(panes)) {
				el.toggleClass('bimo_settings-pane--active', paneId === id);
			}
			for (const [paneId, button] of Object.entries(navButtons)) {
				button.toggleClass('is-active', paneId === id);
			}
			containerEl.closest('.vertical-tab-content')?.scrollTo({ top: 0 });
		};

		for (const item of SETTINGS_PANE_ITEMS) {
			const button = navEl.createEl('button', {
				cls: 'bimo_settings-tab-button',
				text: t(item.label),
			});
			button.addEventListener('click', () => activate(item.id));
			navButtons[item.id] = button;
		}

		// ── 各分类渲染（完全符合 Obsidian 原生设置规范） ──
		this.renderNoteInkSettings(panes.noteink);
		this.renderEmbedsSettings(panes.embeds);
		this.renderAiSettings(panes.ai);
		this.renderDeviceSettings(panes.device);

		// 设备与触控设置订阅
		this.unsubscribeDeviceSettings = subscribeDeviceSettingsChanged(() => {
			if (this.strokeInputToggles[0]) {
				this.strokeInputToggles[0].setDesc(strokeInputTreatAsSettingDesc('inkWriting'));
			}
			if (this.strokeInputToggles[1]) {
				this.strokeInputToggles[1].setDesc(strokeInputTreatAsSettingDesc('inkDrawing'));
			}
			this.booxCompanionToggle?.setValue(getBooxConnectionEnabled());
			this.highContrastUserInterfaceToggle?.setValue(getHighContrastUserInterface());
			this.fingerDrawingToggle?.setValue(getFingerDrawingEnabled());
			this.stylusSideButtonTemporaryEraseToggle?.setValue(getStylusSideButtonTemporaryEraseEnabled());
		});

		// 确保当前选中的分区有效
		if (!SETTINGS_PANE_ITEMS.some((item) => item.id === this.activePane)) {
			this.activePane = 'noteink';
		}
		activate(this.activePane);
	}

	/**
	 * Settings for ink painted directly over a note (NoteInk).
	 */
	private renderNoteInkSettings(container: HTMLElement): void {
		const plugin = this.plugin;

		new Setting(container)
			.setName(t('Writing on notes'))
			.setDesc(t('Draw straight onto a note, over the text, without changing a byte of the Markdown file.'))
			.setHeading();

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
			.setName(t('Straighten shapes'))
			.setDesc(t('A stroke that was nearly a line becomes a line; one that was nearly a closed box becomes a rectangle. Hand-drawn underlines and frames stop looking wobbly.'))
			.addToggle((toggle) => toggle
				.setValue(plugin.settings.mdInkShapeSnap)
				.onChange(async (value) => {
					plugin.settings.mdInkShapeSnap = value;
					plugin.mdInk.refreshOptions({ shapeSnap: value });
					await plugin.saveSettings();
				}));

		// ── 橡皮与触控 ──
		new Setting(container)
			.setName(t('Eraser'))
			.setHeading();

		new Setting(container)
			.setName(t('Eraser mode'))
			.setDesc(t('Object eraser removes the entire stroke on touch; Partial eraser precisely cuts through strokes at hit points.'))
			.addDropdown((dropdown) => dropdown
				.addOption('stroke', t('Object eraser'))
				.addOption('pixel', t('Partial eraser'))
				.setValue(plugin.settings.mdInkEraserMode)
				.onChange(async (value) => {
					plugin.settings.mdInkEraserMode = value as 'stroke' | 'pixel';
					plugin.mdInk.refreshOptions({ eraserMode: plugin.settings.mdInkEraserMode });
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

		// ── 魔法书页 ──
		new Setting(container)
			.setName(`✦ ${t('Magic Diary Page')}`)
			.setDesc(t('You write a line, AI writes a line. Inspired by magical parchment and enchanted diaries. Choose from preset response styles or tailor your own system prompt.'))
			.setHeading();

		new Setting(container)
			.setName(t('Response style'))
			.setDesc(t('Choose the persona and purpose of the Magic Diary Page.'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('chat', t('Companion'))
					.addOption('explain', t('Explain & Teach'))
					.addOption('brainstorm', t('Brainstorm'))
					.addOption('solver', t('Problem Solver'))
					.addOption('custom', t('Custom'))
					.setValue(plugin.settings.magicDiaryPreset)
					.onChange(async (value) => {
						plugin.settings.magicDiaryPreset = value as typeof plugin.settings.magicDiaryPreset;
						plugin.mdInk.refreshOptions({ magicPreset: plugin.settings.magicDiaryPreset });
						await plugin.saveSettings();
						promptSetting.settingEl.style.display =
							plugin.settings.magicDiaryPreset === 'custom' ? 'flex' : 'none';
					});
			});

		const promptSetting = new Setting(container)
			.setName(t('Custom prompt'))
			.setDesc(t('System prompt given to the AI when reading your handwriting on Magic Diary Pages.'))
			.addTextArea((text) => {
				text
					.setPlaceholder(t('Write custom instructions for how the enchanted page should answer your handwritten ink…'))
					.setValue(plugin.settings.magicDiaryCustomPrompt)
					.onChange(async (value) => {
						plugin.settings.magicDiaryCustomPrompt = value;
						plugin.mdInk.refreshOptions({ magicCustomPrompt: value });
						await plugin.saveSettings();
					});
				text.inputEl.rows = 4;
				text.inputEl.style.width = '100%';
			});

		promptSetting.settingEl.style.display =
			plugin.settings.magicDiaryPreset === 'custom' ? 'flex' : 'none';

		container.createEl('p', {
			cls: 'bimo_settings-note',
			text: t('Shortcuts: Mod+Shift+D switches the pen on and off for a note. While the pen is on, Mod+Alt+Z undoes a stroke. Long-press the space bar to pan.'),
		});
	}

	/**
	 * Settings for handwriting and drawing embeds.
	 */
	private renderEmbedsSettings(container: HTMLElement): void {
		const plugin = this.plugin;

		// ── 嵌入手写块 ──
		new Setting(container)
			.setName(t('Handwriting embeds'))
			.setDesc(t("While editing a Markdown file, run the action 'new handwriting section' to embed a section for writing with a pen."))
			.setHeading();

		new Setting(container)
			.setName(t('Enable writing'))
			.setDesc(t('If disabled, you will not be able to add new writing embeds and those already embedded will appear as raw code. Existing writing files will be hidden in Obsidian but still exist on disk. Changing this setting will require a restart of Obsidian to take effect.'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.writingEnabled);
				toggle.onChange(async (value) => {
					plugin.settings.writingEnabled = value;
					await plugin.saveSettings();
				});
			});

		let lineHeightSliderComponent: SliderComponent;
		let lineHeightTextComponent: TextComponent;
		const applyWritingLineHeight = async (value: number) => {
			const clampedValue = Math.max(50, Math.min(400, value));
			plugin.settings.writingLineHeight = clampedValue;
			await plugin.saveSettings();
			lineHeightSliderComponent?.setValue(clampedValue);
			lineHeightTextComponent?.setValue(clampedValue.toString());
		};

		new Setting(container)
			.setName(t('Line height'))
			.setDesc(t('Height in pixels of each ruled line. Only affects new writing embeds.'))
			.addSlider((slider) => {
				lineHeightSliderComponent = slider;
				const currentValue = plugin.settings.writingLineHeight ?? DEFAULT_SETTINGS.writingLineHeight;
				slider.setLimits(50, 400, 10).setValue(currentValue);
				slider.sliderEl.addEventListener('input', () => {
					lineHeightTextComponent?.setValue(slider.getValue().toString());
				});
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

		new Setting(container)
			.setName(t('Buffer lines when editing'))
			.setDesc(t('Number of empty lines shown below your writing while editing. Writing reaches the last line before the embed extends in height.'))
			.addText((textItem) => {
				textItem.setValue(plugin.settings.writingBufferLines.toString());
				textItem.setPlaceholder(DEFAULT_SETTINGS.writingBufferLines.toString());
				const saveBufferLines = async (enteredValue: string) => {
					const parsed = parseInt(enteredValue);
					const value = (!isNaN(parsed) && parsed >= 0) ? parsed : DEFAULT_SETTINGS.writingBufferLines;
					plugin.settings.writingBufferLines = value;
					await plugin.saveSettings();
				};
				textItem.inputEl.addEventListener('blur', () => {
					void saveBufferLines(textItem.getValue());
				});
				textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
					if (ev.key === 'Enter') void saveBufferLines(textItem.getValue());
				});
			});

		new Setting(container)
			.setName(t('Show ruled lines when not editing'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.writingLinesWhenLocked);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.writingLinesWhenLocked = value;
					await plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName(t('Show background when not editing'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.writingBackgroundWhenLocked);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.writingBackgroundWhenLocked = value;
					await plugin.saveSettings();
				});
			});

		this.strokeInputToggles.push(insertStrokeInputTreatAsSetting(container, 'inkWriting'));

		// ── 嵌入绘图画板 ──
		new Setting(container)
			.setName(t('Drawing canvas embeds'))
			.setDesc(t("While editing a Markdown file, run the action 'insert new hand drawn section' to embed a drawing canvas."))
			.setHeading();

		new Setting(container)
			.setName(t('Enable drawing'))
			.setDesc(t('If disabled, you will not be able to add new drawing embeds and those already embedded will appear as raw code. Existing drawing files will be hidden in Obsidian but still exist on disk. Changing this setting will require a restart of Obsidian to take effect.'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.drawingEnabled);
				toggle.onChange(async (value) => {
					plugin.settings.drawingEnabled = value;
					await plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName(t('Show grid in new drawings'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.drawingGridEnabledByDefault);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.drawingGridEnabledByDefault = value;
					await plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName(t('Show frame around drawing when not editing'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.drawingFrameWhenLocked);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.drawingFrameWhenLocked = value;
					await plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName(t('Show background when not editing'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.drawingBackgroundWhenLocked);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.drawingBackgroundWhenLocked = value;
					await plugin.saveSettings();
				});
			});

		this.strokeInputToggles.push(insertStrokeInputTreatAsSetting(container, 'inkDrawing'));

		// ── 智能转录与镜像 ──
		new Setting(container)
			.setName(t('Automatic transcription'))
			.setHeading();

		let setWritingThresholdVisible = (_visible: boolean) => {};
		new Setting(container)
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
			container,
			plugin,
			'inkWriting',
			plugin.settings.writingAutoTranscribeOnClose,
		);

		let setDrawingThresholdVisible = (_visible: boolean) => {};
		new Setting(container)
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
			container,
			plugin,
			'inkDrawing',
			plugin.settings.drawingAutoTranscribeOnClose,
		);

		new Setting(container)
			.setName(t('Mirror transcript below the embed'))
			.setDesc(t('After transcribing, write the text into a collapsed callout directly under the handwriting block. Applies to writing and drawing. Surrounding prose is never touched, and deleting the block stops the mirror.'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.insertTranscriptBelowEmbed);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.insertTranscriptBelowEmbed = value;
					await plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName(t('AI caption in the embed alt'))
			.setDesc(t('After transcribing, ask the same endpoint for a one-line caption and use it as the image alt text. Costs one extra request per page. Falls back to the transcript automatically when the model is unavailable.'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.aiCaptionOnTranscribe);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.aiCaptionOnTranscribe = value;
					await plugin.saveSettings();
				});
			});

		// ── 魔法页边 ──
		new Setting(container)
			.setName(`✦ ${t('Magic margin (auto reply)')}`)
			.setDesc(t('Turn it on with the ✦ button in the writing toolbar. Pause, and the reply writes itself into the corner.'))
			.setHeading();

		new Setting(container)
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

		new Setting(container)
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
	 * Settings for AI model and language.
	 */
	private renderAiSettings(container: HTMLElement): void {
		new Setting(container)
			.setName(t('Interface language'))
			.setHeading();

		new Setting(container)
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

		insertCustomApiSection(container, this.plugin, () => {
			this.renderSettingsTab();
		});
	}

	/**
	 * Settings for device input, storage paths, PDF, and maintenance.
	 */
	private renderDeviceSettings(container: HTMLElement): void {
		const plugin = this.plugin;

		// ── 手写笔与交互 ──
		new Setting(container)
			.setName(t('Stylus & input'))
			.setHeading();

		new TwoWayToggleSetting<DominantHand>(container)
			.setName(t('Dominant hand'))
			.setDesc(t('Which side undo/redo and extend controls appear on while editing.'))
			.setOptionPair('left', t('Left'), 'right', t('Right'))
			.setValue(plugin.settings.dominantHand)
			.onChange(async (value) => {
				plugin.settings.dominantHand = value;
				setDominantHand(value);
				await plugin.saveSettings();
			});

		new Setting(container)
			.setName(t('Side button temporary eraser'))
			.setDesc(t('While held, the pen barrel button (button 2) erases instead of panning. May conflict with right-click pan on some setups.'))
			.addToggle((toggle) => {
				toggle.setValue(getStylusSideButtonTemporaryEraseEnabled());
				this.stylusSideButtonTemporaryEraseToggle = toggle;
				toggle.onChange((value: boolean) => {
					setStylusSideButtonTemporaryEraseEnabled(value);
				});
			});

		new Setting(container)
			.setName(t('Enable finger drawing'))
			.setDesc(t('Shows a toolbar toggle while editing so you can draw with your finger on touch devices. When off, fingers scroll the note as usual.'))
			.addToggle((toggle) => {
				toggle.setValue(getFingerDrawingEnabled());
				this.fingerDrawingToggle = toggle;
				toggle.onChange((value: boolean) => {
					setFingerDrawingEnabled(value);
				});
			});

		new Setting(container)
			.setName(t('High contrast user interface'))
			.setDesc(t('Uses high-contrast borders and controls across 笔墨 embeds and editors — suited to e-ink and grayscale displays.'))
			.addToggle((toggle) => {
				toggle.setValue(getHighContrastUserInterface());
				this.highContrastUserInterfaceToggle = toggle;
				toggle.onChange((value: boolean) => {
					setHighContrastUserInterface(value);
					applyHighContrastUserInterfaceBodyClass();
				});
			});

		new Setting(container)
			.setName(t('Enable Boox companion app'))
			.setDesc(t('Connects to the Boox companion app for passing through smoother pen strokes on supported tablets.'))
			.addToggle((toggle) => {
				toggle.setValue(getBooxConnectionEnabled());
				this.booxCompanionToggle = toggle;
				toggle.onChange((value: boolean) => {
					setBooxConnectionEnabled(value);
					plugin.booxConnection.onSettingsChanged();
				});
			});

		// ── 文件与存储 ──
		new Setting(container)
			.setName(t('File locations'))
			.setHeading();

		insertFileOrganisationSection(container, plugin);

		// ── PDF 批注 ──
		insertPdfAnnotationSection(container, plugin);

		// ── 维护与高级 ──
		new Setting(container)
			.setName(t('Maintenance & advanced'))
			.setHeading();

		new Setting(container)
			.setName(t('Enable debug logging'))
			.setDesc(t('When enabled, debug information is written to an ink-debug.md file in your vault root. This includes writing and drawing activity, so do not enable this unless you are actively troubleshooting a bug to provide logs for a bug report. Disable it again once you\'re done.'))
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.debugLoggingEnabled);
				toggle.onChange(async (value: boolean) => {
					plugin.settings.debugLoggingEnabled = value;
					await plugin.saveSettings();
				});
			});

		const resetSetting = new Setting(container)
			.setName(t('Reset settings'))
			.setDesc(t('Revert to default settings for this plugin?'))
			.addButton((button) => {
				button.setButtonText(t('Reset settings…'));
				button.setWarning();
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
				});
			});

		if (canReloadPlugin(this.plugin)) {
			resetSetting.addButton((button) => {
				button.setButtonText(t('Reload plugin'));
				button.onClick(() => {
					void reloadPlugin(this.plugin);
				});
			});
		}
	}

	hide(): void {
		this.unsubscribeDeviceSettings?.();
		this.unsubscribeDeviceSettings = undefined;
	}
}

function insertFileOrganisationSection(containerEl: HTMLElement, plugin: InkPlugin) {
	const saveWritingFolder = async (enteredValue: string) => {
		const value = enteredValue || DEFAULT_SETTINGS.writingSubfolder;
		plugin.settings.writingSubfolder = value.trim();
		await plugin.saveSettings();
	};

	const saveDrawingFolder = async (enteredValue: string) => {
		const value = enteredValue || DEFAULT_SETTINGS.drawingSubfolder;
		plugin.settings.drawingSubfolder = value.trim();
		await plugin.saveSettings();
	};

	new ToggleAccordionSetting(containerEl)
		.setName(t('Customise file organisation'))
		.setExpanded(plugin.settings.customAttachmentFolders)
		.onToggle(async (value: boolean) => {
			plugin.settings.customAttachmentFolders = value;
			await plugin.saveSettings();
		})
		.setContent((container) => {
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
				.setName(t(`Where should 笔墨 files be saved when created in a note?`))
				.addButton((button) => {
					obsidianBtn = button;
					button.setButtonText(t('Obsidian attachment folder'));
					button.setClass('ddc_ink_left-most');
					if (plugin.settings.noteAttachmentFolderLocation === 'obsidian') {
						button.setCta();
						button.setDisabled(true);
					}
					button.onClick(async () => {
						plugin.settings.noteAttachmentFolderLocation = 'obsidian';
						await plugin.saveSettings();
						setActiveLocationButton('obsidian');
					});
				})
				.addButton((button) => {
					rootBtn = button;
					button.setButtonText(t('Vault root'));
					button.setClass('ddc_ink_middle');
					if (plugin.settings.noteAttachmentFolderLocation === 'root') {
						button.setCta();
						button.setDisabled(true);
					}
					button.onClick(async () => {
						plugin.settings.noteAttachmentFolderLocation = 'root';
						await plugin.saveSettings();
						setActiveLocationButton('root');
					});
				})
				.addButton((button) => {
					noteBtn = button;
					button.setButtonText(t('Next to the note'));
					button.setClass('ddc_ink_right-most');
					if (plugin.settings.noteAttachmentFolderLocation === 'note') {
						button.setCta();
						button.setDisabled(true);
					}
					button.onClick(async () => {
						plugin.settings.noteAttachmentFolderLocation = 'note';
						await plugin.saveSettings();
						setActiveLocationButton('note');
					});
				});

			let inputSettingEl = new Setting(container)
				.setClass('ddc_ink_setting')
				.setName(t('Writing files subfolder'))
				.addText((textItem) => {
					textItem.setValue(plugin.settings.writingSubfolder.toString());
					textItem.setPlaceholder(DEFAULT_SETTINGS.writingSubfolder.toString());
					textItem.inputEl.addEventListener('blur', () => {
						void saveWritingFolder(textItem.getValue());
					});
					textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
						if (ev.key === 'Enter') void saveWritingFolder(textItem.getValue());
					});
				});
			inputSettingEl.settingEl.classList.add('ddc_ink_input-medium');

			inputSettingEl = new Setting(container)
				.setClass('ddc_ink_setting')
				.setName(t('Drawing files subfolder'))
				.addText((textItem) => {
					textItem.setValue(plugin.settings.drawingSubfolder.toString());
					textItem.setPlaceholder(DEFAULT_SETTINGS.drawingSubfolder.toString());
					textItem.inputEl.addEventListener('blur', () => {
						void saveDrawingFolder(textItem.getValue());
					});
					textItem.inputEl.addEventListener('keypress', (ev: KeyboardEvent) => {
						if (ev.key === 'Enter') void saveDrawingFolder(textItem.getValue());
					});
				});
			inputSettingEl.settingEl.classList.add('ddc_ink_input-medium');
		});
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
 * PDF annotation settings card.
 */
function insertPdfAnnotationSection(containerEl: HTMLElement, plugin: InkPlugin): void {
	new Setting(containerEl)
		.setName(t('PDF annotation'))
		.setDesc(t('Annotating a PDF turns its pages into handwriting blocks. These settings decide where those blocks land.'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('Where annotations go'))
		.addDropdown((dropdown) => dropdown
			.addOption('auto-create', t('Create a note beside the PDF'))
			.addOption('fixed', t('Always use one note'))
			.setValue(plugin.settings.pdfAnnotationNoteMode)
			.onChange(async (value) => {
				plugin.settings.pdfAnnotationNoteMode = value === 'fixed' ? 'fixed' : 'auto-create';
				await plugin.saveSettings();
			}));

	new Setting(containerEl)
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

	new Setting(containerEl)
		.setName(t('Note to use'))
		.setDesc(t('Vault path of the shared note, e.g. “03-Maps/物理批注”. Created on first use if missing.'))
		.addText((text) => text
			.setPlaceholder(t('Path to a note'))
			.setValue(plugin.settings.pdfAnnotationFixedNotePath)
			.onChange(async (value) => {
				plugin.settings.pdfAnnotationFixedNotePath = value.trim();
				await plugin.saveSettings();
			}));

	new Setting(containerEl)
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
