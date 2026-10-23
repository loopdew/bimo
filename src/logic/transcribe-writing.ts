import {
	isCustomTranscriptionProviderUsable,
	prepareProviderMedia,
	requestCustomTranscription,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers';
import {
	HandwritingTranscriptionJobError,
	TranscriptionNotConfiguredError,
} from 'src/logic/transcription-errors';
import { verbose } from 'src/logic/utils/universal-dev-logging';

///////////////////
///////////////////

/**
 * Detects a provider rejecting the uploaded image format (rather than the
 * request being wrong for some other reason). Most endpoints accept PNG/JPEG
 * only, so an SVG upload fails with 400/415 and a message like
 * "unsupported image ... webp, png, jpeg, and gif".
 *
 * When that happens the caller retries once with a rasterised PNG instead of
 * making the user discover the format setting on their own.
 */
function isUnsupportedImageFormatError(error: unknown): boolean {
	if (!(error instanceof HandwritingTranscriptionJobError)) return false;
	// Status code only — provider wording varies too much to match on text.
	// DeepSeek says "You have uploaded an unsupported image … webp, png, jpeg,
	// and gif", OpenAI says "Invalid file type", gateways say both and neither.
	// A 400/415/422 on an SVG upload is a format rejection in practice, and the
	// retry costs one request against a page that would otherwise fail forever.
	return error.status === 400 || error.status === 415 || error.status === 422;
}

/**
 * Transcribes handwriting from a full 笔墨 writing SVG file string.
 *
 * The page is prepared for the configured endpoint (PNG by default — most
 * vision APIs reject SVG image inputs) and posted to the user's own API, in
 * either Chat Completions or Responses format.
 *
 * There is no fallback backend. The previous version quietly posted to the
 * Almost Useful portal when no key was set, which required an account and
 * looked like a broken feature to anyone who did not have one. Missing
 * configuration now says so.
 */
export async function transcribeWriting(
	writingSvgFileContent: string,
	provider?: CustomTranscriptionProviderSettings,
): Promise<string> {
	if (!provider || !isCustomTranscriptionProviderUsable(provider)) {
		throw new TranscriptionNotConfiguredError();
	}

	verbose(`Handwriting transcription: posting to custom endpoint (${provider.apiStyle})`);
	const media = await prepareProviderMedia(writingSvgFileContent, provider.mediaFormat);
	try {
		return await requestCustomTranscription({ media, settings: provider });
	} catch (error) {
		// An SVG-configured endpoint that only accepts PNG/JPEG/WebP/GIF would
		// otherwise fail every time. Rasterise and retry once, transparently.
		if (provider.mediaFormat !== 'svg' || !isUnsupportedImageFormatError(error)) throw error;
		verbose('Handwriting transcription: endpoint rejected SVG, retrying as PNG');
		const pngMedia = await prepareProviderMedia(writingSvgFileContent, 'png');
		return requestCustomTranscription({ media: pngMedia, settings: provider });
	}
}
