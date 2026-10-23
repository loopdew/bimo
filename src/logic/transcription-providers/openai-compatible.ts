import { requestUrl } from 'obsidian';
import { HandwritingTranscriptionJobError } from 'src/logic/transcription-errors';
import { verbose } from 'src/logic/utils/universal-dev-logging';

import type { ProviderMedia } from './media';
import {
	DEFAULT_TRANSCRIPTION_PROMPT,
	type CustomTranscriptionProviderSettings,
	type TranscriptionApiStyle,
} from './types';

//////////
//////////

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Normalises whatever the user pasted into a root URL.
 *
 * Accepts `https://api.openai.com`, `https://api.openai.com/v1/`, and even the
 * full `https://.../v1/chat/completions`, all collapsing to `https://api.openai.com/v1`.
 * A bare origin gets `/v1` appended because that is the OpenAI convention; any
 * existing path is preserved so proxy prefixes survive.
 */
export function normalizeProviderBaseUrl(raw: string): string {
	let url = (raw ?? '').trim();
	if (!url) return OPENAI_DEFAULT_BASE_URL;

	url = url.replace(/\/+$/, '');
	url = url.replace(/\/(chat\/completions|responses)$/i, '');
	url = url.replace(/\/+$/, '');
	if (!url) return OPENAI_DEFAULT_BASE_URL;

	try {
		const parsed = new URL(url);
		if (parsed.pathname === '' || parsed.pathname === '/') {
			return `${parsed.origin}/v1`;
		}
		return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
	} catch {
		// Malformed input is left alone; requestUrl reports the real problem.
		return url;
	}
}

