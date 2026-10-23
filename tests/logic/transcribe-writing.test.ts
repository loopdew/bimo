import { describe, expect, test, beforeEach } from '@jest/globals';
import {
	DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER,
	prepareProviderMedia,
	requestCustomTranscription,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers';
import {
	HandwritingTranscriptionJobError,
	TranscriptionNotConfiguredError,
} from 'src/logic/transcription-errors';
import { transcribeWriting } from 'src/logic/transcribe-writing';

/**
 * `transcribeWriting` after the portal removal.
 *
 * The old test covered the Almost Useful job POST. That path is gone, so what
 * matters now is: missing configuration must be a clear error rather than a
 * silent fallback, and the SVG→PNG retry must still work.
 */

jest.mock('src/logic/transcription-providers', () => {
	const actual = jest.requireActual('src/logic/transcription-providers');
	return {
		...actual,
		prepareProviderMedia: jest.fn(),
		requestCustomTranscription: jest.fn(),
	};
});

const prepareMedia = jest.mocked(prepareProviderMedia);
const request = jest.mocked(requestCustomTranscription);

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';

const provider: CustomTranscriptionProviderSettings = {
	...DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER,
	enabled: true,
	apiStyle: 'chat-completions',
	baseUrl: 'https://api.example.com/v1',
	apiKey: 'test-key',
	model: 'vision-model',
	mediaFormat: 'png',
};

describe('transcribeWriting', () => {
	beforeEach(() => {
		prepareMedia.mockReset();
		request.mockReset();
		prepareMedia.mockResolvedValue({ mediaType: 'image/png', mediaBase64: 'AAAA' });
		request.mockResolvedValue('Hello world');
	});

	test('refuses to run without a configured endpoint', async () => {
		await expect(transcribeWriting(SVG, undefined)).rejects.toBeInstanceOf(
			TranscriptionNotConfiguredError,
		);
		// No request must be attempted: there is no backend to fall back to.
		expect(request).not.toHaveBeenCalled();
		expect(prepareMedia).not.toHaveBeenCalled();
	});

	test('treats a disabled provider as unconfigured', async () => {
		// A key is optional on purpose (Ollama and LM Studio run locally), so
		// "usable" means enabled + base URL + model, nothing more.
		const incomplete = { ...provider, enabled: false };
		await expect(transcribeWriting(SVG, incomplete)).rejects.toBeInstanceOf(
			TranscriptionNotConfiguredError,
		);
		expect(request).not.toHaveBeenCalled();
	});

	test('posts to the configured endpoint and returns its text', async () => {
		await expect(transcribeWriting(SVG, provider)).resolves.toBe('Hello world');
		expect(prepareMedia).toHaveBeenCalledWith(SVG, 'png');
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('retries once as PNG when an SVG upload is rejected', async () => {
		const svgProvider = { ...provider, mediaFormat: 'svg' as const };
		request.mockRejectedValueOnce(
			new HandwritingTranscriptionJobError({
				message: 'unsupported image',
				status: 400,
				code: null,
				retryable: false,
			}),
		);
		request.mockResolvedValueOnce('retried');

		await expect(transcribeWriting(SVG, svgProvider)).resolves.toBe('retried');
		expect(prepareMedia).toHaveBeenNthCalledWith(1, SVG, 'svg');
		expect(prepareMedia).toHaveBeenNthCalledWith(2, SVG, 'png');
		expect(request).toHaveBeenCalledTimes(2);
	});

	test('does not retry an unrelated failure', async () => {
		const svgProvider = { ...provider, mediaFormat: 'svg' as const };
		request.mockRejectedValueOnce(
			new HandwritingTranscriptionJobError({
				message: 'invalid api key',
				status: 401,
				code: null,
				retryable: false,
			}),
		);

		await expect(transcribeWriting(SVG, svgProvider)).rejects.toBeInstanceOf(
			HandwritingTranscriptionJobError,
		);
		expect(request).toHaveBeenCalledTimes(1);
	});
});
