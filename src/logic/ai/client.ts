import {
	isCustomTranscriptionProviderUsable,
	requestCustomTranscription,
	type ChatTurn,
	type CustomTranscriptionProviderSettings,
} from 'src/logic/transcription-providers';
import type { ProviderMedia } from 'src/logic/transcription-providers/media';

//////////
//////////

export interface AiCompletionRequest {
	settings: CustomTranscriptionProviderSettings;
	/** Rules / role. Sent as the system message (or `instructions` on Responses). */
	systemPrompt: string;
	/** What the user asked for, or the instruction for this task. */
	userText: string;
	/** Optional image. Captions and diagram reading attach one; figure plots do not. */
	media?: ProviderMedia | null;
	/** Prior turns for a multi-turn exchange (magic panel). */
	history?: ChatTurn[];
}

/** True when the configured endpoint can serve any AI call (not just transcription). */
export function isAiEndpointUsable(settings: CustomTranscriptionProviderSettings | undefined): boolean {
	return Boolean(settings && isCustomTranscriptionProviderUsable(settings));
}

/**
 * One text (optionally vision) completion against the same endpoint the
 * transcription queue uses.
 *
 * Kept thin on purpose: every caller shares the user's base URL, key, model,
 * temperature and thinking mode, so a single place decides how a request is
 * shaped. Failures surface as `HandwritingTranscriptionJobError`, whose
 * `status`/`retryable` the callers already know how to interpret.
 */
export async function requestAiCompletion(request: AiCompletionRequest): Promise<string> {
	return requestCustomTranscription({
		media: request.media ?? null,
		settings: request.settings,
		userText: request.userText,
		systemPromptOverride: request.systemPrompt,
		history: request.history,
	});
}
