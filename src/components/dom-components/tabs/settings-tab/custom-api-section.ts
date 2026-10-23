import { Notice, Setting } from 'obsidian';
import InkPlugin from 'src/main';
import { t } from 'src/i18n';
import {
	DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER,
	DEFAULT_TRANSCRIPTION_PROMPT,
	PROVIDER_PRESETS,
	fetchAvailableModels,
	testCustomTranscriptionConnection,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers';

/////////
/////////

/** Coalesces keystrokes so typing in a text field does not rewrite data.json per character. */
function debouncedSaver(plugin: InkPlugin): () => void {
	let timer: number | null = null;
	return () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			void plugin.saveSettings();
		}, 400);
	};
}

/**
 * "Transcription API" block: user-owned OpenAI-compatible endpoint.
 *
 * Two wire formats are supported because OpenAI ships both, and the whole
 * third-party ecosystem speaks the older one:
 *   - Chat Completions → POST {base}/chat/completions
 *   - Responses        → POST {base}/responses
 */
export function insertCustomApiSection(
	containerEl: HTMLElement,
	plugin: InkPlugin,
	onRerender: () => void,
): void {
	const settings = plugin.settings.customTranscriptionProvider;
	const saveSoon = debouncedSaver(plugin);

	const root = containerEl.createDiv('ink-custom-api-section');
	root.createEl('h3', { text: t('Transcription API') });
	root.createEl('p', {
		text: t(
			'Handwriting transcription runs on your own endpoint — the plugin ships no backend. '
			+ 'Works with OpenAI, Azure OpenAI, DeepSeek, SiliconFlow, Gemini, Moonshot, Ollama, vLLM, '
			+ 'LM Studio, one-api / new-api gateways, and anything else that speaks one of the two formats below.',
		),
		cls: 'setting-item-description',
	});

	new Setting(root)
		.setName(t('Enable transcription'))
		.setDesc(t('When off, transcription and the AI features do nothing. 笔墨 and drawing still work normally.'))
		.addToggle((toggle) => toggle
			.setValue(settings.enabled)
			.onChange(async (value) => {
				settings.enabled = value;
				await plugin.saveSettings();
				onRerender();
			}));

	new Setting(root)
		.setName(t('Provider preset'))
		.setDesc(t(
			'Fill in the address and a suggested model for a known provider. '
			+ 'Choose "Custom" to keep your own values.',
		))
		.addDropdown((dropdown) => {
			dropdown.addOption('', t('Custom / manual'));
			for (const preset of PROVIDER_PRESETS) {
				dropdown.addOption(preset.id, preset.label);
			}
			dropdown.setValue('');
			dropdown.onChange(async (value) => {
				const preset = PROVIDER_PRESETS.find((entry) => entry.id === value);
				if (!preset) return;
				settings.baseUrl = preset.baseUrl;
				settings.apiStyle = preset.apiStyle;
				settings.model = preset.model;
				await plugin.saveSettings();
				if (preset.note) new Notice(`笔墨：已套用 ${preset.label}\n${preset.note}`, 8000);
				onRerender();
			});
		});

	new Setting(root)
		.setName(t('API format'))
		.setDesc(t(
			'Chat Completions is the safest choice — every compatible provider implements it. '
			+ 'Responses is OpenAI’s newer native format, needed by some reasoning models that reject images on the legacy endpoint.',
		))
		.addDropdown((dropdown) => dropdown
			.addOption('chat-completions', t('Chat Completions — /chat/completions'))
			.addOption('responses', t('Responses — /responses'))
			.setValue(settings.apiStyle)
			.onChange(async (value) => {
				settings.apiStyle = value === 'responses' ? 'responses' : 'chat-completions';
				await plugin.saveSettings();
			}));

	new Setting(root)
		.setName(t('Base URL'))
		.setDesc(t('Root URL, e.g. https://api.openai.com/v1. A full …/chat/completions or …/responses URL also works.'))
		.addText((text) => text
			.setPlaceholder(DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER.baseUrl)
			.setValue(settings.baseUrl)
			.onChange((value) => {
				settings.baseUrl = value;
				saveSoon();
			}));

	new Setting(root)
		.setName(t('API key'))
		.setDesc(t(
			'Stored as plain text in data.json, which normally syncs with the vault. '
			+ 'Use a dedicated low-quota key, and leave this blank for endpoints that need no auth.',
		))
		.addText((text) => {
			text.inputEl.type = 'password';
			text.inputEl.autocomplete = 'off';
			text.setPlaceholder('sk-…')
				.setValue(settings.apiKey)
				.onChange((value) => {
					settings.apiKey = value;
					saveSoon();
				});
		});

	const modelDatalist = ensureModelDatalist(root);
	let modelInputEl: HTMLInputElement | null = null;

	new Setting(root)
		.setName(t('Model'))
		.setDesc(t('Click "Fetch models" to list what this key can access, or type an ID directly.'))
		.addText((text) => {
			modelInputEl = text.inputEl;
			text.inputEl.setAttribute('list', MODEL_DATALIST_ID);
			text.inputEl.autocomplete = 'off';
			text.setPlaceholder(DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER.model)
				.setValue(settings.model)
				.onChange((value) => {
					settings.model = value;
					saveSoon();
				});
		})
		.addButton((button) => button
			.setButtonText(t('Fetch models'))
			.onClick(async () => {
				button.setDisabled(true);
				button.setButtonText(t('Fetching…'));
				try {
					const result = await fetchAvailableModels(plugin.settings.customTranscriptionProvider);
					fillModelDatalist(modelDatalist, result.models);
					if (result.models.length === 0) {
						new Notice(`笔墨：${result.warning ?? '端点没有返回任何模型。'}`, 12000);
						return;
					}
					if (!settings.model.trim()) {
						settings.model = result.models[0];
						await plugin.saveSettings();
						if (modelInputEl) modelInputEl.value = settings.model;
					}
					new Notice(`笔墨：获取到 ${result.models.length} 个模型 — 点模型输入框可下拉选择。`, 6000);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`笔墨：获取模型失败 — ${message}`, 14000);
				} finally {
					button.setDisabled(false);
					button.setButtonText(t('Fetch models'));
				}
			}));

	new Setting(root)
		.setName(t('Image format'))
		.setDesc(t(
			'PNG is required by the official OpenAI API, which rejects SVG image inputs. '
			+ 'Only choose SVG for endpoints that explicitly document SVG vision support.',
		))
		.addDropdown((dropdown) => dropdown
			.addOption('png', t('PNG — rasterised, widest support'))
			.addOption('svg', t('SVG — smallest payload, exotic endpoints only'))
			.setValue(settings.mediaFormat)
			.onChange(async (value) => {
				settings.mediaFormat = value === 'svg' ? 'svg' : 'png';
				await plugin.saveSettings();
				if (settings.mediaFormat === 'svg') {
					new Notice(
						'笔墨：DeepSeek、OpenAI、硅基流动等主流视觉接口都不接受 SVG。'
						+ '选 SVG 时每次转录都会先被拒、再自动改用 PNG 重试，白多一次往返。'
						+ '除非你确认自己的接口支持 SVG，否则请改回 PNG。',
						12000,
					);
				}
			}));

	new Setting(root)
		.setName(t('Thinking mode'))
		.setDesc(t(
			'Transcription is recognition, not reasoning — thinking only adds latency. '
			+ 'Measured on DeepSeek: turning it off was 2x faster and 20% fewer tokens with '
			+ 'identical accuracy. Use "Provider default" if your model rejects the switch.',
		))
		.addDropdown((dropdown) => dropdown
			.addOption('default', t('Provider default — send nothing'))
			.addOption('off', t('Off — fastest'))
			.addOption('low', t('Low'))
			.addOption('medium', t('Medium'))
			.addOption('high', t('High'))
			.setValue(settings.reasoningMode)
			.onChange(async (value) => {
				settings.reasoningMode = (
					value === 'off' || value === 'low' || value === 'medium' || value === 'high'
						? value
						: 'default'
				);
				await plugin.saveSettings();
			}));

	// ---- Advanced ---------------------------------------------------------

	const advancedEl = root.createDiv('ink-custom-api-advanced');

	new Setting(advancedEl)
		.setName(t('Max output tokens'))
		.setDesc(t('0 = do not send a token limit field.'))
		.addText((text) => {
			text.inputEl.type = 'number';
			text.setValue(String(settings.maxOutputTokens))
				.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					settings.maxOutputTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
					saveSoon();
				});
		});

	new Setting(advancedEl)
		.setName(t('Temperature'))
		.setDesc(t('Blank = do not send. Some reasoning models only accept their default.'))
		.addText((text) => text
			.setPlaceholder(t('blank'))
			.setValue(settings.temperature)
			.onChange((value) => {
				settings.temperature = value;
				saveSoon();
			}));

	new Setting(advancedEl)
		.setName(t('Timeout (ms)'))
		.setDesc(t('How long the queue waits before treating the request as failed. 0 = no limit.'))
		.addText((text) => {
			text.inputEl.type = 'number';
			text.setValue(String(settings.timeoutMs))
				.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					settings.timeoutMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 120000;
					saveSoon();
				});
		});

	new Setting(advancedEl)
		.setName(t('Transcription prompt'))
		.setDesc(t('Leave blank to use the built-in prompt. It is sent as a system message; the image goes in a separate user turn.'))
		.addTextArea((area) => {
			area.inputEl.rows = 8;
			area.setPlaceholder(DEFAULT_TRANSCRIPTION_PROMPT)
				.setValue(settings.systemPrompt)
				.onChange((value) => {
					settings.systemPrompt = value;
					saveSoon();
				});
		});

	new Setting(advancedEl)
		.setName(t('Extra body JSON'))
		.setDesc(t('Optional object merged into the request body last — wins over every default. Example: {"reasoning_effort":"low"}'))
		.addTextArea((area) => {
			area.inputEl.rows = 3;
			area.setPlaceholder('{}')
				.setValue(settings.extraBodyJson)
				.onChange((value) => {
					settings.extraBodyJson = value;
					saveSoon();
				});
		});

	new Setting(advancedEl)
		.setName(t('Extra headers JSON'))
		.setDesc(t('Optional object of extra request headers. Azure OpenAI example: {"api-key":"…"}'))
		.addTextArea((area) => {
			area.inputEl.rows = 3;
			area.setPlaceholder('{}')
				.setValue(settings.extraHeadersJson)
				.onChange((value) => {
					settings.extraHeadersJson = value;
					saveSoon();
				});
		});

	// ---- Actions ----------------------------------------------------------

	new Setting(root)
		.setName(t('Test connection'))
		.setDesc(t('Sends a 1×1 image through the real request path: URL, auth, model, format, and vision support.'))
		.addButton((button) => button
			.setButtonText(t('Test'))
			.setCta()
			.onClick(async () => {
				const current: CustomTranscriptionProviderSettings =
					plugin.settings.customTranscriptionProvider;
				const problem = validateForTest(current, t);
				if (problem) {
					new Notice(`笔墨：${problem}`);
					return;
				}
				button.setDisabled(true);
				button.setButtonText(t('Testing…'));
				try {
					const reply = await testCustomTranscriptionConnection(current);
					const preview = reply.trim().slice(0, 60) || '(empty reply)';
					new Notice(`笔墨：接口可用，返回「${preview}」`);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`笔墨：连接失败 — ${message}`, 12000);
				} finally {
					button.setDisabled(false);
					button.setButtonText(t('Test'));
				}
			}))
		.addButton((button) => button
			.setButtonText(t('Reset'))
			.onClick(async () => {
				Object.assign(settings, DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER);
				await plugin.saveSettings();
				new Notice('笔墨：识别 API 设置已重置（API 密钥已清空）。');
				onRerender();
			}));
}

