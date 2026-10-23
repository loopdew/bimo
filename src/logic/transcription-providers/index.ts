export {
	DEFAULT_CUSTOM_TRANSCRIPTION_PROVIDER,
	DEFAULT_TRANSCRIPTION_PROMPT,
	isCustomTranscriptionProviderUsable,
	normalizeCustomTranscriptionProvider,
	type CustomTranscriptionProviderSettings,
	type TranscriptionApiStyle,
	type TranscriptionMediaFormat,
} from './types';
export { prepareProviderMedia, type ProviderMedia, type PrepareProviderMediaOptions } from './media';
export { PROVIDER_PRESETS, findProviderPreset, type ProviderPreset } from './presets';
export { fetchAvailableModels, type FetchModelsResult } from './list-models';
export { testCustomTranscriptionConnection } from './connection-test';
export {
	buildChatCompletionsBody,
	buildResponsesBody,
	extractChatCompletionsText,
	extractResponsesText,
	normalizeProviderBaseUrl,
	requestCustomTranscription,
	type ChatTurn,
} from './openai-compatible';