/** Config problems are not retryable — retrying the same bad settings is pointless. */
function configError(message: string): HandwritingTranscriptionJobError {
	return new HandwritingTranscriptionJobError({
		message,
		status: 0,
		code: 'bad_config',
		retryable: false,
	});
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) return {};
	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		throw configError(`${label} is not valid JSON`);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw configError(`${label} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

export function buildHeaders(settings: CustomTranscriptionProviderSettings): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const apiKey = settings.apiKey.trim();
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	const extra = parseJsonObject(settings.extraHeadersJson, 'Extra headers JSON');
	for (const [key, value] of Object.entries(extra)) {
		if (typeof value !== 'string') {
			throw configError(`Extra header "${key}" must be a string value`);
		}
		headers[key] = value;
	}
	return headers;
}

function applyTokenLimit(
	body: Record<string, unknown>,
	settings: CustomTranscriptionProviderSettings,
	field: 'max_tokens' | 'max_output_tokens',
): void {
	const limit = settings.maxOutputTokens;
	if (Number.isFinite(limit) && limit > 0) {
		body[field] = Math.floor(limit);
	}
	const rawTemperature = settings.temperature.trim();
	if (rawTemperature !== '') {
		const temperature = Number.parseFloat(rawTemperature);
		if (!Number.isFinite(temperature)) {
			throw configError('Temperature must be a number, or blank');
		}
		body.temperature = temperature;
	}
}

/**
 * Short instruction sent alongside the image. The rules live in the system
 * message instead: when rules and image competed in one user turn the model
 * followed them loosely, and burned ~3x the tokens working out what to do.
 */
export const USER_TRANSCRIPTION_INSTRUCTION = '转录这张图。';

/** True when the endpoint belongs to a provider with its own thinking switch. */
function isDeepSeekEndpoint(baseUrl: string): boolean {
	return /deepseek/i.test(baseUrl);
}

/**
 * Adds the thinking controls for the configured {@link TranscriptionReasoningMode}.
 *
 * The wire shape is provider-specific:
 * - Chat Completions + DeepSeek → `thinking: {type}` (DeepSeek's documented switch;
 *   its effort scale is only low/high/max, so `medium` collapses to `high`).
 * - Chat Completions + everyone else → `reasoning_effort` (OpenAI and the whole
 *   compatible ecosystem read this; `none` disables reasoning).
 * - Responses → `reasoning: {effort}` with `none` for off.
 *
 * `default` sends nothing, which is the escape hatch for models that reject the
 * parameter outright.
 */
export function applyReasoningSettings(
	body: Record<string, unknown>,
	settings: CustomTranscriptionProviderSettings,
	style: TranscriptionApiStyle,
): void {
	const mode = settings.reasoningMode;
	if (!mode || mode === 'default') return;

	if (style === 'responses') {
		body.reasoning = { effort: mode === 'off' ? 'none' : mode };
		return;
	}

	if (isDeepSeekEndpoint(settings.baseUrl)) {
		if (mode === 'off') {
			body.thinking = { type: 'disabled' };
			return;
		}
		body.thinking = { type: 'enabled' };
		body.reasoning_effort = mode === 'medium' ? 'high' : mode;
		return;
	}

	body.reasoning_effort = mode === 'off' ? 'none' : mode;
}

/** True when the request carries one of the thinking fields added above. */
export function hasReasoningFields(body: Record<string, unknown>): boolean {
	return 'reasoning' in body || 'reasoning_effort' in body || 'thinking' in body;
}

/** Drops every thinking field so a rejected request can be retried verbatim. */
export function stripReasoningFields(body: Record<string, unknown>): void {
	delete body.reasoning;
	delete body.reasoning_effort;
	delete body.thinking;
}

/**
 * A model that refuses the thinking parameter answers 400 naming it. Retrying
 * without the field beats surfacing a config error the user cannot act on.
 */
export function isReasoningRejection(status: number, message: string): boolean {
	if (status !== 400 && status !== 422) return false;
	return /reasoning|thinking|effort/i.test(message);
}

/**
 * Chat Completions body.
 *
 * Deliberately minimal: `model` + `messages` only, plus anything the user opted
 * into. Every extra field is a compatibility risk on strict gateways, so
 * `max_tokens` / `temperature` are sent only when configured.
 */
export function buildChatCompletionsBody(
	settings: CustomTranscriptionProviderSettings,
	media: ProviderMedia | null,
	prompt: string,
	userText: string = USER_TRANSCRIPTION_INSTRUCTION,
	history: ChatTurn[] = [],
): Record<string, unknown> {
	const content: unknown[] = [{ type: 'text', text: userText }];
	if (media) {
		content.push({
			type: 'image_url',
			image_url: { url: `data:${media.mediaType};base64,${media.mediaBase64}` },
		});
	}

	const body: Record<string, unknown> = {
		model: settings.model.trim(),
		messages: [
			{ role: 'system', content: prompt },
			...history.map((turn) => ({ role: turn.role, content: turn.text })),
			{ role: 'user', content },
		],
	};
	applyTokenLimit(body, settings, 'max_tokens');
	applyReasoningSettings(body, settings, 'chat-completions');
	return { ...body, ...parseJsonObject(settings.extraBodyJson, 'Extra body JSON') };
}

/**
 * Responses body — same content, `input_text` / `input_image` part names.
 * The system prompt maps to the top-level `instructions` field here; Responses
 * has no `role: 'system'` message inside `input`.
 */
export function buildResponsesBody(
	settings: CustomTranscriptionProviderSettings,
	media: ProviderMedia | null,
	prompt: string,
	userText: string = USER_TRANSCRIPTION_INSTRUCTION,
	history: ChatTurn[] = [],
): Record<string, unknown> {
	const content: unknown[] = [{ type: 'input_text', text: userText }];
	if (media) {
		content.push({
			type: 'input_image',
			image_url: `data:${media.mediaType};base64,${media.mediaBase64}`,
		});
	}

	const body: Record<string, unknown> = {
		model: settings.model.trim(),
		instructions: prompt,
		input: [
			// Responses takes a flat list of turns; assistant text uses `output_text`.
			...history.map((turn) => ({
				role: turn.role,
				content: [{
					type: turn.role === 'assistant' ? 'output_text' : 'input_text',
					text: turn.text,
				}],
			})),
			{ role: 'user', content },
		],
	};
	applyTokenLimit(body, settings, 'max_output_tokens');
	applyReasoningSettings(body, settings, 'responses');
	return { ...body, ...parseJsonObject(settings.extraBodyJson, 'Extra body JSON') };
}

/**
 * `choices[0].message.content` is a string on the classic endpoint, but several
 * providers return a content-part array (and legacy `/completions` returns
 * `choices[0].text`). All three shapes are accepted.
 */
export function extractChatCompletionsText(json: unknown): string | null {
	if (!json || typeof json !== 'object') return null;
	const record = json as Record<string, unknown>;
	const choices = record.choices;
	if (!Array.isArray(choices) || choices.length === 0) return null;
	const choice = choices[0] as Record<string, unknown> | null;
	if (!choice) return null;

	const message = choice.message as Record<string, unknown> | null | undefined;
	if (message) {
		if (typeof message.content === 'string') return message.content;
		const parts = readTextParts(message.content);
		if (parts !== null) return parts;
	}
	if (typeof choice.text === 'string') return choice.text;
	return null;
}

/**
 * Responses API output. `output` interleaves reasoning items and message items,
 * so only `type === 'message'` blocks contribute text. Some gateways expose the
 * flattened `output_text` convenience field instead, which wins when present.
 */
export function extractResponsesText(json: unknown): string | null {
	if (!json || typeof json !== 'object') return null;
	const record = json as Record<string, unknown>;
	if (typeof record.output_text === 'string') return record.output_text;

	const output = record.output;
	if (!Array.isArray(output)) return null;

	const blocks: string[] = [];
	for (const item of output) {
		if (!item || typeof item !== 'object') continue;
		const entry = item as Record<string, unknown>;
		if (entry.type !== 'message') continue;
		const parts = readTextParts(entry.content);
		if (parts) blocks.push(parts);
	}
	return blocks.length > 0 ? blocks.join('') : null;
}

/** Concatenates `{type:'text'|'output_text', text}` parts; null when not an array. */
function readTextParts(content: unknown): string | null {
	if (!Array.isArray(content)) return null;
	const texts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') continue;
		const entry = part as Record<string, unknown>;
		if (entry.type !== 'text' && entry.type !== 'output_text') continue;
		if (typeof entry.text === 'string') texts.push(entry.text);
	}
	return texts.length > 0 ? texts.join('') : null;
}

function readApiErrorMessage(json: unknown, status: number): string {
	if (json && typeof json === 'object') {
		const record = json as Record<string, unknown>;
		const error = record.error;
		if (typeof error === 'string') return error;
		if (error && typeof error === 'object') {
			const message = (error as Record<string, unknown>).message;
			if (typeof message === 'string') return message;
		}
		if (typeof record.message === 'string') return record.message;
	}
	if (typeof json === 'string' && json.trim()) return json.trim().slice(0, 300);
	return `Transcription endpoint returned HTTP ${status}`;
}

function readApiErrorCode(json: unknown): string | null {
	if (!json || typeof json !== 'object') return null;
	const error = (json as Record<string, unknown>).error;
	if (!error || typeof error !== 'object') return null;
	const record = error as Record<string, unknown>;
	if (typeof record.code === 'string') return record.code;
	if (typeof record.type === 'string') return record.type;
	return null;
}

/**
 * 401/402/403/400 mean the request or the key is wrong — replaying it changes
 * nothing. Only transport failures, rate limits, and server errors are retryable.
 */
function isRetryableStatus(status: number): boolean {
	return status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Client-side deadline. `requestUrl` itself cannot be cancelled, but the queue stops waiting. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	const ms = Math.floor(timeoutMs);
	if (!Number.isFinite(ms) || ms <= 0) return promise;
	return new Promise<T>((resolve, reject) => {
		const timer = globalThis.setTimeout(() => {
			reject(new HandwritingTranscriptionJobError({
				message: `Transcription request timed out after ${ms} ms`,
				status: 0,
				code: 'timeout',
				retryable: true,
			}));
		}, ms);
		promise.then(
			(value) => { globalThis.clearTimeout(timer); resolve(value); },
			(error) => { globalThis.clearTimeout(timer); reject(error); },
		);
	});
}

/** One earlier turn. The current user message is passed separately as `userText`. */
export interface ChatTurn {
	role: 'user' | 'assistant';
	text: string;
}

export interface RequestCustomTranscriptionParams {
	/** Page image. `null` sends a text-only turn (captions, figure plots, panel replies). */
	media: ProviderMedia | null;
	settings: CustomTranscriptionProviderSettings;
	/** Replaces the built-in 「转录这张图。」 user instruction. */
	userText?: string;
	/** Replaces the transcription system prompt without touching saved settings. */
	systemPromptOverride?: string;
	/** Prior turns, oldest first. Used by the magic panel for follow-up questions. */
	history?: ChatTurn[];
}

/**
 * Sends one page image to the user's own endpoint and returns the transcription.
 *
 * Throws {@link HandwritingTranscriptionJobError} on every failure so the existing
 * transcription queue keeps its retry/notice behaviour unchanged.
 */
export async function requestCustomTranscription(
	params: RequestCustomTranscriptionParams,
): Promise<string> {
	const { media, settings } = params;

	const model = settings.model.trim();
	if (!model) throw configError('Model is required for the custom transcription endpoint');

	const prompt = params.systemPromptOverride?.trim()
		|| settings.systemPrompt.trim()
		|| DEFAULT_TRANSCRIPTION_PROMPT;
	const userText = params.userText ?? USER_TRANSCRIPTION_INSTRUCTION;
	const baseUrl = normalizeProviderBaseUrl(settings.baseUrl);
	const headers = buildHeaders(settings);

	const isResponses = settings.apiStyle === 'responses';
	const endpoint = `${baseUrl}/${isResponses ? 'responses' : 'chat/completions'}`;
	const history = params.history ?? [];
	const body = isResponses
		? buildResponsesBody(settings, media, prompt, userText, history)
		: buildChatCompletionsBody(settings, media, prompt, userText, history);

	const send = async (payload: Record<string, unknown>): Promise<{ status: number; json: unknown }> => {
		try {
			const response = await withTimeout(
				requestUrl({
					url: endpoint,
					method: 'POST',
					headers,
					body: JSON.stringify(payload),
					throw: false,
				}),
				settings.timeoutMs,
			);
			let parsed: unknown;
			try {
				parsed = response.json;
			} catch {
				parsed = response.text;
			}
			return { status: response.status, json: parsed };
		} catch (error) {
			if (error instanceof HandwritingTranscriptionJobError) throw error;
			const detail = error instanceof Error ? error.message : String(error);
			throw new HandwritingTranscriptionJobError({
				message: `Could not reach ${baseUrl}: ${detail}`,
				status: 0,
				code: 'network',
				retryable: true,
			});
		}
	};

	let { status, json } = await send(body);

	// Some models reject `reasoning_effort: "none"` outright (GPT-6 Astra returns
	// 400). Retry once without any thinking field instead of failing the page.
	if (hasReasoningFields(body) && isReasoningRejection(status, readApiErrorMessage(json, status))) {
		const trimmed = { ...body };
		stripReasoningFields(trimmed);
		verbose('Transcription endpoint rejected the thinking parameter, retrying without it');
		({ status, json } = await send(trimmed));
	}

	if (status < 200 || status >= 300) {
		throw new HandwritingTranscriptionJobError({
			message: readApiErrorMessage(json, status),
			status,
			code: readApiErrorCode(json),
			retryable: isRetryableStatus(status),
		});
	}

	const text = isResponses ? extractResponsesText(json) : extractChatCompletionsText(json);
	if (text === null) {
		throw new HandwritingTranscriptionJobError({
			message: 'Transcription endpoint returned no text content',
			status,
			code: 'invalid_response',
			retryable: true,
		});
	}
	return text;
}
