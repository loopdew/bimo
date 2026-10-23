//////////
//////////

/**
 * Which OpenAI wire format the user's endpoint speaks.
 *
 * - `chat-completions` — `POST {baseUrl}/chat/completions`. This is the de-facto
 *   standard implemented by essentially every OpenAI-compatible provider and
 *   gateway (DeepSeek, SiliconFlow, Moonshot, one-api, new-api, Ollama, vLLM,
 *   LM Studio, llama.cpp, Azure OpenAI). Text comes back in
 *   `choices[0].message.content`; the image travels as an `image_url` content part.
 *
 * - `responses` — `POST {baseUrl}/responses`. OpenAI's newer native API. Text comes
 *   back in `output[].content[].text`, filtered to `type === 'message'`; the image
 *   travels as an `input_image` content part. Required for some reasoning models
 *   that reject image parts on the legacy endpoint.
 */
export type TranscriptionApiStyle = 'chat-completions' | 'responses';

/**
 * Image format sent to the endpoint.
 *
 * OpenAI's official image inputs accept PNG/JPEG/WEBP/GIF — **not** `image/svg+xml`.
 * `png` is therefore the safe default. `svg` is only useful for endpoints that
 * explicitly document SVG vision support, and is kept as an opt-in.
 */
export type TranscriptionMediaFormat = 'png' | 'svg';

/**
 * How much thinking the model is allowed to spend before answering.
 *
 * Transcription is perception, not reasoning — measured on DeepSeek, turning
 * thinking off was 2x faster and 20% cheaper with no accuracy loss, provided the
 * prompt pins the output format. `default` sends nothing and lets the provider
 * decide, which is the safe fallback when a model rejects `none`.
 */
export type TranscriptionReasoningMode = 'default' | 'off' | 'low' | 'medium' | 'high';

/** User-owned transcription endpoint. Stored in `data.json` (vault-synced). */
export interface CustomTranscriptionProviderSettings {
	/** When true this replaces the Almost Useful portal for every transcription. */
	enabled: boolean;
	apiStyle: TranscriptionApiStyle;
	/** Root URL such as `https://api.openai.com/v1`. A full endpoint URL also works. */
	baseUrl: string;
	apiKey: string;
	model: string;
	mediaFormat: TranscriptionMediaFormat;
	reasoningMode: TranscriptionReasoningMode;
	/** Empty string falls back to {@link DEFAULT_TRANSCRIPTION_PROMPT}. */
	systemPrompt: string;
	/** `0` means "do not send any max-token field". */
	maxOutputTokens: number;
	/** Kept as text so the field can be blank (= omit). */
	temperature: string;
	/** Milliseconds; `0` disables the client-side timeout. */
	timeoutMs: number;
	/** Advanced: JSON object merged into the request body last (wins over defaults). */
	extraBodyJson: string;
	/** Advanced: JSON object of extra headers, e.g. `api-key` for Azure OpenAI. */
	extraHeadersJson: string;
}

export const DEFAULT_TRANSCRIPTION_PROMPT = `你是一个手写转录引擎。收到一张手写或手绘图片，把其中的内容转成 Markdown。

输出规则：
1. 只输出转录结果。不要开场白、不要解释、不要用代码块包裹。
2. 保持原语言，不翻译。
3. 一行手写对应一行输出，保留原有换行。
4. 行首的圆点、方框、星号、箭头等符号（- – • · * ★ ☐ ☑ →）统一为 "- "。
5. 已有的编号（1. 2. 一、二、）原样保留。
6. 只有明显居中、或字号显著大于正文的标题才用 "## "。正文里的强调、加粗、下划线、荧光标记一律不加标题标记。
7. 所有数学内容都必须写成 LaTeX 并用 $ 包裹：行内 $...$，独立成行 $$...$$。
   禁止使用 Unicode 数学字符，不要写 ² ³ ₀ ₁ ∮ ε ∑ ∫ √ ≤ ≥ ≠，改写成 ^2 ^3 _0 \\oint \\varepsilon \\sum \\int \\sqrt \\le \\ge \\ne。
   再简单的式子也要包 $，写成 $r^2$ 而不是 r²。公式内部不要添加 \\quad、\\qquad 这类排版间距命令。
8. 线条画成的表格转成 Markdown 表格。
9. 正文中的箭头（-> ⇒ →）输出为 "->"。
10. 认不出的字写 "⟨?⟩"，不要编造。
11. 没有文字的纯图画，用一句斜体说明，如 *节点图草图*。
12. 图片空白则不输出任何内容。
13. 缩进一律用两个半角空格，禁止使用全角空格（U+3000）。
14. 标点照原文书写，不要替换成其它标点。
15. 空白行是硬性要求：标题后空一行；列表块与编号列表之间空一行；列表与段落之间空一行。`;

export const DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER: CustomTranscriptionProviderSettings = {
	enabled: false,
	apiStyle: 'chat-completions',
	baseUrl: 'https://api.openai.com/v1',
	apiKey: '',
	model: 'gpt-4.1-mini',
	mediaFormat: 'png',
	// Transcription is perception, so thinking only adds latency here.
	reasoningMode: 'off',
	systemPrompt: '',
	maxOutputTokens: 0,
	temperature: '',
	timeoutMs: 120000,
	extraBodyJson: '',
	extraHeadersJson: '',
};

const REASONING_MODES: TranscriptionReasoningMode[] = ['default', 'off', 'low', 'medium', 'high'];

function readReasoningMode(raw: unknown): TranscriptionReasoningMode {
	return REASONING_MODES.includes(raw as TranscriptionReasoningMode)
		? (raw as TranscriptionReasoningMode)
		: DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER.reasoningMode;
}

/**
 * Reads provider settings out of possibly-partial persisted data, filling every
 * missing field with its default. Keeps old `data.json` files loadable.
 */
export function normalizeCustomTranscriptionProvider(
	raw: unknown,
): CustomTranscriptionProviderSettings {
	const base = DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER;
	if (!raw || typeof raw !== 'object') return { ...base };
	const record = raw as Record<string, unknown>;

	const readString = (key: keyof CustomTranscriptionProviderSettings): string => {
		const value = record[key];
		return typeof value === 'string' ? value : (base[key] as string);
	};
	const readBoolean = (key: keyof CustomTranscriptionProviderSettings): boolean => {
		const value = record[key];
		return typeof value === 'boolean' ? value : (base[key] as boolean);
	};
	const readNumber = (key: keyof CustomTranscriptionProviderSettings): number => {
		const value = record[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : (base[key] as number);
	};

	const apiStyle = record.apiStyle === 'responses' ? 'responses' : 'chat-completions';
	const mediaFormat = record.mediaFormat === 'svg' ? 'svg' : 'png';
	const reasoningMode = readReasoningMode(record.reasoningMode);

	return {
		enabled: readBoolean('enabled'),
		apiStyle,
		baseUrl: readString('baseUrl'),
		apiKey: readString('apiKey'),
		model: readString('model'),
		mediaFormat,
		reasoningMode,
		systemPrompt: readString('systemPrompt'),
		maxOutputTokens: readNumber('maxOutputTokens'),
		temperature: readString('temperature'),
		timeoutMs: readNumber('timeoutMs'),
		extraBodyJson: readString('extraBodyJson'),
		extraHeadersJson: readString('extraHeadersJson'),
	};
}

/** True when a custom endpoint is enabled *and* has the minimum config to run. */
export function isCustomTranscriptionProviderUsable(
	settings: CustomTranscriptionProviderSettings,
): boolean {
	return settings.enabled && Boolean(settings.baseUrl.trim()) && Boolean(settings.model.trim());
}
