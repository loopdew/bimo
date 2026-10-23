import {
	buildChatCompletionsBody,
	buildResponsesBody,
	extractChatCompletionsText,
	extractResponsesText,
	normalizeProviderBaseUrl,
	hasReasoningFields,
	isReasoningRejection,
	stripReasoningFields,
	USER_TRANSCRIPTION_INSTRUCTION,
} from 'src/logic/transcription-providers/openai-compatible';
import {
	DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER,
	isCustomTranscriptionProviderUsable,
	normalizeCustomTranscriptionProvider,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers/types';
import { PROVIDER_PRESETS } from 'src/logic/transcription-providers/presets';

//////////
//////////

const MEDIA = {
	mediaType: 'image/png' as const,
	mediaBase64: 'QUJD',
};

function settings(
	patch: Partial<CustomTranscriptionProviderSettings> = {},
): CustomTranscriptionProviderSettings {
	return { ...DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER, ...patch };
}

//////////
//////////

describe('normalizeProviderBaseUrl', () => {
	it('adds /v1 to a bare origin', () => {
		expect(normalizeProviderBaseUrl('https://api.openai.com')).toBe('https://api.openai.com/v1');
	});

	it('keeps an existing /v1 and strips the trailing slash', () => {
		expect(normalizeProviderBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
	});

	it('strips a pasted chat/completions endpoint', () => {
		expect(normalizeProviderBaseUrl('https://api.openai.com/v1/chat/completions'))
			.toBe('https://api.openai.com/v1');
	});

	it('strips a pasted responses endpoint and keeps proxy prefixes', () => {
		expect(normalizeProviderBaseUrl('https://gateway.example.com/proxy/v1/responses'))
			.toBe('https://gateway.example.com/proxy/v1');
	});

	it('preserves non-default paths untouched', () => {
		expect(normalizeProviderBaseUrl('https://my.host/api/v1')).toBe('https://my.host/api/v1');
	});

	it('falls back to the OpenAI default when blank', () => {
		expect(normalizeProviderBaseUrl('   ')).toBe('https://api.openai.com/v1');
		expect(normalizeProviderBaseUrl('')).toBe('https://api.openai.com/v1');
	});
});

describe('extractChatCompletionsText', () => {
	it('reads a plain string message', () => {
		expect(extractChatCompletionsText({
			choices: [{ message: { content: 'hello' } }],
		})).toBe('hello');
	});

	it('joins content-part arrays', () => {
		expect(extractChatCompletionsText({
			choices: [{
				message: {
					content: [
						{ type: 'text', text: 'a' },
						{ type: 'reasoning', text: 'IGNORED' },
						{ type: 'text', text: 'b' },
					],
				},
			}],
		})).toBe('ab');
	});

	it('accepts the legacy choices[0].text shape', () => {
		expect(extractChatCompletionsText({ choices: [{ text: 'legacy' }] })).toBe('legacy');
	});

	it('returns null for missing or empty payloads', () => {
		expect(extractChatCompletionsText(null)).toBeNull();
		expect(extractChatCompletionsText({})).toBeNull();
		expect(extractChatCompletionsText({ choices: [] })).toBeNull();
		expect(extractChatCompletionsText({ choices: [{ message: {} }] })).toBeNull();
	});
});

describe('extractResponsesText', () => {
	it('skips reasoning items and joins message output_text parts', () => {
		expect(extractResponsesText({
			output: [
				{ type: 'reasoning', content: [{ type: 'output_text', text: 'IGNORED' }] },
				{ type: 'message', content: [{ type: 'output_text', text: 'line 1' }] },
				{ type: 'message', content: [{ type: 'output_text', text: ' line 2' }] },
			],
		})).toBe('line 1 line 2');
	});

	it('prefers the flattened output_text convenience field', () => {
		expect(extractResponsesText({
			output_text: 'flat',
			output: [{ type: 'message', content: [{ type: 'output_text', text: 'nested' }] }],
		})).toBe('flat');
	});

	it('returns null when no message block carries text', () => {
		expect(extractResponsesText({ output: [{ type: 'reasoning' }] })).toBeNull();
		expect(extractResponsesText({})).toBeNull();
	});
});

describe('request bodies', () => {
	it('builds a Chat Completions body with the rules in a system message', () => {
		const body = buildChatCompletionsBody(settings({ model: 'gpt-4.1-mini' }), MEDIA, 'prompt');
		expect(body.model).toBe('gpt-4.1-mini');
		expect(body.messages).toEqual([
			{ role: 'system', content: 'prompt' },
			{
				role: 'user',
				content: [
					{ type: 'text', text: USER_TRANSCRIPTION_INSTRUCTION },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
				],
			},
		]);
	});

	it('omits max_tokens and temperature by default', () => {
		const body = buildChatCompletionsBody(settings(), MEDIA, 'prompt');
		expect(body).not.toHaveProperty('max_tokens');
		expect(body).not.toHaveProperty('temperature');
	});

	it('sends token and temperature limits when configured', () => {
		const body = buildChatCompletionsBody(
			settings({ maxOutputTokens: 128, temperature: '0.2' }),
			MEDIA,
			'prompt',
		);
		expect(body.max_tokens).toBe(128);
		expect(body.temperature).toBe(0.2);
	});

	it('lets extra body JSON win over defaults', () => {
		const body = buildChatCompletionsBody(
			settings({ model: 'a', extraBodyJson: '{"model":"b","reasoning_effort":"low"}' }),
			MEDIA,
			'prompt',
		);
		expect(body.model).toBe('b');
		expect(body.reasoning_effort).toBe('low');
	});

	it('builds a Responses body with instructions and a string image_url', () => {
		const body = buildResponsesBody(
			settings({ model: 'gpt-5', maxOutputTokens: 64 }),
			MEDIA,
			'prompt',
		);
		expect(body.model).toBe('gpt-5');
		expect(body.max_output_tokens).toBe(64);
		// Responses carries the system prompt as top-level `instructions`.
		expect(body.instructions).toBe('prompt');
		expect(body.input).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: USER_TRANSCRIPTION_INSTRUCTION },
					{ type: 'input_image', image_url: 'data:image/png;base64,QUJD' },
				],
			},
		]);
	});
});