/** Mirrors the runtime guards so the Test button explains itself before firing. */
function validateForTest(
	settings: CustomTranscriptionProviderSettings,
	translate: (key: string) => string,
): string | null {
	if (!settings.baseUrl.trim()) return translate('Base URL is empty.');
	if (!settings.model.trim()) return translate('Model is empty.');
	for (const [raw, label] of [
		[settings.extraBodyJson, translate('Extra body JSON')],
		[settings.extraHeadersJson, translate('Extra headers JSON')],
	] as const) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		try {
			const value: unknown = JSON.parse(trimmed);
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				return translate('{label} must be a JSON object.').replace('{label}', label);
			}
		} catch {
			return translate('{label} is not valid JSON.').replace('{label}', label);
		}
	}
	return null;
}

//////////
//////////

const MODEL_DATALIST_ID = 'ink-custom-api-model-list';

/**
 * One `<datalist>` per settings render, shared by the Model input.
 *
 * A datalist rather than a `<select>` because the two requirements conflict:
 * picking from `/models` must be one click, but typing an ID must still work for
 * endpoints that do not implement the route at all.
 */
function ensureModelDatalist(root: HTMLElement): HTMLDataListElement {
	const existing = root.querySelector<HTMLDataListElement>(`#${MODEL_DATALIST_ID}`);
	if (existing) return existing;
	const datalist = document.createElement('datalist');
	datalist.id = MODEL_DATALIST_ID;
	root.appendChild(datalist);
	return datalist;
}

function fillModelDatalist(datalist: HTMLDataListElement, models: string[]): void {
	while (datalist.firstChild) datalist.removeChild(datalist.firstChild);
	for (const id of models) {
		const option = document.createElement('option');
		option.value = id;
		datalist.appendChild(option);
	}
}
