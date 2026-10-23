import { requestCustomTranscription } from './openai-compatible';
import type { ProviderMedia } from './media';
import type { CustomTranscriptionProviderSettings } from './types';

//////////
//////////

/** 1×1 white PNG — enough to prove the endpoint accepts an image part. */
const ONE_BY_ONE_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const CONNECTION_PROBE_PROMPT =
	'This image is a single white pixel. Reply with exactly two characters: OK';

/**
 * Sends a tiny real image through the exact production request path.
 *
 * This validates more than an auth ping: URL normalisation, headers, the chosen
 * wire format (Chat Completions or Responses), model access, and vision support.
 * Throws {@link HandwritingTranscriptionJobError} with the endpoint's own message.
 */
export async function testCustomTranscriptionConnection(
	settings: CustomTranscriptionProviderSettings,
): Promise<string> {
	const media: ProviderMedia = {
		mediaType: 'image/png',
		mediaBase64: ONE_BY_ONE_PNG_BASE64,
	};
	const probeSettings: CustomTranscriptionProviderSettings = {
		...settings,
		systemPrompt: CONNECTION_PROBE_PROMPT,
		maxOutputTokens: settings.maxOutputTokens > 0 ? settings.maxOutputTokens : 16,
	};
	return requestCustomTranscription({ media, settings: probeSettings });
}