describe('provider presets', () => {
	it('keeps a Gemini preset on the official OpenAI-compatible surface', () => {
		const gemini = PROVIDER_PRESETS.find((preset) => preset.id === 'gemini');
		expect(gemini?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
		expect(gemini?.apiStyle).toBe('chat-completions');
		// A path-bearing URL must survive normalization: the /v1beta/openai segment
		// is part of Gemini's endpoint, not a proxy prefix to be dropped.
		expect(normalizeProviderBaseUrl(gemini!.baseUrl))
			.toBe('https://generativelanguage.googleapis.com/v1beta/openai');
	});

	it('gives every preset a unique id and a reachable base URL', () => {
		const ids = PROVIDER_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const preset of PROVIDER_PRESETS) {
			expect(preset.baseUrl.startsWith('http')).toBe(true);
		}
	});
});

describe('thinking mode', () => {
	const DEEPSEEK = 'https://api.deepseek.com/v1';

	it('sends nothing when the mode is the provider default', () => {
		const body = buildChatCompletionsBody(settings({ reasoningMode: 'default' }), MEDIA, 'p');
		expect(hasReasoningFields(body)).toBe(false);
	});

	it('disables DeepSeek thinking with its documented switch', () => {
		const body = buildChatCompletionsBody(
			settings({ reasoningMode: 'off', baseUrl: DEEPSEEK }),
			MEDIA,
			'p',
		);
		expect(body.thinking).toEqual({ type: 'disabled' });
		// The switch alone is enough; DeepSeek has no "none" effort level.
		expect(body).not.toHaveProperty('reasoning_effort');
	});

	it('disables reasoning with reasoning_effort outside DeepSeek', () => {
		const body = buildChatCompletionsBody(
			settings({ reasoningMode: 'off', baseUrl: 'https://api.openai.com/v1' }),
			MEDIA,
			'p',
		);
		expect(body.reasoning_effort).toBe('none');
		expect(body).not.toHaveProperty('thinking');
	});

	it('collapses medium to high on DeepSeek, which has no medium level', () => {
		const body = buildChatCompletionsBody(
			settings({ reasoningMode: 'medium', baseUrl: DEEPSEEK }),
			MEDIA,
			'p',
		);
		expect(body.thinking).toEqual({ type: 'enabled' });
		expect(body.reasoning_effort).toBe('high');
	});

	it('keeps medium as-is on other providers', () => {
		const body = buildChatCompletionsBody(
			settings({ reasoningMode: 'medium', baseUrl: 'https://api.openai.com/v1' }),
			MEDIA,
			'p',
		);
		expect(body.reasoning_effort).toBe('medium');
	});

	it('uses reasoning.effort on the Responses API', () => {
		expect(
			buildResponsesBody(settings({ reasoningMode: 'off', apiStyle: 'responses' }), MEDIA, 'p')
				.reasoning,
		).toEqual({ effort: 'none' });
		expect(
			buildResponsesBody(settings({ reasoningMode: 'high', apiStyle: 'responses' }), MEDIA, 'p')
				.reasoning,
		).toEqual({ effort: 'high' });
	});

	it('strips every thinking field when a model rejects them', () => {
		const body = buildChatCompletionsBody(
			settings({ reasoningMode: 'low', baseUrl: DEEPSEEK }),
			MEDIA,
			'p',
		);
		expect(hasReasoningFields(body)).toBe(true);
		const trimmed = { ...body };
		stripReasoningFields(trimmed);
		expect(hasReasoningFields(trimmed)).toBe(false);
		expect(trimmed.model).toBe(body.model);
	});

	it('only treats reasoning wording on a 4xx body as a rejection', () => {
		expect(isReasoningRejection(400, 'Unrecognized request argument: reasoning_effort')).toBe(true);
		expect(isReasoningRejection(422, 'unknown field: thinking')).toBe(true);
		expect(isReasoningRejection(400, 'image format unsupported')).toBe(false);
		expect(isReasoningRejection(500, 'reasoning failed')).toBe(false);
	});
});

