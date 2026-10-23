import { t } from 'src/i18n';

///////////////////
///////////////////

/**
 * Transcription failure types, independent of any backend.
 *
 * These used to live inside the Almost Useful portal client. The portal is no
 * longer part of the product — transcription is either the user's own API or
 * nothing — but the queue still needs a typed error to decide retry and to
 * produce a readable notice, so the types moved here and lost their
 * transport-specific dependencies.
 */

/** Provider code for an upload the endpoint will not accept. */
export const HANDWRITING_TRANSCRIPTION_MEDIA_TOO_LARGE_CODE = 'media_too_large';

export const HANDWRITING_TRANSCRIPTION_TOO_LONG_NOTICE =
	'This file can\'t be transcribed currently because it is too long. This will be fixed in a future update to 笔墨.';

/** A transcription request that failed, with enough detail for the queue to react. */
export class HandwritingTranscriptionJobError extends Error {
	readonly status: number;
	readonly code: string | null;
	readonly retryable: boolean;

	constructor(params: {
		message: string;
		status: number;
		code: string | null;
		retryable: boolean;
	}) {
		super(params.message);
		this.name = 'HandwritingTranscriptionJobError';
		this.status = params.status;
		this.code = params.code;
		this.retryable = params.retryable;
	}
}

/**
 * Thrown when the user has not configured an endpoint.
 *
 * Deliberately not retryable and deliberately explicit: the old behaviour was
 * to quietly fall back to a portal account, which for anyone without one
 * looked like "transcription is broken".
 */
export class TranscriptionNotConfiguredError extends Error {
	constructor() {
		super(
			t(
				'No transcription API is configured. Open Settings → bimo → Models & connection and add a provider, model and API key.',
			),
		);
		this.name = 'TranscriptionNotConfiguredError';
	}
}

/** Notice text for one job failure. Too-long copy is 笔墨's; other messages come from the error. */
export function handwritingTranscriptionNoticeForError(
	error: HandwritingTranscriptionJobError,
): string {
	const isTooLong = error.code === HANDWRITING_TRANSCRIPTION_MEDIA_TOO_LARGE_CODE
		|| error.status === 413;
	if (isTooLong) return t(HANDWRITING_TRANSCRIPTION_TOO_LONG_NOTICE);
	return t(error.message);
}
