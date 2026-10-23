import { existsSync } from 'fs';
import { join } from 'path';

//////////
//////////

/**
 * Unit tests use this paired SVG / expected.txt fixture.
 *
 * One real capture is enough: the tests that use it check SVG→PNG rasterisation
 * and metadata stripping, not transcription accuracy. Larger multi-paragraph
 * captures existed only for the retired live eval and have been removed.
 */
export const HANDWRITING_TRANSCRIPTION_FIXTURE_IDS = ['short - single paragraph'] as const;

export type HandwritingTranscriptionFixtureId =
	(typeof HANDWRITING_TRANSCRIPTION_FIXTURE_IDS)[number];

export interface HandwritingTranscriptionFixture {
	id: HandwritingTranscriptionFixtureId;
	svgPath: string;
	expectedPath: string;
}

const fixturesDir = join(__dirname);

export const HANDWRITING_TRANSCRIPTION_DEFAULT_FIXTURE_ID: HandwritingTranscriptionFixtureId =
	'short - single paragraph';

export function getHandwritingTranscriptionFixture(
	id: HandwritingTranscriptionFixtureId,
): HandwritingTranscriptionFixture {
	return {
		id,
		svgPath: join(fixturesDir, `${id}.svg`),
		expectedPath: join(fixturesDir, `${id}.expected.txt`),
	};
}

/** Returns fixtures whose `.svg` and `.expected.txt` pair both exist on disk. */
export function listHandwritingTranscriptionFixtures(): HandwritingTranscriptionFixture[] {
	return HANDWRITING_TRANSCRIPTION_FIXTURE_IDS.map(getHandwritingTranscriptionFixture).filter(
		(fixture) => existsSync(fixture.svgPath) && existsSync(fixture.expectedPath),
	);
}