describe('normalizeCustomTranscriptionProvider', () => {
	it('returns defaults for missing data', () => {
		expect(normalizeCustomTranscriptionProvider(undefined))
			.toEqual(DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER);
	});

	it('fills partial data without dropping user values', () => {
		const partial = normalizeCustomTranscriptionProvider({
			enabled: true,
			model: 'my-model',
			apiStyle: 'nonsense',
			mediaFormat: 'tiff',
		});
		expect(partial.enabled).toBe(true);
		expect(partial.model).toBe('my-model');
		expect(partial.apiStyle).toBe('chat-completions');
		expect(partial.mediaFormat).toBe('png');
		expect(partial.baseUrl).toBe(DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER.baseUrl);
	});

	it('keeps a valid responses style', () => {
		expect(normalizeCustomTranscriptionProvider({ apiStyle: 'responses' }).apiStyle)
			.toBe('responses');
	});

	it('keeps a valid thinking mode and falls back on junk', () => {
		expect(normalizeCustomTranscriptionProvider({ reasoningMode: 'high' }).reasoningMode)
			.toBe('high');
		expect(normalizeCustomTranscriptionProvider({ reasoningMode: 'turbo' }).reasoningMode)
			.toBe(DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER.reasoningMode);
		// Old data.json files predate the field entirely.
		expect(normalizeCustomTranscriptionProvider({ enabled: true }).reasoningMode)
			.toBe('off');
	});
});

describe('isCustomTranscriptionProviderUsable', () => {
	it('requires enabled, a base URL, and a model', () => {
		expect(isCustomTranscriptionProviderUsable(settings())).toBe(false);
		expect(isCustomTranscriptionProviderUsable(settings({ enabled: true }))).toBe(true);
		expect(isCustomTranscriptionProviderUsable(settings({ enabled: true, model: '  ' }))).toBe(false);
		expect(isCustomTranscriptionProviderUsable(settings({ enabled: true, baseUrl: '' }))).toBe(false);
	});
});
